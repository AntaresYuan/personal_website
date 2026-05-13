/* ════════════════════════════════════════════════════════════════════════
   lib/blog.js — load & render blog posts from content/blog/*.md

   Zero dependencies. The Markdown subset is deliberately small — enough for
   prose writeups: headings, paragraphs, bold/italic, `code`, ```fenced```,
   - / 1. lists (with lazy continuation), > blockquotes, [links], ![images],
   --- rules, and \X backslash escapes. Raw HTML in the source is escaped
   (safe-by-default for a CMS-edited blog).

   Used by scripts/build-blog.js (renders pages + the RSS feed) and
   scripts/build-sitemap.js / scripts/build-llms.js (slug/title/date/summary).
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const BLOG_DIR = path.join(__dirname, '..', '..', 'content', 'blog');

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const slugify = (s) => String(s).toLowerCase().trim()
  .replace(/[^\w\s-]+/g, '').replace(/[\s_]+/g, '-').replace(/^-+|-+$/g, '');

// Sentinels for stash/restore — private-use code points; can't occur in real
// text and pass through escapeHtml untouched.
const ESC = '';   // \X backslash-escaped literal: ESC + index + ESC
const CODE = '';  // `code` span:                  CODE + index + CODE

/* ── inline formatting ──────────────────────────────────────────────────
   Stash backslash-escaped chars and `code` spans first, escape HTML, then do
   images → links → bold → italic, then restore the stashes. */
function inline(src) {
  const lits = [];
  let s = String(src).replace(/\\([\\`*_{}\[\]()#+.!|>~^=-])/g, (_, ch) => {
    lits.push(escapeHtml(ch));
    return `${ESC}${lits.length - 1}${ESC}`;
  });
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return `${CODE}${codes.length - 1}${CODE}`;
  });
  s = escapeHtml(s);
  // ![alt](src "title")  — before links
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, alt, src2, title) => `<img src="${src2}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy">`);
  // [text](href)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, href) =>
    `<a href="${href}"${/^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener"' : ''}>${txt}</a>`);
  // **bold** / __bold__
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+?)__/g, '<strong>$1</strong>');
  // *italic* / _italic_  (don't swallow whitespace; don't match mid-word _)
  s = s.replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_(?!\s)([^_]+?)_(?!\w)/g, '$1<em>$2</em>');
  // restore: code spans, then the backslash-escaped literals
  return s
    .replace(new RegExp(CODE + '(\\d+)' + CODE, 'g'), (_, i) => codes[+i])
    .replace(new RegExp(ESC + '(\\d+)' + ESC, 'g'), (_, i) => lits[+i]);
}

/* ── block parsing ──────────────────────────────────────────────────── */
function mdToHtml(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const blank = (l) => /^\s*$/.test(l);
  const UL = /^\s*[-*+]\s+/, OL = /^\s*\d+\.\s+/;
  const isItem = (l) => UL.test(l) || OL.test(l);
  const startsBlock = (l) =>
    /^```/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>\s?/.test(l) ||
    isItem(l) || /^\s*([-*_])\s*(?:\1\s*){2,}$/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }

    // fenced code
    let m = /^```\s*([\w-]+)?\s*$/.exec(line);
    if (m) {
      const lang = m[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence (if present)
      out.push(`<pre><code${lang ? ` class="lang-${lang}"` : ''}>${escapeHtml(buf.join('\n'))}\n</code></pre>`);
      continue;
    }
    // horizontal rule
    if (/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)) { out.push('<hr>'); i++; continue; }
    // heading (body never owns the page <h1> → clamp to h2..h6)
    m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const lvl = Math.min(6, Math.max(2, m[1].length));
      const text = m[2].trim();
      out.push(`<h${lvl} id="${slugify(text)}">${inline(text)}</h${lvl}>`);
      i++; continue;
    }
    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }
    // lists (- * + or 1.) — with lazy continuation: an indented, non-blank line
    // that isn't itself a new item belongs to the current item.
    if (isItem(line)) {
      const ordered = OL.test(line);
      const re = ordered ? OL : UL;
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (isItem(l)) { items.push(l.replace(re, '').trim()); i++; }
        else if (!blank(l) && /^\s+\S/.test(l) && items.length) { items[items.length - 1] += ' ' + l.trim(); i++; }
        else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      continue;
    }
    // paragraph — gather lines until a blank or a block start
    const buf = [];
    while (i < lines.length && !blank(lines[i]) && !startsBlock(lines[i])) { buf.push(lines[i]); i++; }
    const text = buf.join(' ').trim();
    // Auto-embed: a paragraph that's *just* a video URL (or a single [..](url)
    // wrapping one) becomes an inline player. Catches YouTube / Vimeo / Bilibili.
    // Gated to "the paragraph is one token" so an inline URL in prose stays text.
    const linkOnly = /^\[[^\]]*\]\(([^)\s]+)\)$/.exec(text);
    const vsrc = (/^\S+$/.test(text) && videoEmbedUrl(text)) || (linkOnly && videoEmbedUrl(linkOnly[1]));
    if (vsrc) { out.push(videoEmbedHtml(vsrc)); continue; }
    out.push(`<p>${inline(text)}</p>`);
  }
  return out.join('\n');
}

// — Video auto-embed (YouTube / Vimeo / Bilibili). Returns the embed URL for a
//   recognised video URL, else null. ID patterns are tight, so the resulting
//   <iframe src> is safe to interpolate.
function videoEmbedUrl(url) {
  let m;
  if ((m = /(?:youtube\.com\/(?:watch\?(?:[^"]*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url))) return 'https://www.youtube-nocookie.com/embed/' + m[1];
  if ((m = /vimeo\.com\/(?:video\/)?(\d{6,12})/.exec(url))) return 'https://player.vimeo.com/video/' + m[1];
  if ((m = /bilibili\.com\/video\/(BV[A-Za-z0-9]{8,12})/.exec(url))) return 'https://player.bilibili.com/player.html?bvid=' + m[1] + '&page=1&high_quality=1';
  return null;
}
function videoEmbedHtml(src) {
  return '<div class="video-embed"><iframe src="' + src + '" title="Embedded video" loading="lazy" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
}

/* ── frontmatter ────────────────────────────────────────────────────────
   --- \n key: value \n --- \n. A small YAML subset — enough for what the
   CMS writes for a post: bare/quoted scalars, true/false, and `|` / `|-` /
   `>` / `>-` block scalars (Sveltia serializes multi-line `text` fields that
   way). Unknown shapes are kept as the raw remainder of the line. */
function parseFrontmatter(raw) {
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/.exec(String(raw));
  if (!m) return { data: {}, body: String(raw) };
  const data = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const mm = /^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$/.exec(lines[i]);
    if (!mm) continue;
    let v = mm[2].trim();
    const block = /^([|>])[+-]?[ \t]*$/.exec(v);
    if (block) {
      const folded = block[1] === '>';
      const buf = [];
      let j = i + 1;
      while (j < lines.length && (/^\s+\S/.test(lines[j]) || lines[j].trim() === '')) { buf.push(lines[j]); j++; }
      i = j - 1;
      while (buf.length && buf[0].trim() === '') buf.shift();
      while (buf.length && buf[buf.length - 1].trim() === '') buf.pop();
      const indent = (buf[0] || '').match(/^[ \t]*/)[0].length;
      const text = buf.map((l) => l.slice(indent)).join(folded ? ' ' : '\n');
      data[mm[1]] = (folded ? text.replace(/\s+/g, ' ') : text).trim();
      continue;
    }
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    data[mm[1]] = v;
  }
  return { data, body: String(raw).slice(m[0].length) };
}

/* ── loader ─────────────────────────────────────────────────────────────
   Returns [{ slug, title, date('YYYY-MM-DD'), summary, draft, body, file }],
   newest first. `summary` is collapsed to one line. Drafts excluded unless
   includeDrafts. */
function loadPosts({ includeDrafts = false } = {}) {
  if (!fs.existsSync(BLOG_DIR)) return [];
  return fs.readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_') && !f.startsWith('.'))
    .map((f) => {
      const { data, body } = parseFrontmatter(fs.readFileSync(path.join(BLOG_DIR, f), 'utf8'));
      const slug = slugify(data.slug || f.replace(/\.md$/i, ''));
      return {
        slug,
        title: String(data.title || slug).trim(),
        date: String(data.date || '').trim().slice(0, 10),
        summary: String(data.summary || '').replace(/\s+/g, ' ').trim(),
        draft: data.draft === true || data.draft === 'true',
        body: String(body).trim(),
        file: f,
      };
    })
    .filter((p) => includeDrafts || !p.draft)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.slug.localeCompare(b.slug));
}

module.exports = { loadPosts, mdToHtml, parseFrontmatter, escapeHtml, slugify };
