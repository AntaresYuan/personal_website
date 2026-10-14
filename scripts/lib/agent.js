/* Ask Antares's Agent infra (CMS → Agent infra), as one object:

     content/agent/system-prompt.md        the system prompt, every answer
     content/agent/knowledge.json          background notes, every answer
     content/agent/skills/<name>/SKILL.md  one skill each: frontmatter (name,
                                           title, description, tools, answer,
                                           enabled) and its instructions
     content/agent/skills/qa/pairs.json    the qa skill's QA pairs
     content/agent/tools/<name>.json       one tool each, with its settings

   The build (build-ask-index.js, build-faq.js, build-agent-brief.js) reads
   it from here; the Worker gets it through ask-index.json. */
'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./blog');

const defaultRoot = path.join(__dirname, '..', '..');
const AGENT = 'content/agent';
const readJson = (root, file, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch { return fallback; }
};
const readMarkdown = (root, file) => {
  try { return parseFrontmatter(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch { return null; }
};
const listDirs = (root, dir) => {
  try { return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); }
  catch { return []; }
};
const listJson = (root, dir) => {
  try { return fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.json')).sort(); }
  catch { return []; }
};
const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',') : [])
  .map((x) => String(x).trim()).filter(Boolean);

function loadAgent(root = defaultRoot) {
  const system = readMarkdown(root, `${AGENT}/system-prompt.md`);
  const knowledge = readJson(root, `${AGENT}/knowledge.json`, { notes: [] });

  const skills = {};
  for (const dir of listDirs(root, `${AGENT}/skills`)) {
    const md = readMarkdown(root, `${AGENT}/skills/${dir}/SKILL.md`);
    if (!md) continue;
    const d = md.data || {};
    const name = String(d.name || dir).trim();
    skills[name] = {
      name,
      title: String(d.title || name).trim(),
      description: String(d.description || '').trim(),
      tools: asList(d.tools),
      answer: d.answer === 'tool' ? 'tool' : 'model',
      enabled: d.enabled !== false,
      prompt: String(md.body || '').trim(),
    };
  }

  const tools = {};
  for (const file of listJson(root, `${AGENT}/tools`)) {
    const t = readJson(root, `${AGENT}/tools/${file}`, null);
    if (!t) continue;
    const name = String(t.name || file.replace(/\.json$/, '')).trim();
    tools[name] = { ...t, name, enabled: t.enabled !== false };
  }

  const pairs = readJson(root, `${AGENT}/skills/qa/pairs.json`, { items: [] });
  return {
    systemPrompt: String(system?.body || '').trim(),
    skills,
    tools,
    // The search_work tool's source switches.
    sources: tools.search_work?.sources ?? {},
    faqs: Array.isArray(pairs.items) ? pairs.items : [],
    knowledge: Array.isArray(knowledge.notes) ? knowledge.notes : [],
  };
}

module.exports = { loadAgent };
