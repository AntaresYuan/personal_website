'use strict';
/* ════════════════════════════════════════════════════════════════════════
   usage-sources — per-tool transcript parsers for the /usage sync agent.

   Design ported from kaboo's CLI (cli/parsers.go, cli/scan_aggregate.go),
   trimmed to what a single-user, zero-dependency Node agent needs.

   Each parser turns one local transcript tree into a flat list of
   TokenEntry-shaped records:

     { source, model, project, timestamp, sessionId, eventId,
       inputTokens, outputTokens, cachedInputTokens,
       cacheCreationInputTokens, reasoningOutputTokens, totalTokens,
       dedupKey }

   plus SessionEvent-shaped records for session metrics:

     { source, sessionId, project, timestamp, role, eventId }

   Why five token fields instead of one
   ────────────────────────────────────
   kaboo keeps input / output / cache-read / cache-write / reasoning as
   DISTINCT, non-overlapping counters and only collapses them at display
   time. Collapsing at collection time (what this repo did before) is
   irreversible: once `input+output` is summed and shipped, the cache
   ratio and reasoning share can never be recovered. Store wide, render
   narrow.

   Dedup
   ─────
   Claude Code forks a session by COPYING the parent's jsonl, so the same
   assistant turn exists in two files. kaboo dedups on a content
   fingerprint; we do the same via `dedupKey`. Codex Desktop additionally
   replays ancestor history, so its cumulative counters need delta-ing
   before they mean anything per-turn.
   ════════════════════════════════════════════════════════════════════════ */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// ── helpers ───────────────────────────────────────────────────────────
function expandHome(p) {
  if (typeof p !== 'string' || !p) return '';
  return p.replace(/^~(?=$|\/)/, os.homedir());
}

function int(v) {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// Project label = basename of the working directory. kaboo ships the full
// project name; we deliberately keep only the leaf so an absolute path
// (which can embed a client name or a private repo tree) never becomes the
// dimension value. Callers may still choose not to publish it at all.
function projectLabel(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return '';
  const base = path.basename(cwd.trim());
  if (!base || base === '/' || base === '.') return '';
  return base.slice(0, 64);
}

// Walk a directory tree collecting files that pass `keep`. Depth-capped so
// a symlink loop or a pathological tree can't hang the agent.
function walkFiles(root, keep, maxDepth = 8) {
  const out = [];
  if (!root) return out;
  const stack = [[root, 0]];
  while (stack.length) {
    const [dir, depth] = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push([full, depth + 1]);
      } else if (ent.isFile() && keep(full)) {
        out.push(full);
      }
    }
  }
  return out;
}

function readLines(file) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return content.split('\n');
}

/* ── tool-call classification ─────────────────────────────────────────
   kaboo keeps per-tool, per-MCP-server and per-skill counters
   (menubar_local_usage.go: SkillCounts / menubarLocalMCPItems). Those are
   genuinely interesting numbers — "how much of the work was reading vs
   writing vs shelling out" says more about how you work than a token
   total does.

   But raw tool names cannot be published as-is. A scan of this machine
   turned up MCP servers and skills named after internal systems; shipping
   `mcp__<internal-thing>__query` to a public endpoint would leak an
   employer's tooling inventory. kaboo is an internal tool and has no such
   constraint; this site is public and does.

   So the parsers record a coarse CATEGORY, not the tool name. The
   categories are a fixed, closed vocabulary defined here — a new tool the
   parser has never seen falls into `other`, and can never invent a new
   dimension value. Nothing derived from a name reaches the payload.

   The one exception is that MCP calls are counted separately in aggregate
   ("how much of my work runs through MCP servers") without naming any
   server. */
const TOOL_CATEGORIES = ['read', 'edit', 'shell', 'search', 'browser', 'task', 'other'];

// Ordered, first-match-wins. Patterns are matched against the LOWERCASED
// tool name. Deliberately conservative: anything unrecognised is `other`
// rather than guessed into a bucket that would skew the mix.
//
// A measured caveat, worth stating because it changes how the chart reads:
// the two sources do not expose the same granularity. Claude has a distinct
// `Read` tool (128 calls here); Codex has none and reads files through
// `exec_command` (11,270 calls), so its reads are indistinguishable from
// any other shell work. The `shell` share is therefore "ran a command",
// NOT "did not read files", and `read` undercounts on the Codex side by
// construction. No parser change can fix that — the information isn't in
// the transcript.
const TOOL_RULES = [
  // Browser / computer control (Claude's chrome MCP).
  [/computer|screenshot|javascript_tool|navigate|tabs?_|browser|read_console|read_network|resize_window/, 'browser'],
  // Reading files, notebooks and images.
  [/^(read|notebookread)$/, 'read'],
  [/view_image/, 'read'],
  // Writing / editing / patching.
  [/^(write|edit|multiedit|notebookedit)$/, 'edit'],
  [/apply_patch|write_stdin/, 'edit'],
  // Shell execution.
  [/^(bash|bashoutput|killshell)$/, 'shell'],
  [/exec_command|local_shell|read_thread_terminal|list_commands/, 'shell'],
  // Search over files or the web.
  [/^(grep|glob|websearch|webfetch|ls)$/, 'search'],
  [/tool_?search|find$/, 'search'],
  // Agent/plan/skill orchestration.
  [/^(task|todowrite|skill|agent|askuserquestion|schedulewakeup)$/, 'task'],
  [/update_plan|create_goal|get_goal|load_workspace|spawn_agent/, 'task'],
  // MCP plumbing calls — listing resources isn't work, it's discovery.
  [/list_mcp|list_resources/, 'other'],
];

function classifyTool(rawName) {
  if (typeof rawName !== 'string' || !rawName) return 'other';
  const name = rawName.toLowerCase();
  // MCP tools are named mcp__<server>__<tool>; classify on the tool part so
  // an MCP-provided file read still counts as a read.
  const tail = name.startsWith('mcp__') ? name.split('__').slice(2).join('__') || name : name;
  for (const [re, cat] of TOOL_RULES) {
    if (re.test(tail)) return cat;
  }
  return 'other';
}

function isMcpTool(rawName) {
  return typeof rawName === 'string' && rawName.startsWith('mcp__');
}

// Empty per-day tool tally. Shape is fixed so the payload never grows a
// key the Worker's validator hasn't seen.
function emptyToolCounts() {
  const o = {};
  for (const c of TOOL_CATEGORIES) o[c] = 0;
  o.mcp = 0; // cross-cutting: how many calls went through any MCP server
  return o;
}

function tallyTool(counts, rawName) {
  if (!counts) return;
  counts[classifyTool(rawName)]++;
  if (isMcpTool(rawName)) counts.mcp++;
}

// ── Claude Code / Claude Desktop ──────────────────────────────────────
// Transcript: ~/.claude/projects/<slug>/<session-uuid>.jsonl
// Assistant events carry message.usage with Anthropic's four counters.
//
// Real-world sample from this machine (2026):
//   input_tokens, output_tokens,
//   cache_read_input_tokens, cache_creation_input_tokens,
//   cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }
//
// The ephemeral_* split matters for cost: a 1h cache write bills at 2x
// input, a 5m write at 1.25x. The old agent assumed 5m unconditionally.
function parseClaude(rootDir, sourceName = 'claude') {
  const entries = [];
  const events = [];
  const toolCalls = [];
  const files = walkFiles(rootDir, (p) => p.endsWith('.jsonl'));

  for (const file of files) {
    for (const line of readLines(file)) {
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (!ev || typeof ev !== 'object') continue;
      const ts = ev.timestamp;
      if (typeof ts !== 'string' || ts.length < 10) continue;
      const when = new Date(ts);
      if (Number.isNaN(when.getTime())) continue;

      const sessionId = ev.sessionId || ev.session_id || '';
      const project = projectLabel(ev.cwd);

      if (ev.type === 'user') {
        events.push({
          source: sourceName,
          sessionId,
          project,
          timestamp: when,
          role: 'user',
          eventId: ev.uuid || '',
          synthetic: Boolean(ev.isMeta || ev.isCompactSummary),
        });
        continue;
      }
      if (ev.type !== 'assistant') continue;

      const msg = ev.message || {};
      const u = msg.usage;

      events.push({
        source: sourceName,
        sessionId,
        project,
        timestamp: when,
        role: 'assistant',
        eventId: ev.uuid || '',
        synthetic: false,
      });

      /* Tool calls live in the assistant message content as
         { type: 'tool_use', name, input }. Verified on this machine:
         1,724 such records across 362 files, 18 distinct names.

         These are deduped alongside the token entries — a forked session
         copies the parent jsonl verbatim, so the same tool_use appears
         twice and would otherwise double-count. The dedup key is the
         block id when present (unique per call) and a content hash
         otherwise. */
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || block.type !== 'tool_use' || typeof block.name !== 'string') continue;
          toolCalls.push({
            source: sourceName,
            timestamp: when,
            category: classifyTool(block.name),
            mcp: isMcpTool(block.name),
            dedupKey: block.id
              ? `${sourceName}|tool|${block.id}`
              : sha256Hex([sourceName, 'tool', when.getTime(), block.name, ev.uuid || ''].join('|')),
          });
        }
      }

      if (!u || typeof u !== 'object') continue;

      const inputTokens = int(u.input_tokens);
      const outputTokens = int(u.output_tokens);
      const cachedInputTokens = int(u.cache_read_input_tokens) + int(u.cached_input_tokens);
      const cacheCreationInputTokens = int(u.cache_creation_input_tokens);

      // Split the cache write by TTL tier so the cost model can bill each
      // at its real rate instead of assuming one tier for both.
      const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : {};
      let cacheWrite5m = int(cc.ephemeral_5m_input_tokens);
      let cacheWrite1h = int(cc.ephemeral_1h_input_tokens);
      if (cacheWrite5m + cacheWrite1h === 0 && cacheCreationInputTokens > 0) {
        // Older transcripts have no per-tier breakdown. Claude Code's
        // default is the 5-minute tier, so attribute it there.
        cacheWrite5m = cacheCreationInputTokens;
      }

      const total =
        inputTokens + outputTokens + cachedInputTokens + cacheCreationInputTokens;
      if (total <= 0) continue;

      const model = typeof msg.model === 'string' ? msg.model : '';

      // Content fingerprint, mirroring kaboo's contentDedupKey: a forked
      // session copies the parent jsonl verbatim, so (ts, model, counters)
      // collides exactly on the duplicated turns. requestId, when present,
      // is already unique per API call and makes this exact.
      const dedupKey = msg.id || ev.requestId
        ? `${sourceName}|${msg.id || ev.requestId}`
        : sha256Hex(
            [
              sourceName,
              when.getTime(),
              model,
              inputTokens,
              outputTokens,
              cachedInputTokens,
              cacheCreationInputTokens,
            ].join('|')
          );

      entries.push({
        source: sourceName,
        model,
        project,
        timestamp: when,
        sessionId,
        eventId: ev.uuid || '',
        inputTokens,
        outputTokens,
        cachedInputTokens,
        cacheCreationInputTokens,
        cacheWrite5m,
        cacheWrite1h,
        reasoningOutputTokens: 0,
        totalTokens: total,
        dedupKey,
      });
    }
  }

  return { entries, events, toolCalls };
}

// ── Codex CLI / Codex Desktop ─────────────────────────────────────────
// Transcript: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
//
// Usage arrives as event_msg / type=token_count carrying CUMULATIVE
// total_token_usage for the session, plus last_token_usage for the turn.
// kaboo deltas the cumulative counters (max(0, cur-prev)) rather than
// trusting last_token_usage, because a resumed or replayed session can
// repeat a turn payload. We do the same.
function parseCodex(rootDir, sourceName = 'codex') {
  const entries = [];
  const events = [];
  const toolCalls = [];
  const files = walkFiles(rootDir, (p) => p.endsWith('.jsonl'));

  for (const file of files) {
    let sessionId = '';
    let project = '';
    let model = '';
    // Cumulative watermark per session file.
    let prev = { input: 0, output: 0, cached: 0, reasoning: 0, total: 0 };

    for (const line of readLines(file)) {
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (!ev || typeof ev !== 'object') continue;

      const payload = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};

      if (ev.type === 'session_meta') {
        sessionId = payload.session_id || payload.id || '';
        project = projectLabel(payload.cwd);
        continue;
      }
      if (ev.type === 'turn_context') {
        if (typeof payload.model === 'string' && payload.model) model = payload.model;
        if (!project) project = projectLabel(payload.cwd);
        continue;
      }

      const ts = ev.timestamp;
      if (typeof ts !== 'string' || ts.length < 10) continue;
      const when = new Date(ts);
      if (Number.isNaN(when.getTime())) continue;

      // Session events: user prompts and agent messages drive duration /
      // active-time metrics.
      if (ev.type === 'response_item' && payload.type === 'message') {
        const role = payload.role === 'user' ? 'user' : 'assistant';
        // Codex injects developer/system context blocks as messages; they
        // aren't user activity.
        if (payload.role === 'user' || payload.role === 'assistant') {
          events.push({
            source: sourceName,
            sessionId,
            project,
            timestamp: when,
            role,
            eventId: payload.id || '',
            synthetic: false,
          });
        }
        continue;
      }

      /* Codex records tool calls with a COMPLETELY different schema from
         Claude's — three record types, none of them `tool_use`:

           response_item/function_call     → payload.name  (exec_command,
                                             update_plan, tool_search …)
           response_item/custom_tool_call  → payload.name  (apply_patch …)
           response_item/local_shell_call  → shell, name often absent

         Measured on this machine: 4,579 exec_command + 473 apply_patch +
         413 write_stdin + 151 update_plan. Assuming the Claude shape here
         would have silently dropped ALL of it — the two sources genuinely
         do not share a format, and Codex is the busier of the two by
         tool-call volume. */
      if (
        ev.type === 'response_item' &&
        (payload.type === 'function_call' ||
          payload.type === 'custom_tool_call' ||
          payload.type === 'local_shell_call')
      ) {
        // local_shell_call may carry no name; it is a shell call by type.
        const rawName =
          typeof payload.name === 'string' && payload.name
            ? payload.name
            : payload.type === 'local_shell_call'
              ? 'local_shell'
              : '';
        if (rawName) {
          toolCalls.push({
            source: sourceName,
            timestamp: when,
            category: classifyTool(rawName),
            mcp: isMcpTool(rawName),
            // call_id is unique per invocation; fall back to a content hash.
            dedupKey: payload.call_id
              ? `${sourceName}|tool|${payload.call_id}`
              : sha256Hex(
                  [sourceName, 'tool', path.basename(file), when.getTime(), rawName].join('|')
                ),
          });
        }
        continue;
      }

      if (ev.type !== 'event_msg' || payload.type !== 'token_count') continue;
      const info = payload.info && typeof payload.info === 'object' ? payload.info : {};
      const cur = info.total_token_usage && typeof info.total_token_usage === 'object'
        ? info.total_token_usage
        : null;
      if (!cur) continue;

      // Verified against real rollouts on this machine (2026-06):
      //   total_tokens == input_tokens + output_tokens   (cached NOT added)
      // which proves cached_input_tokens is a SUBSET of input_tokens, i.e.
      // "of the input I just sent, this much was served from cache". Anthropic
      // reports the same concept as a SEPARATE, additive category. We
      // normalize to the Anthropic convention (non-overlapping buckets) by
      // carving cached out of input below, so cross-tool sums stay honest.
      const curVals = {
        input: int(cur.input_tokens),
        output: int(cur.output_tokens),
        cached: int(cur.cached_input_tokens) + int(cur.cache_read_input_tokens),
        reasoning: int(cur.reasoning_output_tokens),
        total: int(cur.total_tokens),
      };

      // A cumulative counter that went BACKWARDS means a new session
      // reused this file (or the log rotated). Reset the watermark rather
      // than emitting a negative delta.
      const wentBackwards =
        curVals.input < prev.input ||
        curVals.output < prev.output ||
        curVals.cached < prev.cached;
      if (wentBackwards) prev = { input: 0, output: 0, cached: 0, reasoning: 0, total: 0 };

      const delta = {
        input: Math.max(0, curVals.input - prev.input),
        output: Math.max(0, curVals.output - prev.output),
        cached: Math.max(0, curVals.cached - prev.cached),
        reasoning: Math.max(0, curVals.reasoning - prev.reasoning),
      };
      prev = curVals;

      // Codex counts cached_input_tokens INSIDE input_tokens, and
      // reasoning_output_tokens INSIDE output_tokens (verified on 4,066 real
      // token_count events from this machine: total==input+output in 99.5% of
      // them, and reasoning>output never occurred). Anthropic instead reports
      // cache reads as a separate additive category. Carve both subsets out so
      // all five of our counters are non-overlapping and a cross-tool total is
      // a real total rather than a double-count.
      const freshInput = Math.max(0, delta.input - delta.cached);
      const freshOutput = Math.max(0, delta.output - delta.reasoning);

      const total = freshInput + freshOutput + delta.cached + delta.reasoning;
      if (total <= 0) continue;

      entries.push({
        source: sourceName,
        model,
        project,
        timestamp: when,
        sessionId,
        eventId: '',
        inputTokens: freshInput,
        outputTokens: freshOutput,
        cachedInputTokens: delta.cached,
        cacheCreationInputTokens: 0,   // OpenAI has no separate cache-write tier
        cacheWrite5m: 0,
        cacheWrite1h: 0,
        reasoningOutputTokens: delta.reasoning,
        totalTokens: total,
        // Cumulative watermark + file identity makes each delta unique.
        dedupKey: sha256Hex(
          [sourceName, path.basename(file), curVals.input, curVals.output, curVals.cached, curVals.reasoning].join('|')
        ),
      });
    }
  }

  return { entries, events, toolCalls };
}

// ── source registry ───────────────────────────────────────────────────
// Mirrors kaboo's multi-parser design: each source is independently
// discoverable and independently skippable. Adding a tool = adding a row.
const SOURCE_DEFS = [
  {
    name: 'claude',
    label: 'Claude Code',
    defaultDir: '~/.claude/projects',
    parse: parseClaude,
  },
  {
    name: 'codex',
    label: 'Codex',
    defaultDir: '~/.codex/sessions',
    parse: parseCodex,
  },
];

// Resolve which sources to scan. `cfg.sources` may be:
//   - undefined            → every source whose default dir exists
//   - ["claude","codex"]   → those sources at their default dirs
//   - { claude: "~/x" }    → explicit dir override per source
function resolveSources(cfg = {}) {
  const requested = cfg.sources;
  const out = [];

  for (const def of SOURCE_DEFS) {
    let dir = null;
    let explicit = false;

    if (Array.isArray(requested)) {
      if (!requested.includes(def.name)) continue;
      explicit = true;
      dir = def.defaultDir;
    } else if (requested && typeof requested === 'object') {
      if (!(def.name in requested)) continue;
      const v = requested[def.name];
      if (v === false) continue;
      explicit = true;
      dir = typeof v === 'string' && v ? v : def.defaultDir;
    } else {
      dir = def.defaultDir;
    }

    // Legacy single-source config: claudeProjectsDir overrides the claude dir.
    if (def.name === 'claude' && typeof cfg.claudeProjectsDir === 'string' && cfg.claudeProjectsDir) {
      dir = cfg.claudeProjectsDir;
      explicit = true;
    }

    const resolved = expandHome(dir);
    let exists = false;
    try {
      exists = fs.statSync(resolved).isDirectory();
    } catch {
      exists = false;
    }

    out.push({ ...def, dir: resolved, exists, explicit });
  }

  return out;
}

module.exports = {
  SOURCE_DEFS,
  resolveSources,
  parseClaude,
  parseCodex,
  projectLabel,
  walkFiles,
  expandHome,
  sha256Hex,
  TOOL_CATEGORIES,
  classifyTool,
  isMcpTool,
  emptyToolCounts,
  tallyTool,
};
