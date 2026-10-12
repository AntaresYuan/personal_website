#!/usr/bin/env node
/* Compile the CMS-owned FAQ into a tiny browser data file. The runtime
   matcher stays in scripts/qa-faq.js; this file contains data only. */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadAssistant } = require('./lib/assistant');

const root = path.join(__dirname, '..');
const output = path.join(root, 'scripts/qa-faq-data.js');
const data = loadAssistant(root);

if (!data || !Array.isArray(data.faqs)) throw new Error('content/assistant/faqs.json must contain an items array');

const seen = new Set();
const items = data.faqs.filter((item) => item && item.enabled !== false).map((item, index) => {
  const question = String(item && item.question || '').trim();
  const answer = String(item && item.answer || '').trim();
  if (!question || !answer) throw new Error(`FAQ item ${index + 1} needs both question and answer`);
  const key = question.toLowerCase();
  if (seen.has(key)) throw new Error(`Duplicate FAQ question: ${question}`);
  seen.add(key);
  return {
    question,
    answer,
    ...(item.starter === true ? { starter: true } : {}),
    ...(Array.isArray(item.aliases) && item.aliases.some((x) => String(x || '').trim())
      ? { aliases: item.aliases.map((x) => String(x || '').trim()).filter(Boolean) } : {}),
    ...(String(item.href || '').trim() ? { href: String(item.href).trim() } : {}),
  };
});

const out = `/* GENERATED from content/assistant/faqs.json — edit it in /admin/, not here. */\nwindow.QA_FAQ_DATA = ${JSON.stringify(items, null, 2)};\n`;
fs.writeFileSync(output, out);
console.log(`✓ wrote scripts/qa-faq-data.js (${items.length} FAQs, ${items.filter((x) => x.starter).length} starters)`);

