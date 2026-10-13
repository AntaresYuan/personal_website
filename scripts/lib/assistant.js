/* Load the Agent infra tabs (CMS → Agent infra) that make up Ask Antares's
   owner-managed context: the response guide, the skills and their system
   prompts, the QA pairs, background knowledge and the tool settings.
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
  const skills = read(root, 'content/assistant/skills.json', {});
  const tools = read(root, 'content/assistant/tools.json', {});
  const faq = read(root, 'content/assistant/faqs.json', { items: [] });
  const knowledge = read(root, 'content/assistant/knowledge.json', { notes: [] });
  return {
    guidance,
    skills: skills && typeof skills === 'object' ? skills : {},
    tools: tools && typeof tools === 'object' ? tools : {},
    // The Work-search tool's source switches (formerly sources.json).
    sources: tools?.search?.sources ?? {},
    faqs: Array.isArray(faq.items) ? faq.items : [],
    knowledge: Array.isArray(knowledge.notes) ? knowledge.notes : [],
  };
}

module.exports = { loadAssistant };
