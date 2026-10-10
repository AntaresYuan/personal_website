#!/usr/bin/env node
/* Render /usage/, the full AI-usage dashboard, on the shared Work shell.

   Charts are drawn by scripts/usage-page.js with inline SVG and no charting
   library. Visibility is data-driven: private dimensions appear only when
   the Worker publishes them, or when the owner unlocks /detail with a bearer
   kept in sessionStorage for the current tab. */
'use strict';
const fs = require('fs');
const path = require('path');
const { escapeHtml: e } = require('./lib/blog');
const shell = require('./lib/work-shell');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const site = read('content/site.json');
const profile = read('content/profile.json');
const SITE_URL = (site.meta?.url ?? 'https://example.com').replace(/\/$/, '');
const AUTHOR = [profile.name, profile.nameAccent].filter(Boolean).join(' ') || site.meta?.siteName || 'Antares Yuan';

const card = (id, title, note) => `      <section class="ucard" id="ucard-${id}" hidden>
        <header class="ucard-head">
          <h2 class="ucard-title">${e(title)}</h2>
          ${note ? `<p class="ucard-note">${e(note)}</p>` : ''}
        </header>
        <div class="ucard-body" id="uchart-${id}"></div>
        <p class="ucard-caption" id="ucap-${id}" hidden></p>
      </section>`;

const REPO_URL = 'https://github.com/AntaresYuan/personal_website';
const cmd = (value, label) => `        <button class="ucli-cmd" type="button" data-copy="${e(value)}"${label ? ` aria-label="${e(label)}"` : ''}><code><span class="ucli-dollar">$</span> ${e(value)}</code><span class="ucli-copy" aria-hidden="true">copy</span></button>`;

const cliSection = () => `  <section class="usage-cli" id="usage-cli">
    <h2 class="usage-cli-title">Add a device</h2>
    <p class="usage-cli-lead">These numbers come from a small agent that reads local
      Claude Code and Codex transcripts and posts daily totals here. It's multi-device:
      each machine owns its own slot, so several Macs merge instead of overwriting.</p>

    <div class="ucli-oneline">
${cmd('curl -fsSL https://antaresyuan.site/install.sh | sh', 'install command')}
      <p class="ucli-note">Downloads just the agent into
        <code>~/.local/share/antares-usage</code>, adds an <code>antares-usage</code>
        command, then walks through setup. It detects installed tools, pins the
        device slot, validates the shared bearer and shows a local dry run before
        uploading anything. Re-running the installer is safe.</p>
    </div>

    <p class="usage-cli-after">Then, any time:</p>
    <ul class="ucli-cmds">
      <li>${cmd('antares-usage stats')}<span class="ucli-inline-note">local breakdown, no network</span></li>
      <li>${cmd('antares-usage doctor')}<span class="ucli-inline-note">check config, secret and endpoint</span></li>
      <li>${cmd('antares-usage sync')}<span class="ucli-inline-note">upload the latest totals now</span></li>
    </ul>

    <p class="usage-cli-foot">Needs macOS (keychain + launchd) and Node. The bearer is
      intentionally not on this page. Read it from a machine that already syncs with
      <code>security find-generic-password -a "$USER" -s antares-sync-usage -w</code>.
      Only token counts, timings and cost leave the machine; prompt and code content
      never do. <a href="${REPO_URL}/blob/main/docs/usage-sync.md">Full setup notes →</a></p>
  </section>`;

const main = `  <section class="usage-page-head">
    <header class="page-head">
      <div>
        <p class="usage-page-kicker">Personal telemetry</p>
        <h1 class="page-title">AI usage, in full</h1>
        <p class="page-sub">The complete view behind the homepage snapshot — how often I build with coding agents, when the work happens, and what shape it takes.</p>
      </div>
      <a class="pill-link" href="/#usage">Back home</a>
    </header>
    <p class="usage-page-privacy">Collected automatically from local Claude Code and Codex transcripts on ${e(AUTHOR)}'s machines. Token counts and timings only; prompt and code content never leave the device.</p>
    <div class="usage-page-summary" id="usage-page-summary"></div>
    <p class="usage-page-state" id="usage-page-state">Loading…</p>
  </section>

  <div class="usage-page-grid">
${card('calendar', 'Daily activity', 'One cell per day. Darker = more tokens.')}
${card('mix', 'Token mix', 'Fresh input vs cache reads vs output vs reasoning.')}
${card('rhythm', 'Working rhythm', 'Prompts by local weekday and hour — when the work actually happens.')}
${card('trend', 'Weekly trend', 'Total tokens per week, with a 4-week average.')}
${card('hours', 'Hour of day', 'Prompts per local hour, all days combined.')}
${card('weekday', 'Day of week', 'Prompt share by weekday.')}
${card('sessions', 'Session shape', 'Active minutes and message counts per day.')}
${card('tools', 'Tool mix', 'What the work consisted of — reading, editing, shelling out. Categories only; no tool or server names are collected.')}
${card('source', 'By tool', 'Which coding agent produced the tokens.')}
${card('model', 'By model', 'Private unless published — unlock below to view.')}
${card('project', 'By project', 'Private unless published — unlock below to view.')}
  </div>

  <section class="usage-unlock">
    <details class="usage-unlock-box">
      <summary class="usage-unlock-summary">Owner view</summary>
      <p class="usage-unlock-note">Paste the sync bearer token to load the private
        <code>/detail</code> feed (per-model and per-project breakdowns). It stays in
        this tab's <code>sessionStorage</code> and is sent only to the usage Worker.</p>
      <form class="usage-unlock-form" id="usage-unlock-form" autocomplete="off">
        <input class="usage-unlock-input" id="usage-unlock-input" type="password"
               placeholder="bearer token" aria-label="Bearer token" spellcheck="false">
        <button class="usage-unlock-btn" type="submit">unlock</button>
        <button class="usage-unlock-btn usage-unlock-clear" type="button" id="usage-unlock-clear">clear</button>
      </form>
      <p class="usage-unlock-state" id="usage-unlock-state" hidden></p>
    </details>
  </section>

${cliSection()}`;

const html = shell.pageHtml({
  title: 'AI usage',
  description: `Full AI-coding usage dashboard for ${AUTHOR} — tokens, cost, working rhythm and per-tool breakdowns, updated automatically.`,
  canonical: `${SITE_URL}/usage/`,
  active: 'home',
  bodyClass: 'usage-page-body',
  main,
  styles: ['styles/usage-work.css'],
  scripts: [
    ...(site.analytics?.featureBeacon === true ? ['scripts/beacon.js'] : []),
    'scripts/usage-page.js',
  ],
});

const outDir = path.join(root, 'usage');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`✓ wrote usage/         (full dashboard, ${html.length} bytes)`);
