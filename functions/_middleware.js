const LANGUAGE_PREFERENCE_COOKIE = 'site_lang_pref';
const LANGUAGE_GEO_COOKIE = 'site_geo_lang';
const CHINESE_REGIONS = new Set(['CN', 'HK', 'MO', 'TW']);

function cookieLanguage(header, name) {
  const pattern = new RegExp(`(?:^|;\\s*)${name}=(en|zh)(?:;|$)`);
  const match = String(header || '').match(pattern);
  return match ? match[1] : '';
}

function countryLanguage(request) {
  const country = String(
    request.cf?.country || request.headers.get('CF-IPCountry') || ''
  ).toUpperCase();
  return CHINESE_REGIONS.has(country) ? 'zh' : 'en';
}

function responseWithLanguage(response, language, setGeoCookie) {
  const headers = new Headers(response.headers);
  headers.set('Content-Language', language === 'zh' ? 'zh-Hans' : 'en');
  headers.set('Vary', [headers.get('Vary'), 'Cookie'].filter(Boolean).join(', '));
  if (setGeoCookie) {
    headers.append(
      'Set-Cookie',
      `${LANGUAGE_GEO_COOKIE}=${language}; Path=/; SameSite=Lax; Secure`
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest(context) {
  const preference = cookieLanguage(
    context.request.headers.get('Cookie'),
    LANGUAGE_PREFERENCE_COOKIE
  );
  const language = preference || countryLanguage(context.request);
  const response = await context.next();
  return responseWithLanguage(response, language, !preference);
}
