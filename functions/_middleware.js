const LANGUAGE_COOKIE = 'site_lang';
const CHINESE_REGIONS = new Set(['CN', 'HK', 'MO', 'TW']);

function cookieLanguage(header) {
  const match = String(header || '').match(/(?:^|;\s*)site_lang=(en|zh)(?:;|$)/);
  return match ? match[1] : '';
}

function countryLanguage(request) {
  const country = String(
    request.cf?.country || request.headers.get('CF-IPCountry') || ''
  ).toUpperCase();
  return CHINESE_REGIONS.has(country) ? 'zh' : 'en';
}

function responseWithLanguage(response, language, setCookie) {
  const headers = new Headers(response.headers);
  headers.set('Content-Language', language === 'zh' ? 'zh-Hans' : 'en');
  headers.set('Vary', [headers.get('Vary'), 'Cookie'].filter(Boolean).join(', '));
  if (setCookie) {
    headers.append(
      'Set-Cookie',
      `${LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest(context) {
  const saved = cookieLanguage(context.request.headers.get('Cookie'));
  const language = saved || countryLanguage(context.request);
  const response = await context.next();
  return responseWithLanguage(response, language, !saved);
}
