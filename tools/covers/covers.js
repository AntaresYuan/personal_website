#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   tools/covers/covers.js — draws the diagram covers of the projects:
   five columns (problem → metrics), two tracks, the "My work" and
   "Metrics" columns grouped.

     node tools/covers/covers.js              # every cover below
     node tools/covers/covers.js roundtable   # one

   Writes media/projects/<slug>/cover.svg, and cover.zh.svg from the
   Chinese words in content/zh/covers.json (same layout; each list is
   matched to the English one by position). The SVG is inlined into the page
   (scripts/lib/projects.js → coverBox), so it takes the page's fonts and
   theme tokens and swaps with light/dark. Its one colour is the project's
   --hue (an OKLCH hue angle, set on the cover box from the project's `hue`):
   the accent track, "My work" and the key figures take it; the second track
   stays neutral. The <style> is byte-identical in every cover, so two
   covers on one page never fight.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const W = 1200, H = 480;
const NW = 188, NH = 128, R = 20;          // node
const PAD = 12, PR = R + PAD;             // group panel: concentric radius
const X = [34, 258, 482, 718, 966];       // node x per column
const RY = [104, 256];                    // node y per row
const cx = (c) => X[c] + NW / 2;

const COVERS = {
  'agentic-hiring': {
    label: 'Agentic hiring: from the unmet needs to the agent-quality metrics',
    cols: [['Problem', 'Needs unmet'], ['Scenario', 'Person × role'], ['Product', 'TA workbench'], ['My work', 'On the agent', true], ['Metrics', 'Agent quality']],
    nodes: [
      [0, 0, 'a', 'Efficiency', ['Concurrency,', 'pipeline flow']],
      [1, 0, 'a', 'Supply', ['Large, fresh', 'talent pool']],
      [2, 0, 'a', 'Infrastructure', ['Supply, funnel,', 'intake, booking']],
      [3, 0, 'b', 'UX iteration', ['Preset prompts', 'from feedback']],
      [4, 0, 'b', 'Coverage', ['Missed', 'candidates']],
      [0, 1, 'b', 'Quality', ['Depends on', 'TA expertise']],
      [1, 1, 'b', 'Role needs', ['Who the role', 'really needs']],
      [2, 1, 'b', 'Agentic Hiring', ['Clarify, recall,', 'evaluate, rank']],
      [3, 1, 'b', 'Optimization', ['Bad-case', 'attribution']],
      [4, 1, 'b', 'Accuracy', ['Pass rate', '21% → <tspan class="pc-k">25%</tspan>']],
    ],
    arrows: [['row', 0, 0], ['row', 0, 1], ['row', 1, 0], ['row', 1, 1], ['in', 1], ['groups']],
    legend: [['a', 'Efficiency track'], ['b', 'Quality track']],
  },
  'roundtable': {
    label: 'Roundtable: from orchestration by hand to agents that decompose the task',
    cols: [['Problem', 'Users orchestrate'], ['Scenario', 'Task decomposition'], ['Product', 'Roundtable'], ['My work', 'On decomposition', true], ['Metrics', 'Decomposition quality']],
    nodes: [
      [0, 0, 'a', 'High barrier', ['Users split, assign', 'and sequence']],
      [1, 0, 'a', 'Newcomers', ['don’t know how', 'to split a task']],
      [2, 0, 'a', 'Agents split', ['workflow → plan', '→ PM Agent tasks']],
      [3, 0, 'a', 'Recommender', ['metadata, evals,', 'few-shot']],
      [4, 0, 'a', 'Entry accuracy', ['Seed 2.0 Pro', '16 → <tspan class="pc-k">28</tspan> of 30']],
      [0, 1, 'b', 'Poor reuse', ['good flows are', 'rebuilt each time']],
      [1, 1, 'b', 'Experts', ['split well, then', 'redo it every time']],
      [2, 1, 'b', 'Templates', ['save, edit and', 'reuse workflows']],
      [3, 1, 'b', 'Visual editor', ['and template', 'marketplace']],
      [4, 1, 'b', 'Reuse · next', ['tasks started', 'from a template']],
    ],
    arrows: [['row', 0, 0], ['row', 0, 1], ['in', 0], ['row', 1, 0], ['row', 1, 1], ['in', 1], ['groups']],
    legend: [['a', 'Decomposition track'], ['b', 'Reuse track']],
  },
  'lark-loom': {
    label: 'Lark Loom: from context scattered in chat to structured memory and targeted recall',
    cols: [['Problem', 'Context stuck in IM'], ['Scenario', 'Chat is fragmented'], ['Product', 'Lark Loom'], ['My work', 'On memory and models', true], ['Metrics', 'Quality and speed']],
    nodes: [
      [0, 0, 'a', 'Context in IM', ['needs, decisions,', 'owners: all in chat']],
      [1, 0, 'a', 'Storage', ['days of messages,', 'small talk mixed in']],
      [2, 0, 'a', 'Memory', ['chat kept as', 'structured notes']],
      [3, 0, 'a', 'Store & select', ['Lite extracts;', 'keyword + task recall']],
      [4, 0, 'a', 'Pass rate', ['60-case eval', '65% → <tspan class="pc-k">80%</tspan>']],
      [0, 1, 'b', 'Unusable', ['models can’t', 'consume the chat']],
      [1, 1, 'b', 'Selection', ['relevant, complete,', 'clean context']],
      [2, 1, 'b', 'Skills', ['docs, tables, slides', 'from recalled context']],
      [3, 1, 'b', 'Tiered models', ['Lite prepares,', 'Pro reasons']],
      [4, 1, 'b', 'Response time', ['per task', '95s → <tspan class="pc-k">50s</tspan>']],
    ],
    arrows: [['row', 0, 0], ['row', 0, 1], ['in', 0], ['row', 1, 0], ['row', 1, 1], ['in', 1], ['groups']],
    legend: [['a', 'Context track'], ['b', 'Generation track']],
  },
  'susbench': {
    label: 'SusBench: do dark patterns built to fool people fool computer-use agents too?',
    cols: [['Question', 'Do agents fall for it?'], ['Challenge', 'Control vs. realism'], ['Method', 'SusBench'], ['My work', 'On the benchmark', true], ['Findings', 'Agents vs. people']],
    nodes: [
      [0, 0, 'a', 'Dark patterns', ['designs built to', 'mislead people']],
      [1, 0, 'a', 'Controllable', ['where it appears,', 'which type it is']],
      [2, 0, 'a', 'Code injection', ['9 types, on 55', 'real websites']],
      [3, 0, 'a', 'Eval framework', ['inject, run, judge;', '5 agents, one setup']],
      [4, 0, 'a', 'Same weak spots', ['Preselection, Trick', 'Wording, Hidden Info']],
      [0, 1, 'b', 'Agents act', ['on real interfaces,', 'for their users']],
      [1, 1, 'b', 'Realistic', ['or the results', 'won’t transfer']],
      [2, 1, 'b', 'User study', ['29 people; most', 'never noticed']],
      [3, 1, 'b', 'Test cases', ['goal, step, misstep:', '<tspan class="pc-k">313</tspan> tasks']],
      [4, 1, 'b', 'Overt ones', ['people and agents', 'both resist them']],
    ],
    arrows: [['row', 0, 0], ['row', 0, 1], ['in', 0], ['row', 1, 0], ['row', 1, 1], ['in', 1], ['groups']],
    legend: [['a', 'Control track'], ['b', 'Realism track']],
  },
  'kaboo': {
    label: 'Kaboo: token analysis inside ByteDance, built by one owner from problem to production',
    cols: [['Project', 'Token analysis'], ['Way of work', 'One owner, end to end'], ['Infrastructure', 'mew, in Lark'], ['My work', 'On token efficiency', true], ['Result', 'In production']],
    nodes: [
      [0, 0, 'a', 'Kaboo', ['open source,', 'inside ByteDance']],
      [1, 0, 'a', 'No relay', ['raise it, solve it,', 'test it, ship it']],
      [2, 0, 'a', 'mew', ['agents built into', 'the dev process']],
      [3, 0, 'a', 'The problem', ['tasks that succeed', 'but waste tokens']],
      [4, 0, 'a', 'Shipped', ['tested and', 'deployed by me']],
      [0, 1, 'b', 'Token use', ['where the tokens', 'go, and why']],
      [1, 1, 'b', 'Two safeguards', ['agent review first,', 'rollback after']],
      [2, 1, 'b', 'In Lark', ['the path from idea', 'to release, paved']],
      [3, 1, 'b', 'The fix', ['5 waste criteria,', 'Effective Tokens']],
      [4, 1, 'b', 'Reach', ['<tspan class="pc-k">10K+</tspan> internal', 'users']],
    ],
    arrows: [['row', 0, 0], ['row', 0, 1], ['in', 0], ['row', 1, 0], ['row', 1, 1], ['in', 1], ['groups']],
    legend: [['a', 'How we work'], ['b', 'What I built']],
  },
};

const FONT = 'var(--font, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif)';
const DISPLAY = 'var(--font-display, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", sans-serif)';

// Rules shared by every cover — byte-identical, so a page with two covers
// carries two copies of the same thing.
const SHARED = `.pc { --pc-h: var(--hue, 262);
  --pc-glass: rgba(255,255,255,.62); --pc-group: rgba(255,255,255,.3); --pc-dash: rgba(29,29,31,.22);
  --pc-ink: var(--text, #1D1D1F); --pc-ink-2: var(--text-2, #4F4F55); --pc-ink-3: var(--text-3, #6E6E73);
  --pc-a: oklch(0.48 0.18 var(--pc-h)); --pc-a-tint: oklch(0.64 0.18 var(--pc-h) / .15); --pc-a-line: oklch(0.56 0.17 var(--pc-h) / .44);
  --pc-b-line: rgba(0,0,0,.1);
  font-family: ${FONT}; }
:root[data-theme="dark"] .pc { --pc-glass: rgba(255,255,255,.045); --pc-group: rgba(255,255,255,.02); --pc-dash: rgba(255,255,255,.2);
  --pc-a: oklch(0.85 0.13 var(--pc-h)); --pc-a-tint: oklch(0.62 0.16 var(--pc-h) / .25); --pc-a-line: oklch(0.78 0.14 var(--pc-h) / .46);
  --pc-b-line: rgba(255,255,255,.13); }
.pc text { text-anchor: middle; }
.pc-h { font: 600 21px ${DISPLAY}; letter-spacing: -.01em; fill: var(--pc-ink); }
.pc-h.pc-me { fill: var(--pc-a); }
.pc-hs { font-size: 15.5px; fill: var(--pc-ink-2); }
.pc-g { fill: var(--pc-group); stroke: var(--pc-dash); stroke-width: 1.5; stroke-dasharray: 5 7; }
.pc-b { fill: var(--pc-glass); }
.pc-c { stroke-width: 1.5; }
.pc-ta .pc-c { fill: var(--pc-a-tint); stroke: var(--pc-a-line); }
.pc-tb .pc-c { fill: none; stroke: var(--pc-b-line); }
.pc-t { font: 600 22px ${DISPLAY}; letter-spacing: -.015em; }
.pc-ta .pc-t { fill: var(--pc-a); }
.pc-tb .pc-t { fill: var(--pc-ink); }
.pc-s { font-size: 16px; fill: var(--pc-ink-2); }
.pc-k { font-weight: 700; fill: var(--pc-a); }
.pc-a { fill: none; stroke: var(--pc-ink-3); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.pc-l { text-anchor: start !important; font-size: 15px; fill: var(--pc-ink-2); }`;

// Legend labels sit in a row, so their widths are estimated: a Han
// character is about as wide as the 15px font, a Latin one about half.
const textWidth = (s) => [...s].reduce((w, ch) => w + (/[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 15 : 8.2), 0);

function draw(slug, cfg, file = 'cover.svg') {
  const scope = `pc-${slug}`;

  const arrow = (x1, x2, y) =>
    `<path class="pc-a" d="M${x1} ${y}H${x2}M${x2 - 6} ${y - 5.5}L${x2} ${y}L${x2 - 6} ${y + 5.5}"/>`;
  const mid = (r) => RY[r] + NH / 2;

  const L = [];
  L.push(`<svg xmlns="http://www.w3.org/2000/svg" class="pc ${scope}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${cfg.label}">`);
  L.push(`<!-- ${slug} cover, drawn by tools/covers/covers.js — edit that, not this. -->`);
  L.push(`<style>\n${SHARED}\n</style>`);

  L.push('<!-- column heads -->');
  cfg.cols.forEach(([h, s, me], c) => {
    L.push(`<text class="pc-h${me ? ' pc-me' : ''}" x="${cx(c)}" y="46">${h}</text><text class="pc-hs" x="${cx(c)}" y="70">${s}</text>`);
  });

  L.push('<!-- groups: my work, metrics -->');
  const gy = RY[0] - PAD, gh = RY[1] + NH + PAD - gy;
  [3, 4].forEach((c) => L.push(`<rect class="pc-g" x="${X[c] - PAD}" y="${gy}" width="${NW + 2 * PAD}" height="${gh}" rx="${PR}"/>`));

  L.push('<!-- nodes -->');
  cfg.nodes.forEach(([c, r, t, title, sub]) => {
    const x = X[c], y = RY[r];
    L.push(`<g class="pc-t${t}"><rect class="pc-b" x="${x}" y="${y}" width="${NW}" height="${NH}" rx="${R}"/><rect class="pc-c" x="${x}" y="${y}" width="${NW}" height="${NH}" rx="${R}"/>` +
      `<text class="pc-t" x="${cx(c)}" y="${y + 44}">${title}</text>` +
      sub.map((s, i) => `<text class="pc-s" x="${cx(c)}" y="${y + 75 + i * 22}">${s}</text>`).join('') + '</g>');
  });

  L.push('<!-- arrows -->');
  for (const [kind, r, c] of cfg.arrows) {
    if (kind === 'row') L.push(arrow(X[c] + NW + 6, X[c + 1] - 6, mid(r)));
    if (kind === 'in') L.push(arrow(X[2] + NW + 6, X[3] - PAD - 4, mid(r)));
    if (kind === 'groups') L.push(arrow(X[3] + NW + PAD + 5, X[4] - PAD - 5, (mid(0) + mid(1)) / 2));
  }

  L.push('<!-- legend -->');
  let lx = 34;
  for (const [t, label] of cfg.legend) {
    L.push(`<g class="pc-t${t}"><rect class="pc-b" x="${lx}" y="426" width="16" height="16" rx="5"/><rect class="pc-c" x="${lx}" y="426" width="16" height="16" rx="5"/></g><text class="pc-l" x="${lx + 26}" y="439">${label}</text>`);
    lx = Math.round((lx + 26 + textWidth(label) + 34) * 10) / 10;
  }
  L.push('</svg>');

  const out = path.join(ROOT, 'media', 'projects', slug, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, L.join('\n') + '\n');
  console.log(`✓ wrote ${path.relative(ROOT, out)}`);
}

// The Chinese cover: the English layout with the words from content/zh/covers.json.
const ZH_FILE = path.join(ROOT, 'content', 'zh', 'covers.json');
const ZH = fs.existsSync(ZH_FILE) ? JSON.parse(fs.readFileSync(ZH_FILE, 'utf8')) : {};
const inChinese = (cfg, zh) => ({
  ...cfg,
  label: zh.label ?? cfg.label,
  cols: cfg.cols.map(([h, s, me], i) => [zh.cols?.[i]?.[0] ?? h, zh.cols?.[i]?.[1] ?? s, me]),
  nodes: cfg.nodes.map(([c, r, t, title, sub], i) => [c, r, t, zh.nodes?.[i]?.[0] ?? title, zh.nodes?.[i]?.[1] ?? sub]),
  legend: cfg.legend.map(([t, label], i) => [t, zh.legend?.[i] ?? label]),
});

const only = process.argv[2];
for (const [slug, cfg] of Object.entries(COVERS)) {
  if (only && only !== slug) continue;
  draw(slug, cfg);
  if (ZH[slug]) draw(slug, inChinese(cfg, ZH[slug]), 'cover.zh.svg');
}
