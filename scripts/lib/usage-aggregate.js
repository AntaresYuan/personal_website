'use strict';
/* ════════════════════════════════════════════════════════════════════════
   usage-aggregate — dedup, bucketing, session metrics and cost.

   Ported from kaboo's cli/parsers.go + cli/scan_aggregate.go:

     dedupeEntries        ← kaboo dedupeEntriesByKey  (fork-copy collapse)
     aggregateToBuckets   ← kaboo AggregateToBuckets  ((source,model,project,
                                                        bucketStart) key)
     extractSessions      ← kaboo ExtractSessions     (duration / activeSeconds
                                                        / userPromptHours)
     dailyRollup          ← the /usage-specific projection kaboo does in SQL

   kaboo buckets on a 30-minute grid because its backend charts intra-day
   rate. This site only ever renders per-DAY cells, so we roll up to days
   at the end — but we keep the half-hour bucket as the intermediate key so
   the wire format stays a superset and an hourly view stays possible later
   without re-collecting anything.
   ════════════════════════════════════════════════════════════════════════ */

const crypto = require('node:crypto');
// emptyToolCounts defines the fixed tool-category vocabulary; importing it
// keeps the day shape and the parser's classification in one place.
const { emptyToolCounts } = require('./usage-sources.js');

// ── dedup ─────────────────────────────────────────────────────────────
// Claude Code forks a session by copying the parent's jsonl file, so the
// same assistant turn appears in N files. Keep the first occurrence of each
// dedupKey. Entries without a key pass through untouched (kaboo does the
// same for parsers with no stable identity).
function dedupeEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (!e.dedupKey) {
      out.push(e);
      continue;
    }
    if (seen.has(e.dedupKey)) continue;
    seen.add(e.dedupKey);
    out.push(e);
  }
  return out;
}

// Fork-stable event ids: a forked session reuses the parent's event ids for
// pre-fork messages. Collapse on (source, eventId) so session metrics don't
// double-count. Mirrors kaboo dedupeEventsByEventID.
function dedupeEvents(events) {
  const seen = new Set();
  const out = [];
  const sorted = [...events].sort((a, b) => {
    const d = a.timestamp - b.timestamp;
    if (d !== 0) return d;
    return String(a.sessionId).localeCompare(String(b.sessionId));
  });
  for (const e of sorted) {
    if (!e.eventId) {
      out.push(e);
      continue;
    }
    const key = `${e.source}\u0000${e.eventId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

// ── bucketing ─────────────────────────────────────────────────────────
// kaboo's RoundToHalfHour: floor to :00 or :30.
function roundToHalfHour(date) {
  const d = new Date(date.getTime());
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() < 30 ? 0 : 30);
  return d;
}

const TOKEN_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'cacheCreationInputTokens',
  'cacheWrite5m',
  'cacheWrite1h',
  'reasoningOutputTokens',
  'totalTokens',
];

// Aggregate entries into (source, model, project, bucketStart) buckets,
// exactly kaboo's AggregateToBuckets key.
function aggregateToBuckets(entries) {
  const map = new Map();
  for (const e of entries) {
    const bucketStart = roundToHalfHour(e.timestamp).toISOString();
    const key = [e.source, e.model, e.project, bucketStart].join('\u0000');
    let b = map.get(key);
    if (!b) {
      b = {
        source: e.source,
        model: e.model || '',
        project: e.project || '',
        bucketStart,
      };
      for (const f of TOKEN_FIELDS) b[f] = 0;
      map.set(key, b);
    }
    for (const f of TOKEN_FIELDS) b[f] += e[f] || 0;
  }
  return [...map.values()];
}

// ── session metrics ───────────────────────────────────────────────────
// kaboo's ExtractSessions, including the activeSeconds turn-accumulation
// algorithm: time is only counted from the first assistant reply after a
// user prompt through the last consecutive assistant event — idle time
// while the human is away never enters the total.
function extractSessions(events) {
  const deduped = dedupeEvents(events);
  const groups = new Map();
  for (const e of deduped) {
    if (!e.sessionId) continue;
    const key = `${e.source}\u0000${e.sessionId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const sessions = [];
  for (const [, evts] of groups) {
    evts.sort((a, b) => a.timestamp - b.timestamp);
    const first = evts[0];
    const last = evts[evts.length - 1];
    const durationSeconds = Math.max(
      0,
      Math.round((last.timestamp - first.timestamp) / 1000)
    );

    let activeSeconds = 0;
    let turnStart = null;
    let turnEnd = null;
    let waitingForFirstResponse = false;

    for (const ev of evts) {
      if (ev.role === 'user') {
        if (turnStart && turnEnd && turnEnd > turnStart) {
          activeSeconds += Math.round((turnEnd - turnStart) / 1000);
        }
        turnStart = null;
        turnEnd = null;
        waitingForFirstResponse = true;
      } else if (waitingForFirstResponse) {
        turnStart = ev.timestamp;
        turnEnd = ev.timestamp;
        waitingForFirstResponse = false;
      } else if (turnStart) {
        turnEnd = ev.timestamp;
      }
    }
    if (turnStart && turnEnd && turnEnd > turnStart) {
      activeSeconds += Math.round((turnEnd - turnStart) / 1000);
    }

    // Prompt timing, in LOCAL time — the point of an hour-of-day chart is
    // "when does this human work", and UTC destroys that: on a UTC+8 machine
    // a 22:00 session lands at 14:00 UTC, so the real double-peak (afternoon
    // + late evening) reads as a single implausible pre-dawn block. The
    // normalisation has to happen here, at collection, because the browser
    // can't know which timezone a given device was in.
    //
    // weekday index follows Date#getDay (0 = Sunday) to match the heatmap's
    // existing row order.
    const promptHours = new Array(24).fill(0);
    const promptWeekHours = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let userMessageCount = 0;
    for (const ev of evts) {
      if (ev.role === 'user' && !ev.synthetic) {
        userMessageCount++;
        const h = ev.timestamp.getHours();       // local hour
        const d = ev.timestamp.getDay();         // local weekday
        promptHours[h]++;
        promptWeekHours[d][h]++;
      }
    }

    sessions.push({
      source: first.source,
      project: first.project || '',
      // Hash the session id: the metric we want is "how many distinct
      // sessions", never "which session". kaboo hashes for the same reason.
      sessionHash: crypto.createHash('sha256').update(first.sessionId).digest('hex'),
      firstMessageAt: first.timestamp.toISOString(),
      lastMessageAt: last.timestamp.toISOString(),
      durationSeconds,
      activeSeconds,
      messageCount: evts.length,
      userMessageCount,
      userPromptHours: promptHours,
      userPromptWeekHours: promptWeekHours,
    });
  }
  return sessions;
}

// ── cost ──────────────────────────────────────────────────────────────
// USD per million tokens: [input, output, cacheWrite5m, cacheRead, cacheWrite1h].
// Substring match on the model id so dated snapshots
// ("claude-sonnet-5-20260115", "gpt-5.5-2026-04-24") resolve without
// enumerating every build. Keys are matched LONGEST-FIRST so a more specific
// id ("gpt-5.6-sol") wins over its prefix ("gpt-5.6").
//
// Verified 2026-08-31 against:
//   platform.claude.com/docs/en/about-claude/pricing
//   developers.openai.com/api/docs/pricing
// Re-verify when either vendor ships a new family; the dashboard picks up
// changes on the next sync.
//
// OpenAI has no separate cache-WRITE charge (writes bill at the input rate),
// so cacheWrite5m/1h mirror the input rate for gpt-* rows. Anthropic bills
// 5m writes at 1.25x input and 1h writes at 2x input.
const MODEL_PRICING = {
  // ── Anthropic ──                in     out    w5m     read   w1h
  'mythos-5':                     [10.0,  50.0,  12.50,  1.0,   20.0],
  'fable-5':                      [10.0,  50.0,  12.50,  1.0,   20.0],
  'opus-5':                       [5.0,   25.0,  6.25,   0.5,   10.0],
  'opus-4-8':                     [5.0,   25.0,  6.25,   0.5,   10.0],
  'opus-4-7':                     [5.0,   25.0,  6.25,   0.5,   10.0],
  'opus-4-6':                     [5.0,   25.0,  6.25,   0.5,   10.0],
  'opus-4-5':                     [5.0,   25.0,  6.25,   0.5,   10.0],
  'opus-4-1':                     [15.0,  75.0,  18.75,  1.5,   30.0],
  'sonnet-5':                     [2.0,   10.0,  2.50,   0.2,   4.0],
  'sonnet-4-6':                   [3.0,   15.0,  3.75,   0.3,   6.0],
  'sonnet-4-5':                   [3.0,   15.0,  3.75,   0.3,   6.0],
  'haiku-4-5':                    [1.0,   5.0,   1.25,   0.1,   2.0],
  // ── OpenAI (Codex) ──
  'gpt-5.6-sol':                  [5.0,   30.0,  5.0,    0.5,   5.0],
  'gpt-5.6-terra':                [2.0,   12.0,  2.0,    0.2,   2.0],
  'gpt-5.6-luna':                 [0.2,   1.2,   0.2,    0.02,  0.2],
  'gpt-5.6':                      [5.0,   30.0,  5.0,    0.5,   5.0],
  'gpt-5.5-rosalind':             [12.50, 75.0,  12.50,  1.25,  12.50],
  'gpt-5.5-pro':                  [30.0,  180.0, 30.0,   3.0,   30.0],
  'gpt-5.5':                      [5.0,   30.0,  5.0,    0.5,   5.0],
  'gpt-5-codex':                  [1.25,  10.0,  1.25,   0.125, 1.25],
  'gpt-5.2':                      [1.75,  14.0,  1.75,   0.175, 1.75],
  'gpt-5.1':                      [1.25,  10.0,  1.25,   0.125, 1.25],
  'gpt-5':                        [1.25,  10.0,  1.25,   0.125, 1.25],
  'o4-mini':                      [1.1,   4.4,   1.1,    0.275, 1.1],
  // Codex's internal auto-review pass runs on a small model; treat as Luna-class.
  'codex-auto-review':            [0.2,   1.2,   0.2,    0.02,  0.2],
};
// Unknown model → Sonnet-class rates. A middle-ground guess: over-quotes a
// Haiku miss, under-quotes an Opus miss. `--stats` prints unpriced model ids
// so a new family shows up as something to add rather than silently skewing
// the total.
const DEFAULT_PRICING = [3.0, 15.0, 3.75, 0.3, 6.0];

function priceFor(model) {
  if (typeof model !== 'string' || !model) return DEFAULT_PRICING;
  const m = model.toLowerCase();
  // Longest key first so "gpt-5-codex" wins over "gpt-5".
  const keys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (m.includes(key)) return MODEL_PRICING[key];
  }
  return DEFAULT_PRICING;
}

// True when the model id matched no pricing row and therefore fell back to
// DEFAULT_PRICING. Surfaced by `--stats` so a newly-shipped model family is
// visible as "add me to the table" instead of quietly skewing the cost.
function isPriced(model) {
  if (typeof model !== 'string' || !model) return false;
  const m = model.toLowerCase();
  return Object.keys(MODEL_PRICING).some((key) => m.includes(key));
}

// Full-billing cost for one bucket. Unlike the old agent — which priced
// only input+output and therefore under-reported by the entire cache and
// reasoning bill — this charges every category at its own rate:
//   fresh input, output(+reasoning), 5m cache write, 1h cache write, cache read
function bucketCostUsd(b) {
  const [pIn, pOut, pWrite5m, pRead, pWrite1h] = priceFor(b.model);
  // Reasoning tokens bill as output. kaboo keeps them in a separate column
  // for analytics but prices them at the output rate.
  const outputBillable = (b.outputTokens || 0) + (b.reasoningOutputTokens || 0);
  // Prefer the per-tier split; fall back to the undifferentiated counter.
  let w5 = b.cacheWrite5m || 0;
  let w1 = b.cacheWrite1h || 0;
  if (w5 + w1 === 0) w5 = b.cacheCreationInputTokens || 0;
  return (
    ((b.inputTokens || 0) / 1e6) * pIn +
    (outputBillable / 1e6) * pOut +
    (w5 / 1e6) * pWrite5m +
    (w1 / 1e6) * pWrite1h +
    ((b.cachedInputTokens || 0) / 1e6) * pRead
  );
}

// ── daily rollup ──────────────────────────────────────────────────────
// Collapse half-hour buckets into the per-day shape the Worker stores.
// Keeps per-model and per-project breakdowns as nested maps so the Worker
// can hold detail while the public projection stays a summary.
function dailyRollup(buckets, sessions, toolCalls = []) {
  const days = new Map();

  const ensureDay = (date) => {
    if (!days.has(date)) {
      days.set(date, {
        date,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        costCents: 0,
        sessions: 0,
        activeSeconds: 0,
        durationSeconds: 0,
        messageCount: 0,
        userMessageCount: 0,
        promptHours: new Array(24).fill(0),
        promptWeekHours: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        bySource: {},
        byModel: {},
        byProject: {},
        // Fixed-vocabulary tool tally. Categories only — never a tool name.
        toolCounts: emptyToolCounts(),
        _costUsd: 0,
      });
    }
    return days.get(date);
  };

  const addDim = (holder, name, b, costUsd) => {
    if (!name) return;
    if (!holder[name]) {
      holder[name] = {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        costCents: 0,
        _costUsd: 0,
      };
    }
    const h = holder[name];
    h.inputTokens += b.inputTokens || 0;
    h.outputTokens += b.outputTokens || 0;
    h.cachedInputTokens += b.cachedInputTokens || 0;
    h.cacheCreationInputTokens += b.cacheCreationInputTokens || 0;
    h.reasoningOutputTokens += b.reasoningOutputTokens || 0;
    h.totalTokens += b.totalTokens || 0;
    h._costUsd += costUsd;
  };

  for (const b of buckets) {
    const date = b.bucketStart.slice(0, 10);
    const day = ensureDay(date);
    const costUsd = bucketCostUsd(b);

    day.inputTokens += b.inputTokens || 0;
    day.outputTokens += b.outputTokens || 0;
    day.cachedInputTokens += b.cachedInputTokens || 0;
    day.cacheCreationInputTokens += b.cacheCreationInputTokens || 0;
    day.reasoningOutputTokens += b.reasoningOutputTokens || 0;
    day.totalTokens += b.totalTokens || 0;
    day._costUsd += costUsd;

    addDim(day.bySource, b.source, b, costUsd);
    addDim(day.byModel, b.model, b, costUsd);
    addDim(day.byProject, b.project, b, costUsd);
  }

  // Sessions attach to the day of their FIRST message, matching kaboo's
  // bucket_date = DATE_TRUNC('day', MIN(first_message_at)).
  for (const s of sessions) {
    const date = s.firstMessageAt.slice(0, 10);
    const day = ensureDay(date);
    day.sessions += 1;
    day.activeSeconds += s.activeSeconds || 0;
    day.durationSeconds += s.durationSeconds || 0;
    day.messageCount += s.messageCount || 0;
    day.userMessageCount += s.userMessageCount || 0;
    if (Array.isArray(s.userPromptHours)) {
      for (let h = 0; h < 24; h++) day.promptHours[h] += s.userPromptHours[h] || 0;
    }
    if (Array.isArray(s.userPromptWeekHours)) {
      for (let d = 0; d < 7; d++) {
        const row = s.userPromptWeekHours[d];
        if (!Array.isArray(row)) continue;
        for (let h = 0; h < 24; h++) day.promptWeekHours[d][h] += row[h] || 0;
      }
    }
  }

  /* Tool calls land on the day they happened, in LOCAL time — the same
     convention as promptHours, because the question these answer ("what
     kind of work was I doing on Tuesday") is a local-time question.

     Dedup happens here rather than in the parser: forked Claude sessions
     replay the parent's tool_use blocks verbatim, so the raw list contains
     duplicates that would inflate every category. */
  const seenTool = new Set();
  for (const t of toolCalls) {
    if (!t || !t.timestamp) continue;
    if (t.dedupKey) {
      if (seenTool.has(t.dedupKey)) continue;
      seenTool.add(t.dedupKey);
    }
    const d = t.timestamp;
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    const day = ensureDay(date);
    const cat = Object.prototype.hasOwnProperty.call(day.toolCounts, t.category)
      ? t.category
      : 'other';
    day.toolCounts[cat] += 1;
    if (t.mcp) day.toolCounts.mcp += 1;
  }

  // Fix up cost to integer cents at the very end so rounding happens once.
  for (const day of days.values()) {
    day.costCents = Math.round(day._costUsd * 100);
    delete day._costUsd;
    for (const holder of [day.bySource, day.byModel, day.byProject]) {
      for (const name of Object.keys(holder)) {
        holder[name].costCents = Math.round(holder[name]._costUsd * 100);
        delete holder[name]._costUsd;
      }
    }
  }

  return days;
}

// ── the headline "tokens" number ──────────────────────────────────────
// One definition, shared by every surface that shows a token count, so the
// site, the menu bar and the CLI can never drift apart.
//
// Matches kaboo's cli/export_cmd.go:
//     TotalTokens = Input + Output + CachedInput + CacheCreationInput
//                 + ReasoningOutput
//
// Cache reads belong in the total. kaboo learned this the hard way -- their
// migration 000006 notes that leaving cache_read out made the dashboard
// understate reality "by 5-100x" while the cost column, which always priced
// cache_read, kept climbing. Claude Code replays the whole conversation each
// turn, so for this workload cache_read is the majority of real volume (~55%
// here).
//
// The fallback is the part that matters for correctness. Rows written by the
// v1 CLI (the old laptop, 2026-05-01..06-20) carry no detail block at all, so
// totalTokens is 0 while `tokens` holds a real input+output figure. Reading
// totalTokens blindly would silently render those 40 days as zero and erase
// that machine's history from the chart -- a wrong answer that looks like a
// working page. Those days stay on the old basis; they are understated
// relative to newer days, which is visible and honest, rather than absent.
function headlineTokens(day) {
  if (!day) return 0;
  const total = Number(day.totalTokens) || 0;
  if (total > 0) return total;
  const legacy = Number(day.tokens) || 0;
  if (legacy > 0) return legacy;
  // Neither field present: derive what we can rather than reporting nothing.
  return (Number(day.inputTokens) || 0) + (Number(day.outputTokens) || 0);
}

// True when this row predates the detail block, i.e. headlineTokens had to
// fall back. Callers use it to label the older span rather than pretend the
// two spans are measured the same way.
function isLegacyBasis(day) {
  return !!day && !(Number(day.totalTokens) > 0) && (Number(day.tokens) || 0) > 0;
}

module.exports = {
  dedupeEntries,
  dedupeEvents,
  roundToHalfHour,
  aggregateToBuckets,
  extractSessions,
  dailyRollup,
  bucketCostUsd,
  priceFor,
  isPriced,
  MODEL_PRICING,
  DEFAULT_PRICING,
  TOKEN_FIELDS,
  headlineTokens,
  isLegacyBasis,
};
