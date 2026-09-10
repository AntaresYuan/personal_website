/* Same-origin proxy for the private usage detail feed.
 *
 * Why this exists at all — two problems that solve each other:
 *
 * 1. CORS. The old Owner view had the browser fetch
 *    usage.antaresyuan.site/detail directly, cross-origin. But /detail
 *    deliberately sends no Access-Control-Allow-Origin (private data must
 *    not be readable by any random page), so that fetch NEVER worked: it
 *    died at the preflight with "Response to preflight request doesn't pass
 *    access control check", not at auth. Verified in a real browser before
 *    writing this. Routing through the site's own origin means no preflight
 *    and no CORS at all.
 *
 * 2. Login. Cloudflare Access runs BEFORE the request reaches any Worker or
 *    Function, so it cannot be attached to usage.antaresyuan.site as a whole
 *    without also blocking the CLI — launchd has no browser and cannot pass
 *    an email OTP, so every machine's upload would start failing. Protecting
 *    just THIS path leaves the CLI's POST / and GET /detail untouched.
 *
 * The bearer never reaches the browser. It lives in a Pages environment
 * variable (USAGE_DETAIL_TOKEN) and is attached here, server-side. The
 * browser's proof of identity is the Access session, which Cloudflare
 * validates at the edge before this code runs.
 *
 * Defence in depth: Access is the gate, but if it is ever misconfigured or
 * removed, this checks for the Access JWT itself and refuses to serve
 * private data without one — so the failure mode is "locked out", never
 * "silently public".
 */

const UPSTREAM = 'https://usage.antaresyuan.site';

/* Cloudflare injects these on every request that passed Access. Their mere
   presence is not proof on its own (a client could send the header), which is
   why the real gate is Access at the edge; but their ABSENCE is proof that
   Access did not run, and that is the case worth failing closed on. */
const JWT_HEADER = 'cf-access-jwt-assertion';
const JWT_COOKIE = 'CF_Authorization';

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Private data must never be cached by a shared cache or the browser.
      'cache-control': 'no-store, private',
      ...(extra || {}),
    },
  });
}

function hasAccessSession(request) {
  if (request.headers.get(JWT_HEADER)) return true;
  const cookie = request.headers.get('cookie') || '';
  // Match the cookie name at a boundary so CF_AuthorizationSomethingElse
  // cannot satisfy it.
  return new RegExp('(?:^|;\\s*)' + JWT_COOKIE + '=').test(cookie);
}

export async function onRequestGet({ request, env }) {
  if (!hasAccessSession(request)) {
    return json({
      error: 'not signed in',
      hint: 'This endpoint is protected by Cloudflare Access. Open /usage/ and sign in.',
    }, 401);
  }

  const token = env.USAGE_DETAIL_TOKEN;
  if (!token) {
    // Distinct from 401 on purpose: this is the site's own misconfiguration,
    // not the visitor failing to authenticate. Conflating them would send me
    // hunting a login bug when the real problem is a missing binding.
    return json({
      error: 'detail proxy not configured',
      hint: 'Set the USAGE_DETAIL_TOKEN environment variable on the Pages project.',
    }, 503);
  }

  // Pass through only `days`, and only as a bounded integer. Forwarding the
  // whole query string would let a caller reach any future upstream
  // parameter through a door that is meant to expose exactly one feed.
  const days = parseInt(new URL(request.url).searchParams.get('days') || '', 10);
  const n = Number.isInteger(days) && days > 0 && days <= 365 ? days : 365;

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}/detail?days=${n}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return json({ error: 'upstream unreachable', detail: String(e && e.message || e) }, 502);
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    // Surface the upstream status so a stale/rotated token reads as 401 here
    // rather than as an empty-but-successful response, which would render as
    // "you have no usage" — a wrong answer dressed up as a working page.
    return json({ error: 'upstream rejected the request', status: upstream.status }, 502);
  }

  return new Response(text, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, private',
    },
  });
}
