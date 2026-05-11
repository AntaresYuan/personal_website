#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-agent-brief.js — compile content/agent-brief.json → agent-brief.txt

   This is the "private knowledge" feed for the `ask` assistant (workers/qa/):
   notes you write in the CMS ("Assistant knowledge") that should make the
   assistant's picture of you fuller, but that you don't want rendered on the
   public page. The Worker fetches /agent-brief.txt and appends it to the
   site content it uses as grounding context.

   Note: agent-brief.txt is a deployed static file, so it's technically
   fetchable by URL (it just isn't linked from anywhere). It's "off the
   site," not "secret" — keep that in mind for what you put in it.

   Run:    node scripts/build-agent-brief.js   (or, with everything: node scripts/build.js)
   Output: ./agent-brief.txt  (empty when there are no notes)
   ════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outPath = path.join(root, 'agent-brief.txt');

let notes = [];
try {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'content/agent-brief.json'), 'utf8'));
  notes = Array.isArray(data && data.notes) ? data.notes : [];
} catch (_) { /* missing / unreadable — treat as empty */ }

const usable = notes.filter((n) => n && (String(n.title || '').trim() || String(n.body || '').trim()));

let out = '';
if (usable.length) {
  out = `# Background notes — supplemental, written by Antares for the "ask" assistant; not shown on the public site.\n\n`
    + usable.map((n) => {
        const title = String(n.title || '').trim();
        const body = String(n.body || '').trim();
        return (title ? `## ${title}\n` : '') + body;
      }).join('\n\n')
    + '\n';
}

fs.writeFileSync(outPath, out);
console.log(`✓ wrote agent-brief.txt (${out.length} bytes, ${usable.length} note${usable.length === 1 ? '' : 's'})`);
