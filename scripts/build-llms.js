#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   build-llms.js — generate the Work-only /llms.txt and /llms-full.txt.

   These files describe the public Work portfolio and are also a grounding
   surface for Ask Antares. Personal content is deliberately excluded: no
   roadmap board, Lens, Personal contact section, or Personal-only metadata.

   Run:    node scripts/build-llms.js
   Output: ./llms.txt + ./llms-full.txt
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadPosts } = require('./lib/blog');
const { projectList } = require('./lib/projects');
const lastUpdated = require('./last-updated');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const tryRead = (p, fallback) => { try { return read(p); } catch { return fallback; } };

const site = read('content/site.json');
const profile = read('content/profile.json');
const work = read('content/work.json');
const skills = tryRead('content/skills.json', { items: [] });
const gallery = tryRead('content/gallery.json', { items: [], categories: {} });
const projects = projectList();
const posts = loadPosts();

const stripTags = (s) => String(s ?? '').replace(/<[^>]+>/g, '');
const stripMd = (s) => String(s ?? '')
  .replace(/```[\s\S]*?```/g, '')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^\s{0,3}#{1,6}\s+/gm, '')
  .replace(/^\s*>\s?/gm, '')
  .replace(/^\s*[-*+]\s+/gm, '- ')
  .replace(/(\*\*|__|\*|_)/g, '')
  .replace(/^\s*-{3,}\s*$/gm, '')
  .replace(/\\([\\`*_{}\[\]()#+.!|>~^=-])/g, '$1')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const name = [
  work.name?.first || profile.name,
  work.name?.middle ? `(${work.name.middle})` : '',
  work.name?.last || profile.nameAccent,
].filter(Boolean).join(' ');
const nativeName = work.name?.native ? ` (${work.name.native})` : '';
const workTags = profile.tagsWork ?? [];

const projectText = (p) => [
  `## ${p.title}${p.kind ? ` · ${p.kind}` : ''}`,
  `URL: /projects/${p.slug}/`,
  p.summary ? `Summary: ${p.summary}` : '',
  (p.facts ?? []).map((f) => `${f.label}: ${f.value}`).join('\n'),
  ...(p.story ?? []).map((section) => `### ${section.title}\n\n${stripMd(section.body)}`),
  (p.outcomes ?? []).length
    ? `Outcomes:\n${p.outcomes.map((o) => `  - ${o.value}: ${o.label}`).join('\n')}`
    : '',
  (p.links ?? []).length
    ? `Links:\n${p.links.map((l) => `  - ${l.label}: ${l.href}`).join('\n')}`
    : '',
  p.live?.url ? `Live demo: ${p.live.url}` : '',
].filter(Boolean).join('\n\n');

const skillText = (s) => [
  `## ${s.name}${s.category ? ` · ${s.category}` : ''}`,
  s.site ? `Website: ${s.site}` : '',
  s.repo ? `GitHub: ${s.repo}` : '',
  s.tagline || '',
  s.summary || '',
  s.install ? `Install: ${s.install}` : '',
  (s.stats ?? []).map((item) => `${item.value} ${item.label}`).join('; '),
  stripMd(s.details || ''),
].filter(Boolean).join('\n\n');

const galleryText = (item) => [
  `## ${item.title}${item.year ? ` (${item.year})` : ''}`,
  'URL: /gallery/',
  item.medium ? `Medium: ${item.medium}` : '',
  item.category ? `Category: ${gallery.categories?.[item.category] || item.category}` : '',
  item.summary || '',
].filter(Boolean).join('\n');

const postText = (post) => {
  const head = [
    `## ${post.title}`,
    `URL: /blog/${post.slug}/`,
    post.date ? `Published: ${post.date}` : '',
    post.summary ? `Summary: ${post.summary}` : '',
  ].filter(Boolean).join('\n');
  const body = stripMd(post.body);
  return body ? `${head}\n\n${body}` : head;
};

/* ── llms.txt: concise Work map ───────────────────────────────────── */
const short = `# ${name} — Work

> ${stripTags(work.message?.body || site.meta?.description || '')}

## Identity
- Name: ${name}${nativeName}
- Role: ${profile.role || ''}
- Location: ${profile.location || ''}
- Work focus: ${workTags.join(', ')}

## Latest update
${work.update?.date ? `${work.update.date}: ` : ''}${work.update?.text || 'No update published.'}

## Work sections
- [Work home](/): current message, update and selected work
- [Projects](/projects/): ${projects.length} case studies with ownership and outcomes
- [AI Skills](/skills/): tools and agent workflows I built
- [Gallery](/gallery/): selected visual work
- [Writing](/blog/): product notes, writeups and reflections
- [Full Work context](/llms-full.txt): the complete text corpus used as the assistant fallback

## Scope
This file and /llms-full.txt describe the Work space only.
`;

/* ── llms-full.txt: complete Work corpus ─────────────────────────────── */
const sections = [
  `# ${name} — Work`,
  [
    `## ${work.message?.title || 'Work message'}`,
    stripTags(work.message?.body || ''),
    '',
    `Name: ${name}${nativeName}`,
    `Role: ${profile.role || ''}`,
    `Location: ${profile.location || ''}`,
    `Work focus: ${workTags.join(', ')}`,
    work.update?.text ? `Latest update${work.update.date ? ` (${work.update.date})` : ''}: ${work.update.text}` : '',
  ].filter(Boolean).join('\n'),
];

if (projects.length) sections.push(`# Projects\n\n${projects.map(projectText).join('\n\n---\n\n')}`);

const skillItems = (skills.items ?? []).slice().sort((a, b) =>
  (a.order ?? 99) - (b.order ?? 99) || String(a.name ?? '').localeCompare(String(b.name ?? '')));
if (skillItems.length) sections.push(`# AI Skills\n\n${skillItems.map(skillText).join('\n\n---\n\n')}`);

const galleryItems = (gallery.items ?? []).slice().sort((a, b) =>
  (a.order ?? 99) - (b.order ?? 99) || String(a.title ?? '').localeCompare(String(b.title ?? '')));
if (galleryItems.length) sections.push(`# Gallery\n\n${galleryItems.map(galleryText).join('\n\n')}`);

if (posts.length) sections.push(`# Writing\n\n${posts.map(postText).join('\n\n---\n\n')}`);

const full = sections.join('\n\n') + '\n';
const footer = `\n---\nGenerated ${new Date().toISOString().slice(0, 10)} from Work content only. Last site update: ${lastUpdated}. Edit the Work collections or /admin/ → Assistant, then run \`node scripts/build.js\`.\n`;

fs.writeFileSync(path.join(root, 'llms.txt'), short + footer);
fs.writeFileSync(path.join(root, 'llms-full.txt'), full + footer);

const size = (p) => fs.statSync(path.join(root, p)).size;
console.log(`✓ wrote llms.txt       (${size('llms.txt')} bytes, Work only)`);
console.log(`✓ wrote llms-full.txt  (${size('llms-full.txt')} bytes, Work only)`);
