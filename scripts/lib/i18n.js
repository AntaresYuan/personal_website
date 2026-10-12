/* ─────────────────────────────────────────────────────────────────────────
   Two languages for the Work space: English at the site root, Chinese
   under /zh/. Every Work builder renders once per language with these
   helpers.

   Content: content/<file> is English and complete. content/zh/<file>, when
   it exists, holds the Chinese for the fields that have one — nothing else.
   `content(rel, lang)` lays it over the English:
     - objects merge key by key;
     - lists of objects with a `slug` or `id` merge item by item, so a
       translation can name only the items it covers;
     - other lists of objects merge position by position when both have the
       same length (story sections, facts, image captions), and are
       replaced otherwise;
     - an empty value keeps the English.
   So anything untranslated falls back to English rather than going blank.

   UI words live in content/strings.json and content/zh/strings.json, not
   here: code stays English-only (CLAUDE.md); translations are content.
   ───────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const LANGS = ['en', 'zh'];
const HTML_LANG = { en: 'en', zh: 'zh-CN' };
const OG_LOCALE = { en: 'en_US', zh: 'zh_CN' };

// The Work pages that exist in both languages. Personal, the feed, media,
// scripts and styles are one file for both; so, for now, are /usage/ (the
// telemetry dashboard) and /about/ (switched off), whose links from a
// Chinese page lead to the English page rather than to a missing one.
const LOCALIZED = /^\/(?:$|projects\/|blog\/(?!feed\.xml)|gallery\/|skills\/)/;
const localPath = (p, lang) => (lang === 'zh' && LOCALIZED.test(p) && !/\.[a-z0-9]+$/i.test(p) ? `/zh${p}` : p);
const outRoot = (lang) => (lang === 'zh' ? path.join(root, 'zh') : root);

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const zhRel = (rel) => rel.replace(/^content\//, 'content/zh/');

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
function merge(base, over) {
  if (over === undefined || over === null || over === '') return base;
  if (Array.isArray(base) && Array.isArray(over)) {
    const key = ['slug', 'id'].find((k) => base.every((x) => isObj(x) && k in x) && over.every((x) => isObj(x) && k in x));
    if (key) return base.map((b) => { const o = over.find((x) => x[key] === b[key]); return o ? merge(b, o) : b; });
    if (base.length === over.length && base.every(isObj) && over.every(isObj)) return base.map((b, i) => merge(b, over[i]));
    return over;
  }
  if (isObj(base) && isObj(over)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : v;
    return out;
  }
  return over;
}

// A content file in `lang`: the English, with the translation laid over it.
function content(rel, lang) {
  const base = readJson(rel);
  if (lang !== 'zh' || !fs.existsSync(path.join(root, zhRel(rel)))) return base;
  return merge(base, readJson(zhRel(rel)));
}
// The translated file alone (null if there is none).
const translation = (rel) => (fs.existsSync(path.join(root, zhRel(rel))) ? readJson(zhRel(rel)) : null);

/* UI words. t('ask.send', 'zh') → the Chinese, or the English, or the key.
   `vars` fill {name} placeholders. */
const stringsCache = {};
const strings = (lang) => (stringsCache[lang] ??= content('content/strings.json', lang));
function t(key, lang = 'en', vars) {
  let s = key.split('.').reduce((o, k) => (o == null ? o : o[k]), strings(lang));
  if (typeof s !== 'string') s = key.split('.').reduce((o, k) => (o == null ? o : o[k]), strings('en'));
  if (typeof s !== 'string') return key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
// The browser scripts' words, embedded in each page as JSON (work-shell).
const clientStrings = (lang) => strings(lang).client ?? {};

/* Dates: "Oct 10" / "Oct 10, 2026" in English, the zh-CN long form in
   Chinese -- from Intl, without writing Chinese characters into code. */
const LOCALE = { en: 'en-US', zh: 'zh-CN' };
const fmtDate = (iso, lang, withYear = false) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '')) return '';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(LOCALE[lang] || 'en-US', {
    month: lang === 'zh' ? 'long' : 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
  });
};

module.exports = {
  LANGS, HTML_LANG, OG_LOCALE, LOCALIZED, localPath, outRoot,
  merge, content, translation, t, clientStrings, fmtDate,
};
