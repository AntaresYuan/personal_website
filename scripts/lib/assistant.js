/* Load the four CMS tabs that make up Ask Antares's owner-managed context.
   Keeping the files separate makes the CMS navigable; returning one object
   keeps the build and Worker corpus independent of that editing layout. */
'use strict';

const fs = require('fs');
const path = require('path');

const defaultRoot = path.join(__dirname, '..', '..');
const read = (root, file, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch { return fallback; }
};

function loadAssistant(root = defaultRoot) {
  const guidance = read(root, 'content/assistant/guide.json', {});
  const sources = read(root, 'content/assistant/sources.json', {});
  const faq = read(root, 'content/assistant/faqs.json', { items: [] });
  const knowledge = read(root, 'content/assistant/knowledge.json', { notes: [] });
  return {
    guidance,
    sources,
    faqs: Array.isArray(faq.items) ? faq.items : [],
    knowledge: Array.isArray(knowledge.notes) ? knowledge.notes : [],
  };
}

module.exports = { loadAssistant };
