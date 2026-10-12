/* ════════════════════════════════════════════════════════════════════════
   Language at the edge (Cloudflare Pages Functions; routes: _routes.json).

   The Work pages exist twice: English at the site root, Chinese under /zh/
   (scripts/lib/i18n.js). Personal is one page that scripts/i18n.js
   translates in the browser. A visitor's language is
     1. what they picked — the site_lang_pref cookie, set here from the
        switch's ?lang= link (and by scripts/i18n.js on Personal);
     2. else Chinese from mainland China, English from anywhere else.
   The site_geo_lang cookie hands (2) to scripts/i18n.js.

   - A Chinese visitor opening an English Work page is sent to its /zh/ twin.
   - A /zh/ URL is never redirected: a shared link shows what was shared.
   - Crawlers are never redirected; hreflang tells them about both versions.
   ════════════════════════════════════════════════════════════════════════ */
const PREF_COOKIE = 'site_lang_pref';
const GEO_COOKIE = 'site_geo_lang';
const ZH_COUNTRIES = new Set(['CN']);           // mainland China only
const YEAR = 60 * 60 * 24 * 365;

// The Work pages that have a /zh/ twin — keep in step with LOCALIZED in
// scripts/lib/i18n.js (scripts/i18n.test.js checks the two agree).
const LOCALIZED = /^\/(?:$|projects\/|blog\/(?!feed\.xml)|gallery\/|skills\/)/;
const isPage = (p) => !/\.[a-z0-9]+$/i.test(p);
const hasZhTwin = (p) => LOCALIZED.test(p.endsWith('/') ? p : `${p}/`) && isPage(p);
const toZh = (p) => `/zh${p}`;
const fromZh = (p) => p.replace(/^\/zh(?=\/|$)/, '') || '/';

const BOT = /bot|crawl|spider|slurp|archiver|facebookexternalhit|embedly|preview|whatsapp|telegram|discord|slack|lighthouse|headless/i;

function cookie(header, name) {
  const m = String(header || '').match(new RegExp(`(?:^|;\\s*)${name}=(en|zh)(?:;|$)`));
  return m ? m[1] : '';
}

function countryLang(request) {
  const country = String(request.cf?.country || request.headers.get('CF-IPCountry') || '').toUpperCase();
  return ZH_COUNTRIES.has(country) ? 'zh' : 'en';
}

const secure = (url) => (url.protocol === 'https:' ? '; Secure' : '');

function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  cookies.forEach((c) => headers.append('Set-Cookie', c));
  return new Response(null, { status: 302, headers });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const reading = request.method === 'GET' || request.method === 'HEAD';

  // The language switch: remember the choice, then land on the clean URL in
  // that language.
  const picked = url.searchParams.get('lang');
  if (reading && (picked === 'en' || picked === 'zh')) {
    url.searchParams.delete('lang');
    const bare = fromZh(path);
    const target = picked === 'zh' && hasZhTwin(bare) ? toZh(bare) : picked === 'en' ? bare : path;
    return redirect(`${target}${url.search}`, [
      `${PREF_COOKIE}=${picked}; Path=/; Max-Age=${YEAR}; SameSite=Lax${secure(url)}`,
    ]);
  }

  const pref = cookie(request.headers.get('Cookie'), PREF_COOKIE);
  const lang = pref || countryLang(request);

  if (reading && lang === 'zh' && hasZhTwin(path) && !BOT.test(request.headers.get('User-Agent') || '')) {
    return redirect(`${toZh(path)}${url.search}`, pref ? [] : [`${GEO_COOKIE}=zh; Path=/; SameSite=Lax${secure(url)}`]);
  }

  const response = await context.next();
  const headers = new Headers(response.headers);
  // A /zh/ or English Work page is in its own language; Personal is
  // translated in the browser into the visitor's.
  const pageLang = path === '/zh' || path.startsWith('/zh/') ? 'zh' : hasZhTwin(path) ? 'en' : lang;
  headers.set('Content-Language', pageLang === 'zh' ? 'zh-Hans' : 'en');
  headers.set('Vary', [headers.get('Vary'), 'Cookie'].filter(Boolean).join(', '));
  if (!pref) headers.append('Set-Cookie', `${GEO_COOKIE}=${lang}; Path=/; SameSite=Lax${secure(url)}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
