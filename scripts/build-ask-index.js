#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-ask-index.js — the "ask" assistant's corpus (ask-index.json).

   The site cut into short, titled passages, so the qa Worker (workers/qa/)
   can pick the few that answer a question instead of truncating the whole
   site to its first few thousand words. Some passages are `pin`ned, sent
   with every model-written answer: the background notes (CMS → Agent infra
   → System prompt), the llms.txt summary and an overview of the Work site.

   Public content is Work-only: home, case studies, AI Skills, Gallery and
   Writing. Personal roadmap, Lens and Contact content are never indexed.
   The Agent infra (content/agent/, scripts/lib/agent.js) comes along too:
     - systemPrompt: the system prompt, sent with every answer;
     - skills: each SKILL.md (title, description, tools, answer, enabled and
       its instructions); faqs: the qa skill's QA pairs;
     - tools: each tool's switch and settings;
     - entities: every named Work item (project, AI skill, post, gallery
       piece) with the names a visitor may use for it, the passages that are
       its own, and its page in the resource catalogue.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadPosts } = require('./lib/blog');
const { projectList } = require('./lib/projects');
const { loadAgent } = require('./lib/agent');
const { content, t } = require('./lib/i18n');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const tryRead = (p, fallback) => { try { return read(p); } catch { return fallback; } };
const tryReadText = (p, fallback = '') => {
  try { return fs.readFileSync(path.join(root, p), 'utf8'); }
  catch { return fallback; }
};

const profile = read('content/profile.json');
const work = read('content/work.json');
const assistant = loadAgent(root);
const skills = tryRead('content/skills.json', { items: [] });
const gallery = tryRead('content/gallery.json', { items: [] });
const zhSkills = tryRead('content/zh/skills.json', { items: [] });
const zhGallery = tryRead('content/zh/gallery.json', { items: [] });
const zhWork = content('content/work.json', 'zh');
const zhNav = new Map((zhWork.nav ?? []).map((item) => [item.id, item.label]));
const sourceOn = (name) => !assistant.sources || assistant.sources[name] !== false;

const MAX = 1200;   // characters per passage, roughly 250–300 tokens

// Markdown → plain prose: keep the words, drop the markup.
const plain = (s) => String(s ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

// The qa skill's QA pairs stay separate from ordinary passages: the Worker
// matches them itself, then places the matching answer ahead of the rest.
const faqs = (assistant.faqs ?? []).filter((item) => item && item.enabled !== false).map((item, index) => ({
  id: `faq-${index + 1}`,
  question: String(item.question || '').trim(),
  answer: plain(String(item.answer || '')),
  aliases: Array.isArray(item.aliases) ? item.aliases.map((x) => String(x || '').trim()).filter(Boolean) : [],
  ...(String(item.href || '').trim() ? { href: String(item.href).trim() } : {}),
})).filter((item) => item.question && item.answer);

// Split long text at paragraph boundaries into pieces of at most MAX chars.
const pieces = (text) => {
  const out = [];
  let cur = '';
  for (const para of String(text).split(/\n{2,}/)) {
    if (cur && cur.length + para.length + 2 > MAX) { out.push(cur); cur = ''; }
    if (para.length > MAX) {
      for (let i = 0; i < para.length; i += MAX) out.push(para.slice(i, i + MAX));
    } else cur = cur ? `${cur}\n\n${para}` : para;
  }
  if (cur) out.push(cur);
  return out;
};

/* ── Entities: the named Work items the router recognises ─────────────────
   A name is matched as a whole word (Latin) or as a substring (Chinese). A
   slash-command skill is also known by its bare name ("devloop"), unless
   that is an everyday word a visitor would use for something else. */
const COMMON_WORDS = new Set(['iterate']);
const entities = [];
const addEntity = ({ id, kind, names, chunkPrefix, resourceId, url, urlZh }) => {
  const seen = new Set();
  const clean = [];
  for (const raw of names) {
    const name = String(raw || '').normalize('NFKC').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    const han = /[\u3400-\u9fff]/.test(name);
    if (han ? name.length < 2 : name.replace(/[^a-z0-9]/gi, '').length < 3) continue;
    seen.add(key);
    clean.push(name);
  }
  if (clean.length) entities.push({ id, kind, names: clean, chunkPrefix, resourceId, url, ...(urlZh ? { urlZh } : {}) });
};
// "HCDE 351 | A1: OXO Shower Control Interface" is also asked about as
// "OXO Shower Control Interface": the part after the last colon or dash.
const shortTitle = (title) => {
  const tail = String(title || '').split(/[:\uff1a]|\u2014+/).pop().trim();
  const long = /[\u3400-\u9fff]/.test(tail) ? tail.length >= 4 : tail.length >= 8;
  return long && tail !== String(title).trim() ? tail : '';
};

const chunks = [];
const add = (id, title, url, text, pin = false) => {
  const parts = pieces(plain(text));
  parts.forEach((t, i) => chunks.push({
    id: parts.length > 1 ? `${id}#${i + 1}` : id,
    title: parts.length > 1 ? `${title} (${i + 1}/${parts.length})` : title,
    url, text: t, ...(pin ? { pin: true } : {}),
  }));
};

/* ── Public Work resource catalogue ──────────────────────────────────────
   Passages answer “what”; resources answer “where can I open/get it?”. The
   Worker searches this list as a tool and returns exact URLs separately from
   model prose, so a résumé request can render the real PDF instead of asking
   the model to reproduce a filename from memory. */
const resources = [];
const resourceUrls = new Set();
const addResource = (item) => {
  const url = String(item?.url || '').trim();
  const title = String(item?.title || '').trim();
  if (!url || !title || resourceUrls.has(url)) return;
  resourceUrls.add(url);
  resources.push({
    id: String(item.id || `resource-${resources.length + 1}`),
    kind: /^(pdf|image|page|link|data)$/.test(item.kind) ? item.kind : 'link',
    title,
    url,
    description: String(item.description || '').trim(),
    keywords: Array.isArray(item.keywords) ? item.keywords.map((x) => String(x || '').trim()).filter(Boolean) : [],
    ...(item.titleZh ? { titleZh: String(item.titleZh) } : {}),
    ...(item.descriptionZh ? { descriptionZh: String(item.descriptionZh) } : {}),
    ...(item.urlZh ? { urlZh: String(item.urlZh) } : {}),
    ...(item.lang ? { lang: String(item.lang) } : {}),
  });
};
const linksIn = (text) => {
  const source = String(text || '');
  const found = [];
  const markdown = /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/(?!\/)[^)\s]+)\)/g;
  let match;
  while ((match = markdown.exec(source))) found.push({ label: plain(match[1]), url: match[2] });
  return found;
};

if (profile.resumeEn) addResource({
  id: 'resume-en', kind: 'pdf', title: 'Antares Yuan — Résumé',
  url: profile.resumeEn, description: 'English résumé · PDF', lang: 'en',
  keywords: ['resume', 'résumé', 'cv', 'curriculum vitae', 'pdf', 'download'],
});
if (profile.resumeZh) addResource({
  id: 'resume-zh', kind: 'pdf', title: 'Antares Yuan — Chinese résumé', titleZh: path.basename(profile.resumeZh, '.pdf'),
  url: profile.resumeZh, description: 'Chinese résumé · PDF', lang: 'zh',
  keywords: ['resume', 'résumé', 'cv', 'chinese resume', 'pdf', 'download'],
});

[
  ['home', 'Work home', zhNav.get('home'), '/', '/zh/', 'Overview of Antares’s work', ['home', 'portfolio', 'work']],
  ['projects', 'Projects', zhNav.get('projects'), '/projects/', '/zh/projects/', 'Product case studies', ['projects', 'case studies']],
  ['skills', 'AI Skills', zhNav.get('skills'), '/skills/', '/zh/skills/', 'Skills, plugins and agent infrastructure', ['skills', 'plugins', 'github']],
  ['gallery', 'Gallery', zhNav.get('gallery'), '/gallery/', '/zh/gallery/', 'Visual and product design work', ['gallery', 'design', 'images']],
  ['writing', 'Writing', zhNav.get('writing'), '/blog/', '/zh/blog/', 'Essays and project notes', ['writing', 'articles', 'blog']],
  ['usage', 'Personal token consumption', t('home.usage', 'zh'), '/usage/', '/usage/?lang=zh', 'Live AI usage dashboard', ['token', 'tokens', 'usage', 'consumption', 'dashboard']],
].forEach(([id, title, titleZh, url, urlZh, description, keywords]) => addResource({
  id: `page-${id}`, kind: 'page', title, titleZh, url, urlZh, description, keywords,
}));

[
  ['llms-summary', 'Work summary for agents', '/llms.txt', 'Concise plain-text site context', ['llms', 'text', 'context', 'agent']],
  ['llms-full', 'Full Work context for agents', '/llms-full.txt', 'Full plain-text Work corpus', ['llms full', 'text', 'context', 'corpus']],
  ['rss', 'Writing RSS feed', '/blog/feed.xml', 'RSS feed · XML', ['rss', 'feed', 'xml']],
  ['source', 'Website source on GitHub', 'https://github.com/AntaresYuan/personal_website', 'Open-source website repository', ['source', 'github', 'repository', 'repo']],
].forEach(([id, title, url, description, keywords]) => addResource({
  id: `file-${id}`, kind: id === 'source' ? 'link' : 'data', title, url, description, keywords,
}));

/* ── Pinned: background notes, the llms.txt summary, and an overview ─── */
// /llms.txt is the concise, agent-readable summary of the public site. Keep
// it visible as an explicit Assistant source and send it with every answer
// when enabled. /llms-full.txt remains the Worker's safety fallback if this
// richer passage index cannot be loaded.
if (sourceOn('llmsSummary')) {
  const llmsSummary = tryReadText('llms.txt');
  if (llmsSummary) add('llms-summary', 'Work summary from llms.txt', '/llms.txt', llmsSummary, true);
}

(assistant.knowledge ?? []).filter((n) => n && n.enabled !== false)
  .forEach((n, i) => add(`knowledge-${i + 1}`, `Background knowledge: ${n.title || 'untitled'}`, '', n.body, true));

const projects = projectList();
const projectsZh = new Map(projectList('zh').map((p) => [p.slug, p]));
const skillsZh = new Map((zhSkills.items ?? []).map((s) => [s.slug, s]));
const galleryZh = new Map((zhGallery.items ?? []).map((g) => [g.slug, g]));
const name = [work.name?.first || profile.name, work.name?.middle && `(${work.name.middle})`, work.name?.last || profile.nameAccent].filter(Boolean).join(' ');
const overview = [
  sourceOn('profile') ? `I'm ${name}${work.name?.native ? ` (${work.name.native})` : ''}. ${profile.role || ''}. Based in ${profile.location || ''}.` : '',
  sourceOn('profile') && profile.status ? `Right now: ${profile.status}` : '',
  sourceOn('profile') && (profile.tagsWork ?? []).length ? `In short: ${profile.tagsWork.join(', ')}.` : '',
  sourceOn('home') && work.message?.body ? `My message on the home page: ${work.message.body}` : '',
  sourceOn('home') && work.update?.text ? `Latest update (${work.update.date || ''}): ${work.update.text}` : '',
  sourceOn('projects') ? `Projects on this site: ${projects.map((p) => `${p.title} (${p.kind || ''}) — ${p.summary || ''}`).join(' | ')}` : '',
  sourceOn('skills') ? `AI skills I built: ${(skills.items ?? []).map((s) => `${s.name} — ${s.tagline || s.summary || ''}`).join(' | ')}` : '',
].filter(Boolean).join('\n\n');
if (overview) add('overview', 'Who I am and what is in the Work portfolio', '/', overview, true);

/* ── Work case studies ────────────────────────────────────────────────── */
for (const p of sourceOn('projects') ? projects : []) {
  const url = `/projects/${p.slug}/`;
  const pZh = projectsZh.get(p.slug) || {};
  addResource({
    id: `project-${p.slug}`, kind: 'page', title: p.title, titleZh: pZh.title || p.title,
    url, urlZh: `/zh/projects/${p.slug}/`, description: p.summary || '', descriptionZh: pZh.summary || p.summary || '',
    keywords: ['project', 'case study', p.title, p.kind].filter(Boolean),
  });
  if (p.cover) addResource({
    id: `project-${p.slug}-cover`, kind: 'image', title: `${p.title} — Cover`, titleZh: `${pZh.title || p.title} — Cover`,
    url: p.cover, description: 'Project cover image',
    keywords: [p.title, 'project', 'cover', 'image'],
  });
  (p.links ?? []).forEach((link, i) => addResource({
    id: `project-${p.slug}-link-${i + 1}`, kind: 'link', title: `${p.title} — ${link.label || 'Link'}`,
    titleZh: `${pZh.title || p.title} — ${link.label || 'Link'}`, url: link.href,
    description: p.summary || '', descriptionZh: pZh.summary || p.summary || '',
    keywords: [p.title, link.label, 'link', 'paper', 'github'].filter(Boolean),
  }));
  if (p.live?.url) addResource({
    id: `project-${p.slug}-live`, kind: 'link', title: `${p.title} — Live demo`, titleZh: `${pZh.title || p.title} — Live demo`,
    url: p.live.url, description: 'Open the live product',
    keywords: [p.title, 'live', 'demo', 'website'],
  });
  (p.story ?? []).flatMap((section) => linksIn(section.body)).forEach((link, i) => addResource({
    id: `project-${p.slug}-story-link-${i + 1}`, kind: 'link', title: `${p.title} — ${link.label}`,
    titleZh: `${pZh.title || p.title} — ${link.label}`, url: link.url,
    description: 'Link referenced in the project case study',
    keywords: [p.title, link.label, 'reference', 'link'],
  }));
  addEntity({
    id: `project-${p.slug}`, kind: 'project', chunkPrefix: `project-${p.slug}`, resourceId: `project-${p.slug}`,
    url, urlZh: `/zh/projects/${p.slug}/`,
    names: [p.title, pZh.title, p.slug.replace(/-/g, ' ')],
  });
  add(`project-${p.slug}`, `Project: ${p.title}`, url, [
    `${p.title} — ${p.kind || ''}`,
    p.summary || '',
    (p.facts ?? []).map((f) => `${f.label}: ${f.value}`).join('. '),
    (p.outcomes ?? []).length ? `Outcomes: ${p.outcomes.map((o) => `${o.value} (${o.label})`).join('; ')}` : '',
    (p.links ?? []).length ? `Links: ${p.links.map((l) => `${l.label} ${l.href}`).join('; ')}` : '',
    p.live?.url ? `Live demo: ${p.live.url}` : '',
  ].filter(Boolean).join('\n\n'));
  (p.story ?? []).forEach((st, i) => add(`project-${p.slug}-${i + 1}`, `${p.title}: ${st.title}`, url, st.body));
}

/* ── Work AI Skills, Gallery and Writing ──────────────────────────── */
for (const s of sourceOn('skills') ? (skills.items ?? []) : []) {
  const sZh = skillsZh.get(s.slug) || {};
  (s.links ?? []).forEach((link, i) => addResource({
    id: `skill-${s.slug}-link-${i + 1}`, kind: 'link', title: `${s.name} — ${link.label || 'Link'}`,
    titleZh: `${sZh.name || s.name} — ${link.label || 'Link'}`, url: link.href,
    description: s.tagline || s.summary || '', descriptionZh: sZh.tagline || sZh.summary || s.tagline || s.summary || '',
    keywords: [s.name, s.slug, link.label, s.category, 'skill', 'plugin', 'github', 'website'].filter(Boolean),
  }));
  const bare = String(s.name || '').replace(/^\//, '');
  addEntity({
    id: `skill-${s.slug}`, kind: 'skill', chunkPrefix: `skill-${s.slug}`,
    resourceId: (s.links ?? []).length ? `skill-${s.slug}-link-1` : 'page-skills',
    url: '/skills/', urlZh: '/zh/skills/',
    names: [s.name, sZh.name, COMMON_WORDS.has(bare.toLowerCase()) ? '' : bare,
      COMMON_WORDS.has(bare.toLowerCase()) ? `${bare} skill` : ''],
  });
  add(`skill-${s.slug}`, `AI skill: ${s.name}`, `/skills/${s.slug}/`, [
    `${s.name} — ${s.category || ''}. ${s.tagline || ''}`,
    s.summary || '',
    s.install ? `Install: ${s.install}` : '',
    (s.stats ?? []).map((x) => `${x.value} ${x.label}`).join('; '),
    s.details || '',
  ].filter(Boolean).join('\n\n'));
}
for (const g of sourceOn('gallery') ? (gallery.items ?? []) : []) {
  const gZh = galleryZh.get(g.slug) || {};
  (g.images ?? []).forEach((image, i) => addResource({
    id: `gallery-${g.slug}-${i + 1}`, kind: 'image', title: g.title, titleZh: gZh.title || g.title,
    url: image.src, description: image.caption || g.summary || g.medium || '',
    descriptionZh: (gZh.images?.[i]?.caption) || gZh.summary || image.caption || g.summary || '',
    keywords: [g.title, g.medium, gallery.categories?.[g.category], 'gallery', 'image'].filter(Boolean),
  }));
  addEntity({
    id: `gallery-${g.slug}`, kind: 'gallery', chunkPrefix: `gallery-${g.slug}`, resourceId: `gallery-${g.slug}-1`,
    url: '/gallery/', urlZh: '/zh/gallery/', names: [g.title, gZh.title],
  });
  add(`gallery-${g.slug}`, `Gallery: ${g.title}`, '/gallery/', [
    `${g.title}${g.year ? ` (${g.year})` : ''}${g.medium ? ` — ${g.medium}` : ''}. Category: ${gallery.categories?.[g.category] || g.category || ''}.`,
    g.summary || '',
  ].filter(Boolean).join('\n\n'));
}
const postsZh = new Map(loadPosts({ lang: 'zh' }).map((p) => [p.slug, p]));
for (const post of sourceOn('writing') ? loadPosts() : []) {
  const url = `/blog/${post.slug}/`;
  const postZh = postsZh.get(post.slug) || {};
  addResource({
    id: `post-${post.slug}`, kind: 'page', title: post.title, titleZh: postZh.title || post.title,
    url, urlZh: `/zh/blog/${post.slug}/`, description: post.summary || '', descriptionZh: postZh.summary || post.summary || '',
    keywords: [post.title, ...(post.tags || []), 'writing', 'article'],
  });
  if (post.cover) addResource({
    id: `post-${post.slug}-cover`, kind: 'image', title: `${post.title} — Cover`, titleZh: `${postZh.title || post.title} — Cover`,
    url: post.cover, description: 'Writing cover image',
    keywords: [post.title, 'writing', 'cover', 'image'],
  });
  linksIn(post.body).forEach((link, i) => addResource({
    id: `post-${post.slug}-link-${i + 1}`, kind: 'link', title: `${post.title} — ${link.label}`,
    titleZh: `${postZh.title || post.title} — ${link.label}`, url: link.url,
    description: 'Link referenced in the article',
    keywords: [post.title, link.label, 'reference', 'link'],
  }));
  addEntity({
    id: `post-${post.slug}`, kind: 'writing', chunkPrefix: `post-${post.slug}`, resourceId: `post-${post.slug}`,
    url, urlZh: `/zh/blog/${post.slug}/`,
    names: [post.title, postZh.title, shortTitle(post.title), shortTitle(postZh.title)],
  });
  add(`post-${post.slug}`, `Writing: ${post.title}`, url, [`${post.title} (${post.date || ''})`, post.summary || ''].join('\n\n'));
  // One passage per section, so a long post doesn't crowd out everything else.
  String(post.body || '').split(/\n(?=##\s)/).forEach((sec, i) => {
    const head = (/^##\s+(.+)/.exec(sec) || [])[1];
    add(`post-${post.slug}-${i + 1}`, `Writing: ${post.title}${head ? ` — ${head}` : ''}`, url, sec);
  });
}
/* ── Write ────────────────────────────────────────────────────────────── */
/* ── Skills and tools, as the Worker needs them ───────────────────────── */
const skillsOut = Object.fromEntries(Object.values(assistant.skills).map((s) => [s.name, {
  title: s.title, description: s.description, tools: s.tools, answer: s.answer,
  enabled: s.name === 'general' ? true : s.enabled, prompt: s.prompt,
}]));
const toolsOut = {
  search_work: { enabled: true },
  find_resources: {
    enabled: assistant.tools.find_resources?.enabled !== false,
    maxCards: Math.max(1, Math.min(5, Number(assistant.tools.find_resources?.maxCards) || 3)),
  },
  get_token_usage: { enabled: assistant.tools.get_token_usage?.enabled !== false },
};
const systemPrompt = assistant.systemPrompt;

const version = crypto.createHash('sha1').update(JSON.stringify({ systemPrompt, faqs, chunks, resources, entities, skillsOut, toolsOut })).digest('hex').slice(0, 12);
const out = { version, systemPrompt, skills: skillsOut, tools: toolsOut, faqs, entities, resources, chunks };
fs.writeFileSync(path.join(root, 'ask-index.json'), JSON.stringify(out) + '\n');
const pinned = chunks.filter((c) => c.pin).length;
console.log(`✓ wrote ask-index.json (${chunks.length} passages, ${pinned} pinned, ${faqs.length} QA pairs, ${entities.length} entities, ${resources.length} resources, ${Math.round(JSON.stringify(out).length / 1024)} KB)`);
