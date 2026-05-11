/* ════════════════════════════════════════════════════════════════════════
   antares-qa — "ask this portfolio" Q&A endpoint (Cloudflare Worker).

   POST /  with JSON body { "q": "<a question>" }
   →  { "answer": "<first-person prose>", "model": "<id>", "verified": <bool> }   on success
   →  { "error": "<reason>", "detail"? }                                          on failure (4xx/5xx)

   What it does:
     1. fetch https://<SITE>/llms-full.txt  — the full content of Antares's
        site (projects, principles, contact, bio), the ONLY source of truth.
     2. GENERATE — Workers AI answers in the FIRST PERSON as Antares, told to
        ground every fact in that content and never invent.
     3. VERIFY (anti-hallucination pass) — a second, low-temperature call
        rewrites the draft so every claim is supported by the content,
        keeping the first-person voice. If it fails, the (prompt-grounded)
        draft is returned and `verified` is false.

   First person ("I built…"), grounded, fact-checked. No keys in the
   frontend; CORS is locked to the site origin (+ localhost for dev). Powers
   the hero "ask" bar and the terminal's `ask` command. (The ⌘K palette is a
   plain search/launcher and needs no Worker.)

   Deploy: see wrangler.toml. Free tier covers a personal site's volume.
   ════════════════════════════════════════════════════════════════════════ */

const SITE = 'https://antaresyuan.site';
const LLMS_FULL_URL = `${SITE}/llms-full.txt`;
const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';   // alt: @cf/meta/llama-3.1-8b-instruct, @cf/meta/llama-3.3-70b-instruct-fp8-fast
const MAX_Q_CHARS = 500;
const MAX_CONTEXT_CHARS = 16000;

// Pass 1 — generate, in Antares's first-person voice, strictly from the content.
const GEN_PROMPT = (context) => `You are an AI assistant that answers in the FIRST PERSON as Antares Yuan (an AI Product Manager) — say "I", "my", "I built…". You speak only from the CONTEXT below, which is the full content of Antares's site (projects shipped / in progress / planned, principles, contact, bio).

Hard rules — these matter more than sounding good:
1. GROUND EVERYTHING. Every factual claim — project names, what a project does, dates, numbers ("cited by 2 papers", "saved 10 hrs"), where I studied, what I'm open to, the tech stack, anything specific — must be supported by the CONTEXT. You may rephrase, connect stated facts, and tell it as flowing first-person prose; you may NOT introduce any fact that isn't in the CONTEXT.
2. NEVER INVENT. No invented metrics, durations, team sizes, company names, dates, quotes, or "obvious-sounding" details. Example: the CONTEXT says "Worth Fly — flight search, decision support, alert drafts." Do NOT write "Worth Fly, which I spent six months building with a small team" — there is no six months and no team in the CONTEXT.
3. GAPS. If the CONTEXT doesn't cover what's asked, say so in first person — "I haven't written that up here yet" / "that's not something this page covers" — don't guess or fill in plausible details. Match the depth of the CONTEXT: a one-line summary → a brief answer; don't pad a one-liner into a story.
4. GREETINGS / SMALL TALK (hi, hello, how are you, thanks): reply briefly and warmly in first person, then invite a question about my work — don't say "not covered".
5. STYLE: first person, plain conversational prose — no markdown headings or bullet lists, no code, no fabricated links. A line for a quick fact; a short paragraph (3–6 sentences) for a project's story.

CONTEXT:
${context}`;

// Pass 2 — strict fact-check + minimal rewrite (the anti-hallucination pass).
const VERIFY_PROMPT = (context) => `You are a strict fact-checker. Below is CONTEXT (the full content of Antares Yuan's site) and a DRAFT answer written in the first person as Antares. Return a corrected version of the DRAFT in which EVERY factual claim is supported by the CONTEXT:
- Remove or soften any claim, number, date, name, duration, or detail not present in the CONTEXT.
- Keep the first-person voice, the conversational tone, and the flow.
- Add nothing. Don't tack on caveats like "based on the site" — just make the prose accurate.
- If the DRAFT is already fully grounded, return it unchanged.
Output ONLY the corrected answer text — no preamble, no commentary.

CONTEXT:
${context}`;

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
    : { Vary: 'Origin' };   // no ACAO ⇒ a browser on another origin is blocked
}

function reply(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(headers || {}) },
  });
}

async function ai(env, system, user, temperature, maxTokens) {
  const out = await env.AI.run(MODEL, {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: maxTokens,
    temperature,
  });
  return String((out && (out.response ?? out.result ?? '')) || '').trim();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const ch = cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });
    if (request.method !== 'POST') return reply({ error: 'POST a JSON body: { "q": "your question" }' }, 405, ch);

    // Optional per-IP rate limit (only if the RATE_LIMITER binding is configured — see wrangler.toml).
    if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === 'function') {
      const ip = request.headers.get('CF-Connecting-IP') || 'anon';
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return reply({ error: 'rate limited — slow down a moment' }, 429, ch);
    }

    let body;
    try { body = await request.json(); } catch { return reply({ error: 'invalid JSON body' }, 400, ch); }
    const q = String((body && body.q) || '').trim().slice(0, MAX_Q_CHARS);
    if (!q) return reply({ error: 'missing "q" (the question)' }, 400, ch);

    // Grounding context: the site's own content dump. Cached at the edge.
    let context = '';
    try {
      const r = await fetch(LLMS_FULL_URL, { cf: { cacheTtl: 600, cacheEverything: true } });
      if (r.ok) context = (await r.text()).trim().slice(0, MAX_CONTEXT_CHARS);
    } catch { /* fall through */ }
    if (!context) return reply({ error: "couldn't load the site content to ground the answer" }, 502, ch);

    // Pass 1 — generate.
    let draft;
    try { draft = await ai(env, GEN_PROMPT(context), q, 0.2, 420); }
    catch (e) { return reply({ error: 'generation failed', detail: String((e && e.message) || e) }, 502, ch); }
    if (!draft) return reply({ error: 'the model returned an empty answer' }, 502, ch);

    // Pass 2 — fact-check + minimal rewrite. If it fails, keep the draft.
    let answer = draft, verified = false;
    try {
      const checked = await ai(env, VERIFY_PROMPT(context), `DRAFT:\n${draft}`, 0.1, 420);
      if (checked) { answer = checked; verified = true; }
    } catch { /* verify unavailable — return the (prompt-grounded) draft */ }

    return reply({ answer, model: MODEL, verified }, 200, ch);
  },
};
