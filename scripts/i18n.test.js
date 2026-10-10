#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const middlewareSource = fs.readFileSync(path.join(root, 'functions/_middleware.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'scripts/i18n.js'), 'utf8');

assert(clientSource.includes("var COOKIE = 'site_lang_pref'"));
assert(clientSource.includes("var GEO_COOKIE = 'site_geo_lang'"));
assert(clientSource.includes('dataLanguageToggle') || clientSource.includes('languageToggle'));
assert(!/[\u4e00-\u9fff]/.test(clientSource), 'keep public source ASCII-only; use Unicode escapes');

const requiredPages = [
  'index.html',
  'gallery/index.html',
  'personal/index.html',
  'projects/index.html',
  'skills/index.html',
  'usage/index.html',
];
const site = JSON.parse(fs.readFileSync(path.join(root, 'content/site.json'), 'utf8'));
if (site.features?.about !== false) {
  requiredPages.push('about/index.html');
} else {
  const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const about = fs.readFileSync(path.join(root, 'about/index.html'), 'utf8');
  const redirects = fs.readFileSync(path.join(root, '_redirects'), 'utf8');
  assert(!home.includes('data-id="about"'), 'disabled About must not appear in the rail');
  assert(about.includes('name="robots" content="noindex,nofollow"'));
  assert(about.includes("location.replace('/')"));
  assert(redirects.includes('/about/* / 302'));
}
const workPages = fs.readdirSync(path.join(root, 'work')).map((slug) => `work/${slug}/index.html`);
requiredPages.push(...workPages);
requiredPages.forEach((relative) => {
  const html = fs.readFileSync(path.join(root, relative), 'utf8');
  assert(html.includes('scripts/i18n.js'), `${relative} is missing the i18n runtime`);
});

(async () => {
  const encoded = Buffer.from(middlewareSource).toString('base64');
  const middleware = await import(`data:text/javascript;base64,${encoded}`);
  const run = (country, cookie = '') => middleware.onRequest({
    request: {
      cf: { country },
      headers: new Headers(cookie ? { Cookie: cookie } : {}),
    },
    next: async () => new Response('<!doctype html>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
  });

  const china = await run('CN');
  assert.equal(china.headers.get('Content-Language'), 'zh-Hans');
  assert.match(china.headers.get('Set-Cookie'), /site_geo_lang=zh/);

  const taiwan = await run('TW');
  assert.equal(taiwan.headers.get('Content-Language'), 'zh-Hans');

  const usa = await run('US');
  assert.equal(usa.headers.get('Content-Language'), 'en');
  assert.match(usa.headers.get('Set-Cookie'), /site_geo_lang=en/);

  const override = await run('CN', 'site_lang_pref=en');
  assert.equal(override.headers.get('Content-Language'), 'en');
  assert.equal(override.headers.get('Set-Cookie'), null);

  const moved = await run('CN', 'site_geo_lang=en');
  assert.equal(moved.headers.get('Content-Language'), 'zh-Hans');
  assert.match(moved.headers.get('Set-Cookie'), /site_geo_lang=zh/);

  const oldAutomaticCookie = await run('CN', 'site_lang=en');
  assert.equal(oldAutomaticCookie.headers.get('Content-Language'), 'zh-Hans');

  console.log('i18n tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
