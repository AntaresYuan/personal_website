#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-agent-brief.js — compile Ask Antares's Agent infra → agent-brief.txt

   The owner-managed context for the `ask` assistant (workers/qa/) as plain
   text: the system prompt, the QA pairs and the background knowledge. The
   normal Worker path uses /ask-index.json; /agent-brief.txt backs up the
   fallback path, when the index can't be loaded.

   Note: agent-brief.txt is a deployed static file, so it's technically
   fetchable by URL (it just isn't linked from anywhere). It's "off the
   site," not "secret" — keep that in mind for what you put in it.

   Run:    node scripts/build-agent-brief.js   (or, with everything: node scripts/build.js)
   Output: ./agent-brief.txt
   ════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { loadAgent } = require('./lib/agent');

const root = path.join(__dirname, '..');
const outPath = path.join(root, 'agent-brief.txt');

const assistant = loadAgent(root);

const faqs = Array.isArray(assistant.faqs) ? assistant.faqs.filter((x) => x && x.enabled !== false && x.question && x.answer) : [];
const knowledge = Array.isArray(assistant.knowledge) ? assistant.knowledge.filter((x) => x && x.enabled !== false && (x.title || x.body)) : [];

const sections = ['# Work Assistant context — managed in /admin/ → Agent infra. This file is public by URL, not secret.'];
if (assistant.systemPrompt) sections.push(`# System prompt\n${assistant.systemPrompt}`);
if (faqs.length) sections.push('# QA pairs\n' + faqs.map((f) => `## ${String(f.question).trim()}\n${String(f.answer).trim()}`).join('\n\n'));
if (knowledge.length) sections.push('# Background knowledge\n' + knowledge.map((n) => `## ${String(n.title || 'Untitled').trim()}\n${String(n.body || '').trim()}`).join('\n\n'));
const out = sections.join('\n\n') + '\n';

fs.writeFileSync(outPath, out);
console.log(`✓ wrote agent-brief.txt (${out.length} bytes, ${faqs.length} FAQs, ${knowledge.length} notes)`);
