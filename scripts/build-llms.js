#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-llms.js — generate /llms.txt and /llms-full.txt from content/*.json
   Per the llmstxt.org spec: a short summary file + a full content dump,
   both at the site root, both plain text, both meant to be read by LLM
   agents that want a deterministic view of the site.

   Run:    node scripts/build-llms.js
   Output: ./llms.txt + ./llms-full.txt (gitignored — committed only after
           you've reviewed the output once)
   ════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const site    = read('content/site.json');
const profile = read('content/profile.json');
const board   = read('content/board.json');
const lens    = read('content/lens.json');
const contact = read('content/contact.json');
const lastUpdated = require('./last-updated');   // pinned (site.json) or auto (last-commit date)

/* ── Helpers ──────────────────────────────────────────────────────────── */
const STATUS_PREFIX = { shipped: 'SHIP', now: 'NOW', next: 'NEXT', later: 'LATER' };
const pad2 = (n) => String(n).padStart(2, '0');

const allCards = () => {
  const cards = (board.cards ?? []).slice().sort((a, b) => {
    const ao = a.order ?? 99, bo = b.order ?? 99;
    if (ao !== bo) return ao - bo;
    return (b.updated ?? '').localeCompare(a.updated ?? '');
  });
  const cols = ['shipped', 'now', 'next', 'later'];
  const out = [];
  cols.forEach((col) => {
    cards.filter(c => c.status === col).forEach((c, i) => {
      out.push({ ...c, displayId: `${STATUS_PREFIX[col]}-${pad2(i + 1)}` });
    });
  });
  return out;
};

const stripTags = (s) => String(s ?? '').replace(/<\/?(em|strong|br)\s*\/?>/gi, '');

/* ── llms.txt — short summary (per llmstxt.org spec) ──────────────────── */
const short = `# ${site.meta?.title ?? 'Personal site'}

> ${stripTags(site.meta?.description ?? '')}

${profile.slogan ?? ''}

## Identity
- Name: ${profile.name} ${profile.nameAccent ?? ''}
- Role: ${profile.role}
- Location: ${profile.location}
- Status: ${profile.status}
- Tags: ${(profile.tags ?? []).join(', ')}

## Sections
- [Roadmap board](/#shipped): four-column kanban — shipped, now, next, later
- [Agent terminal](/#terminal): interactive CLI — same data as the board
- [Lens](/#lens): how I think
- [Contact](/#contact): how to reach me
- [Full content](/llms-full.txt): every card + lens entry + contact, plain text

## Edit
This site is content-managed via Decap CMS at /admin/. Source: github.com/AntaresYuan/personal_website
`;

/* ── llms-full.txt — every card + lens + contact ──────────────────────── */
const fmtCard = (c) => {
  const lines = [
    `## ${c.displayId} · ${c.status.toUpperCase()} · ${c.title}`,
    c.summary ? `${c.summary}` : '',
    c.impact  ? `Impact: ${c.impact}` : '',
    (c.tags ?? []).length ? `Tags: ${c.tags.join(', ')}` : '',
    c.updated ? `Updated: ${c.updated}` : '',
  ].filter(Boolean);
  if ((c.links ?? []).length) {
    lines.push('Links:');
    c.links.filter(l => l.href && l.href !== '#').forEach((l) => lines.push(`  - ${l.label}: ${l.href}`));
  }
  if (c.details) {
    lines.push('');
    lines.push(c.details.trim());
  }
  return lines.join('\n');
};

const cards = allCards();
const byStatus = (s) => cards.filter(c => c.status === s);
const sectionFor = (label, status) => {
  const list = byStatus(status);
  if (list.length === 0) return '';
  return `\n# ${label}\n\n${list.map(fmtCard).join('\n\n')}`;
};

const full = `# ${site.meta?.title ?? 'Personal site'}

${profile.slogan ?? ''}
${profile.manifesto ? `\n${profile.manifesto}\n` : ''}
Name: ${profile.name} ${profile.nameAccent ?? ''}
Role: ${profile.role}
Location: ${profile.location}
Tags: ${(profile.tags ?? []).join(', ')}
${sectionFor('Shipped', 'shipped')}${sectionFor('Now', 'now')}${sectionFor('Next', 'next')}${sectionFor('Later', 'later')}

# Lens — how I think

${(lens.items ?? []).map(it => `- ${it.num ?? ''} ${it.main ?? ''}\n  ${it.aside ?? ''}`).join('\n')}

# Contact

${stripTags(contact.intro ?? '')}

${(contact.items ?? []).map(it => `- ${it.key}: ${it.label} (${it.href})`).join('\n')}

---
Generated ${new Date().toISOString().slice(0, 10)} from content/*.json. Last site update: ${lastUpdated}
`;

/* ── Write ────────────────────────────────────────────────────────────── */
// Footer noting the file is generated, placed after content so it doesn't
// interfere with the llmstxt.org top-of-file conventions.
const footer = `\n\n---\nGenerated from content/*.json. To update: edit the JSON (or via /admin/) and run \`node scripts/build.js\`.\n`;

fs.writeFileSync(path.join(root, 'llms.txt'),      short + footer);
fs.writeFileSync(path.join(root, 'llms-full.txt'), full  + footer);

const sz = (p) => fs.statSync(path.join(root, p)).size;
console.log(`✓ wrote llms.txt       (${sz('llms.txt')} bytes)`);
console.log(`✓ wrote llms-full.txt  (${sz('llms-full.txt')} bytes)`);
