#!/usr/bin/env node
/* Two languages: static /zh/ Work pages (scripts/lib/i18n.js), the runtime
   translator on Personal (scripts/i18n.js), and the edge middleware that
   picks between them (functions/_middleware.js). Run after a build. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const i18n = require('./lib/i18n.js');
const middlewareSource = read('functions/_middleware.js');
const clientSource = read('scripts/i18n.js');

/* \u2500\u2500 Code stays English; Chinese lives in content/ and generated pages \u2500\u2500 */
const CJK = /[\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/;
const codeFiles = [
  'functions/_middleware.js', 'scripts/i18n.js', 'scripts/lib/i18n.js', 'scripts/lib/work-shell.js',
  'scripts/lib/projects.js', 'scripts/lib/blog.js',
  'scripts/work.js', 'scripts/comments.js', 'scripts/gallery.js', 'scripts/board.js', 'scripts/live.js',
  ...fs.readdirSync(path.join(root, 'scripts')).filter((f) => /^build-.*\.js$/.test(f)).map((f) => `scripts/${f}`),
];
codeFiles.forEach((rel) => assert(!CJK.test(read(rel)), `${rel}: keep code ASCII-only; Chinese belongs in content/zh/`));

/* \u2500\u2500 Runtime translator: Personal, and Work pages built in English only \u2500\u2500 */
assert(clientSource.includes("var COOKIE = 'site_lang_pref'"));
assert(clientSource.includes("var GEO_COOKIE = 'site_geo_lang'"));
const runtimePages = ['personal/index.html', 'usage/index.html',
  ...fs.readdirSync(path.join(root, 'work')).map((slug) => `work/${slug}/index.html`)];
runtimePages.forEach((rel) => assert(read(rel).includes('scripts/i18n.js'), `${rel} is missing the i18n runtime`));

const site = JSON.parse(read('content/site.json'));
if (site.features?.about === false) {
  const home = read('index.html');
  assert(!home.includes('data-id="about"'), 'disabled About must not appear in the rail');
  assert(read('about/index.html').includes('name="robots" content="noindex,nofollow"'));
  assert(read('about/index.html').includes("location.replace('/')"));
  assert(read('_redirects').includes('/about/* / 302'));
}

/* \u2500\u2500 Static Work pages: one build per language \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
const projectSlugs = fs.readdirSync(path.join(root, 'content/projects')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const workPaths = ['/', '/projects/', '/blog/', '/gallery/', '/skills/', ...projectSlugs.map((s) => `/projects/${s}/`)];
const fileOf = (p) => `${p.replace(/^\//, '')}index.html`;
workPaths.forEach((p) => {
  i18n.LANGS.forEach((lang) => {
    const local = i18n.localPath(p, lang);
    const rel = fileOf(local);
    assert(fs.existsSync(path.join(root, rel)), `${rel} was not built`);
    const html = read(rel);
    assert(new RegExp(`<html[^>]* lang="${i18n.HTML_LANG[lang]}"`).test(html), `${rel}: html lang should be ${i18n.HTML_LANG[lang]}`);
    assert(!html.includes('scripts/i18n.js'), `${rel}: a static Work page must not load the runtime translator`);
    assert(/<script type="application\/json" id="ui-strings">\{/.test(html), `${rel}: missing the embedded #ui-strings`);
    assert(html.includes('hreflang="zh-CN"') && html.includes('hreflang="x-default"'), `${rel}: missing hreflang alternates`);
    assert(html.includes(`data-lang="${lang}" aria-current="true"`), `${rel}: the language switch should mark ${lang}`);
    if (lang === 'zh') assert(CJK.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), `${rel}: no Chinese on the Chinese page`);
  });
});
assert.equal(i18n.localPath('/usage/', 'zh'), '/usage/', '/usage/ has no /zh/ build yet');
assert.equal(i18n.localPath('/blog/feed.xml', 'zh'), '/blog/feed.xml');
assert.equal(i18n.localPath('/projects/kaboo/', 'zh'), '/zh/projects/kaboo/');

/* \u2500\u2500 Content overlay \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
assert.deepEqual(i18n.merge({ a: 'x', b: 'y' }, { a: 'X', b: '' }), { a: 'X', b: 'y' }, 'empty keeps the English');
assert.deepEqual(
  i18n.merge([{ id: 1, t: 'a' }, { id: 2, t: 'b' }], [{ id: 2, t: 'B' }]),
  [{ id: 1, t: 'a' }, { id: 2, t: 'B' }], 'lists with ids merge by id');
assert.deepEqual(i18n.merge([{ t: 'a' }, { t: 'b' }], [{ t: 'A' }, {}]), [{ t: 'A' }, { t: 'b' }], 'same-length lists merge by position');
assert.equal(i18n.t('shell.ask.send', 'zh') !== i18n.t('shell.ask.send', 'en'), true, 'zh strings should translate the shell');
assert.equal(i18n.t('no.such.key', 'zh'), 'no.such.key');

/* \u2500\u2500 Middleware \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
const mwLocalized = middlewareSource.match(/const LOCALIZED = (\/.*\/);/);
assert(mwLocalized && mwLocalized[1] === String(i18n.LOCALIZED), 'LOCALIZED must match scripts/lib/i18n.js');

(async () => {
  const encoded = Buffer.from(middlewareSource).toString('base64');
  const middleware = await import(`data:text/javascript;base64,${encoded}`);
  const run = (url, { country = 'US', cookie = '', ua = 'Mozilla/5.0', method = 'GET' } = {}) => middleware.onRequest({
    request: {
      url: `https://antaresyuan.site${url}`,
      method,
      cf: { country },
      headers: new Headers({ 'User-Agent': ua, ...(cookie ? { Cookie: cookie } : {}) }),
    },
    next: async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  });
  const loc = (r) => r.headers.get('Location');

  // Mainland China \u2192 the Chinese twin; nowhere else.
  let r = await run('/', { country: 'CN' });
  assert.equal(r.status, 302); assert.equal(loc(r), '/zh/');
  assert.match(r.headers.get('Set-Cookie'), /site_geo_lang=zh/);
  r = await run('/projects/kaboo/', { country: 'CN' });
  assert.equal(loc(r), '/zh/projects/kaboo/');
  for (const country of ['US', 'HK', 'TW', 'MO', 'SG']) {
    r = await run('/', { country });
    assert.equal(r.status, 200, `${country} should stay on English`);
    assert.equal(r.headers.get('Content-Language'), 'en');
    assert.match(r.headers.get('Set-Cookie'), /site_geo_lang=en/);
  }

  // A choice beats the location, both ways.
  r = await run('/', { country: 'CN', cookie: 'site_lang_pref=en' });
  assert.equal(r.status, 200); assert.equal(r.headers.get('Set-Cookie'), null);
  r = await run('/gallery/', { country: 'US', cookie: 'site_lang_pref=zh' });
  assert.equal(loc(r), '/zh/gallery/');

  // The switch: ?lang= sets the cookie and lands on the clean URL.
  r = await run('/projects/kaboo/?lang=zh');
  assert.equal(loc(r), '/zh/projects/kaboo/'); assert.match(r.headers.get('Set-Cookie'), /site_lang_pref=zh; Path=\/; Max-Age=\d+/);
  r = await run('/zh/blog/agent-answerable-site/?lang=en', { country: 'CN' });
  assert.equal(loc(r), '/blog/agent-answerable-site/'); assert.match(r.headers.get('Set-Cookie'), /site_lang_pref=en/);
  r = await run('/usage/?lang=zh');
  assert.equal(loc(r), '/usage/', 'a page without a /zh/ build keeps its URL');

  // Never redirected: /zh/ links, crawlers, pages without a twin, files, writes.
  r = await run('/zh/projects/', { country: 'US', cookie: 'site_lang_pref=en' });
  assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Language'), 'zh-Hans');
  r = await run('/', { country: 'CN', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
  assert.equal(r.status, 200);
  r = await run('/personal/', { country: 'CN' });
  assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Language'), 'zh-Hans');
  r = await run('/usage/', { country: 'CN' });
  assert.equal(r.status, 200);
  r = await run('/blog/feed.xml', { country: 'CN' });
  assert.equal(r.status, 200);
  r = await run('/', { country: 'CN', method: 'POST' });
  assert.equal(r.status, 200);

  console.log('i18n tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
