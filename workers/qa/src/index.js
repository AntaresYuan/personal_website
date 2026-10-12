/* ════════════════════════════════════════════════════════════════════════
   antares-qa — "ask this portfolio" Q&A endpoint (Cloudflare Worker).

   POST /  { "messages": [{role, content}, …] } or { "q": "…" }, + "lang"?
   →  { answer, model, via: 'local' | 'cloud', verified }      on success
   →  { error, detail? }                                        on failure

   1. RETRIEVE — fetch /ask-index.json (the site cut into titled passages,
      scripts/build-ask-index.js). Embed the question with bge-m3
      (multilingual: a Chinese question finds English passages) and keep
      the best passages, plus the pinned ones (the owner's notes and an
      overview), within a character budget. The passage vectors are
      computed once per index version and cached. Without embeddings, a
      TF-IDF score does the ranking.
   2. ANSWER, LOCAL FIRST — if LOCAL_LLM_URL is set, ask the model running
      on Antares's Mac (ops/local-llm/: a Cloudflare Tunnel behind an Access
      service token, then a small proxy in front of Ollama). Unreachable,
      busy or slow → fall through; a failure parks the Mac for a minute so
      visitors don't each wait out the timeout.
   3. ANSWER, CLOUD — Workers AI generates, then a second low-temperature
      call fact-checks the draft against the same passages.

   Replies come in the visitor's language (lib.js → replyLang). First
   person as Antares, grounded only in the passages. No keys in the
   frontend; CORS is locked to the site origin (+ localhost for dev).
   ════════════════════════════════════════════════════════════════════════ */
import {
  normTurns, replyLang, searchText, lexicalScores, cosine, selectPassages, contextOf,
  matchFaqs, faqContextOf, genPrompt, verifyPrompt, stripThinking, packVectors, unpackVectors,
} from './lib.js';

const SITE = 'https://antaresyuan.site';
// Version the cache key when the corpus shape changes. The short TTL keeps a
// CMS save from taking ten minutes to reach answers, while embeddings remain
// cached by the index's content-derived version.
const INDEX_URL = `${SITE}/ask-index.json?corpus=faq-v1`;
const LLMS_FULL_URL = `${SITE}/llms-full.txt`;          // fallback when the index is missing
const CLOUD_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const EMBED_MODEL = '@cf/baai/bge-m3';
const BUDGET = { cloud: 9000, local: 12000 };           // context characters
const LOCAL_TIMEOUT_MS = 25000;               // a cold model load takes ~20 s
const DOWN_KEY = 'https://qa-cache.internal/local-down';
const vecKey = (version) => `https://qa-cache.internal/vectors/${version}`;

function cors(origin) {
  const ok = origin === SITE
    || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
}

function reply(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(headers || {}) },
  });
}

const grab = async (url, type = 'text', cacheTtl = 600) => {
  try {
    const r = await fetch(url, { cf: { cacheTtl, cacheEverything: true } });
    if (!r.ok) return null;
    return type === 'json' ? await r.json() : (await r.text()).trim();
  } catch { return null; }
};

/* ── Retrieval ──────────────────────────────────────────────────────────── */
async function embed(env, texts) {
  const out = await env.AI.run(EMBED_MODEL, { text: texts });
  const vecs = out?.data ?? out?.response;
  if (!Array.isArray(vecs) || vecs.length !== texts.length) throw new Error('embedding shape');
  return vecs;
}

// Passage vectors for this index version: from the cache, or computed now.
async function passageVectors(env, ctx, index) {
  const cache = caches.default;
  const key = vecKey(index.version);
  const hit = await cache.match(key);
  if (hit) return unpackVectors(await hit.json());
  const texts = index.chunks.map((c) => `${c.title}\n${c.text}`);
  const batches = [];
  for (let i = 0; i < texts.length; i += 48) batches.push(texts.slice(i, i + 48));
  const vecs = (await Promise.all(batches.map((b) => embed(env, b)))).flat();
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(packVectors(vecs)), {
    headers: { 'content-type': 'application/json', 'cache-control': 'max-age=604800' },
  })));
  return vecs;
}

async function retrieve(env, ctx, index, query, budget) {
  const lexical = lexicalScores(query, index.chunks);
  let semantic = null;
  try {
    const [vecs, [qv]] = await Promise.all([passageVectors(env, ctx, index), embed(env, [query])]);
    semantic = vecs.map((v) => cosine(qv, v));
  } catch { /* embeddings unavailable — the lexical score ranks alone */ }
  return selectPassages(index.chunks, { semantic, lexical, budget });
}

/* ── Answering ──────────────────────────────────────────────────────────── */
// The model on Antares's Mac, through the tunnel. null = not this time.
async function askLocal(env, messages) {
  if (!env.LOCAL_LLM_URL) return null;
  const cache = caches.default;
  if (await cache.match(DOWN_KEY)) return null;
  const park = () => cache.put(DOWN_KEY, new Response('1', { headers: { 'cache-control': 'max-age=60' } }));
  try {
    const r = await fetch(`${env.LOCAL_LLM_URL.replace(/\/$/, '')}/chat`, {
      method: 'POST',
      redirect: 'manual',             // an Access login redirect is a failure, not a page to follow
      headers: {
        'content-type': 'application/json',
        ...(env.ACCESS_CLIENT_ID ? { 'CF-Access-Client-Id': env.ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': env.ACCESS_CLIENT_SECRET } : {}),
      },
      body: JSON.stringify({ messages, max_tokens: 700, temperature: 0.3 }),
      signal: AbortSignal.timeout(Number(env.LOCAL_TIMEOUT_MS) || LOCAL_TIMEOUT_MS),
    });
    if (r.status === 503) return null;   // busy with another visitor: fall back, but don't park
    if (!r.ok) { await park(); return null; }
    const d = await r.json();
    const answer = stripThinking(d.answer);
    if (!answer) return null;
    return { answer, model: String(d.model || 'local'), via: 'local', verified: false };
  } catch {
    await park();
    return null;
  }
}

async function cloud(env, messages, temperature, maxTokens) {
  const out = await env.AI.run(env.CLOUD_MODEL || CLOUD_MODEL, { messages, max_tokens: maxTokens, temperature });
  return String((out && (out.response ?? out.result ?? '')) || '').trim();
}

async function askCloud(env, context, lang, turns) {
  const draft = await cloud(env, [{ role: 'system', content: genPrompt(context, lang) }, ...turns], 0.2, 480);
  if (!draft) throw new Error('the model returned an empty answer');
  let answer = draft, verified = false;
  try {
    const checked = await cloud(env, [{ role: 'system', content: verifyPrompt(context, lang) }, { role: 'user', content: `DRAFT:\n${draft}` }], 0.1, 480);
    if (checked) { answer = checked; verified = true; }
  } catch { /* verify unavailable — keep the grounded draft */ }
  return { answer, model: env.CLOUD_MODEL || CLOUD_MODEL, via: 'cloud', verified };
}

/* ── Entry ──────────────────────────────────────────────────────────────── */
export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const ch = cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });
    if (request.method !== 'POST') return reply({ error: 'POST JSON: { "q": "…" } or { "messages": [{role,content},…] }' }, 405, ch);

    if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === 'function') {
      const ip = request.headers.get('CF-Connecting-IP') || 'anon';
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return reply({ error: 'rate limited — slow down a moment' }, 429, ch);
    }

    let body;
    try { body = await request.json(); } catch { return reply({ error: 'invalid JSON body' }, 400, ch); }
    const turns = normTurns(body);
    if (!turns.length) return reply({ error: 'no question — send { "q": "…" } or a "messages" array ending with a user turn' }, 400, ch);
    const lang = replyLang(turns[turns.length - 1].content, body.lang);
    const query = searchText(turns);

    // Grounding: the passage index; the old whole-site text if it's missing.
    const index = await grab(env.INDEX_URL || INDEX_URL, 'json', 60);
    let localCtx, cloudCtx;
    if (index && Array.isArray(index.chunks) && index.chunks.length) {
      const faqCtx = faqContextOf(matchFaqs(index.faqs, query));
      const siteBudget = Math.max(2000, BUDGET.local - faqCtx.length);
      const wide = await retrieve(env, ctx, index, query, siteBudget);
      localCtx = [faqCtx, contextOf(wide)].filter(Boolean).join('\n\n');
      // The cloud budget is a prefix of the same ranking: pinned first, then by score.
      let used = 0;
      const cloudSiteBudget = Math.max(1500, BUDGET.cloud - faqCtx.length);
      const cloudPassages = wide.filter((c) => {
        if (c.pin) { used += c.text.length; return true; }
        if (used + c.text.length > cloudSiteBudget) return false;
        used += c.text.length;
        return true;
      });
      cloudCtx = [faqCtx, contextOf(cloudPassages)].filter(Boolean).join('\n\n');
    } else {
      const site = await grab(LLMS_FULL_URL);
      if (!site) return reply({ error: "couldn't load the site content to ground the answer" }, 502, ch);
      localCtx = site.slice(0, BUDGET.local);
      cloudCtx = site.slice(0, BUDGET.cloud);
    }

    const local = await askLocal(env, [{ role: 'system', content: genPrompt(localCtx, lang) }, ...turns]);
    if (local) return reply(local, 200, ch);
    try {
      return reply(await askCloud(env, cloudCtx, lang, turns), 200, ch);
    } catch (e) {
      return reply({ error: 'generation failed', detail: String((e && e.message) || e) }, 502, ch);
    }
  },
};
