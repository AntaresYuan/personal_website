#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-agent-brief.js — compile content/assistant/ → agent-brief.txt

   This is the "private knowledge" feed for the `ask` assistant (workers/qa/):
   This compatibility artifact contains all owner-managed Assistant context:
   the reply guide, FAQ answers and background knowledge. The normal Worker
   path uses /ask-index.json; /agent-brief.txt backs up the fallback path.

   Note: agent-brief.txt is a deployed static file, so it's technically
   fetchable by URL (it just isn't linked from anywhere). It's "off the
   site," not "secret" — keep that in mind for what you put in it.

   Run:    node scripts/build-agent-brief.js   (or, with everything: node scripts/build.js)
   Output: ./agent-brief.txt
   ════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { loadAssistant } = require('./lib/assistant');

const root = path.join(__dirname, '..');
const outPath = path.join(root, 'agent-brief.txt');

const assistant = loadAssistant(root);

const guidance = assistant.guidance || {};
const faqs = Array.isArray(assistant.faqs) ? assistant.faqs.filter((x) => x && x.enabled !== false && x.question && x.answer) : [];
const knowledge = Array.isArray(assistant.knowledge) ? assistant.knowledge.filter((x) => x && x.enabled !== false && (x.title || x.body)) : [];

const guide = [guidance.identity, guidance.voice, guidance.whenMissing, guidance.additional]
  .map((x) => String(x || '').trim()).filter(Boolean);
const sections = ['# Assistant context — managed in /admin/ → Assistant. This file is public by URL, not secret.'];
if (guide.length) sections.push(`## Response guide\n${guide.join('\n\n')}`);
if (faqs.length) sections.push('# FAQ answers\n' + faqs.map((f) => `## ${String(f.question).trim()}\n${String(f.answer).trim()}`).join('\n\n'));
if (knowledge.length) sections.push('# Background knowledge\n' + knowledge.map((n) => `## ${String(n.title || 'Untitled').trim()}\n${String(n.body || '').trim()}`).join('\n\n'));
const out = sections.join('\n\n') + '\n';

fs.writeFileSync(outPath, out);
console.log(`✓ wrote agent-brief.txt (${out.length} bytes, ${faqs.length} FAQs, ${knowledge.length} notes)`);
