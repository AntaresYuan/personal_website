#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-ask-index.js — the "ask" assistant's corpus (ask-index.json).

   The site cut into short, titled passages, so the qa Worker (workers/qa/)
   can pick the few that answer a question instead of truncating the whole
   site to its first few thousand words. Two kinds of passage are `pin`ned —
   sent with every question — : the guide and notes Antares manages in
   content/assistant/, plus an overview of the enabled website sources.

   Public content is Work-only: home, case studies, AI Skills, Gallery and
   Writing. Personal roadmap, Lens and Contact content are never indexed.
   Owner-authored Assistant guidance, FAQs and knowledge are added separately.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadPosts } = require('./lib/blog');
const { projectList } = require('./lib/projects');
const { loadAssistant } = require('./lib/assistant');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const tryRead = (p, fallback) => { try { return read(p); } catch { return fallback; } };
const tryReadText = (p, fallback = '') => {
  try { return fs.readFileSync(path.join(root, p), 'utf8'); }
  catch { return fallback; }
};

const profile = read('content/profile.json');
const work = read('content/work.json');
const assistant = loadAssistant(root);
const skills = tryRead('content/skills.json', { items: [] });
const gallery = tryRead('content/gallery.json', { items: [] });
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

// FAQ answer briefs stay separate from ordinary passages. The Worker first
// performs a deterministic question/alias match, then places the matching
// brief ahead of the normal site retrieval context.
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

const chunks = [];
const add = (id, title, url, text, pin = false) => {
  const parts = pieces(plain(text));
  parts.forEach((t, i) => chunks.push({
    id: parts.length > 1 ? `${id}#${i + 1}` : id,
    title: parts.length > 1 ? `${title} (${i + 1}/${parts.length})` : title,
    url, text: t, ...(pin ? { pin: true } : {}),
  }));
};

/* ── Pinned: the owner's guide, llms.txt summary, notes, and overview ─ */
const guide = assistant.guidance ?? {};
const guideText = [
  guide.identity ? `Identity: ${guide.identity}` : '',
  guide.voice ? `Voice and style: ${guide.voice}` : '',
  guide.whenMissing ? `When information is missing: ${guide.whenMissing}` : '',
  guide.additional ? `Additional guidance: ${guide.additional}` : '',
].filter(Boolean).join('\n\n');
if (guideText) add('assistant-guide', 'Assistant response guide', '', guideText, true);

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
  add(`skill-${s.slug}`, `AI skill: ${s.name}`, `/skills/${s.slug}/`, [
    `${s.name} — ${s.category || ''}. ${s.tagline || ''}`,
    s.summary || '',
    s.install ? `Install: ${s.install}` : '',
    (s.stats ?? []).map((x) => `${x.value} ${x.label}`).join('; '),
    s.details || '',
  ].filter(Boolean).join('\n\n'));
}
for (const g of sourceOn('gallery') ? (gallery.items ?? []) : []) {
  add(`gallery-${g.slug}`, `Gallery: ${g.title}`, '/gallery/', [
    `${g.title}${g.year ? ` (${g.year})` : ''}${g.medium ? ` — ${g.medium}` : ''}. Category: ${gallery.categories?.[g.category] || g.category || ''}.`,
    g.summary || '',
  ].filter(Boolean).join('\n\n'));
}
for (const post of sourceOn('writing') ? loadPosts() : []) {
  const url = `/blog/${post.slug}/`;
  add(`post-${post.slug}`, `Writing: ${post.title}`, url, [`${post.title} (${post.date || ''})`, post.summary || ''].join('\n\n'));
  // One passage per section, so a long post doesn't crowd out everything else.
  String(post.body || '').split(/\n(?=##\s)/).forEach((sec, i) => {
    const head = (/^##\s+(.+)/.exec(sec) || [])[1];
    add(`post-${post.slug}-${i + 1}`, `Writing: ${post.title}${head ? ` — ${head}` : ''}`, url, sec);
  });
}
/* ── Write ────────────────────────────────────────────────────────────── */
const version = crypto.createHash('sha1').update(JSON.stringify({ faqs, chunks })).digest('hex').slice(0, 12);
const out = { version, faqs, chunks };
fs.writeFileSync(path.join(root, 'ask-index.json'), JSON.stringify(out) + '\n');
const pinned = chunks.filter((c) => c.pin).length;
console.log(`✓ wrote ask-index.json (${chunks.length} passages, ${pinned} pinned, ${faqs.length} FAQs, ${Math.round(JSON.stringify(out).length / 1024)} KB)`);
