/* ─────────────────────────────────────────────────────────────────────────
   Pure helpers for the qa Worker — no bindings, no I/O — so test/lib.test.js
   can run them under plain Node: shaping the conversation, choosing the
   reply language, scoring passages, filling the context budget, and the
   prompts themselves.
   ───────────────────────────────────────────────────────────────────────── */

export const MAX_MSG_CHARS = 600;     // per turn (user or assistant)
export const MAX_TURNS = 8;           // recent turns kept

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/* The request → a clean alternating user/assistant list ending with a user
   turn. Accepts { messages: [{role,content}, …] } or { q: "…" }; [] when
   there is nothing to answer. */
export function normTurns(body) {
  let turns = [];
  if (body && Array.isArray(body.messages)) {
    turns = body.messages
      .map((m) => ({
        role: (m && m.role === 'assistant') ? 'assistant' : 'user',
        content: String((m && m.content) || '').trim().slice(0, MAX_MSG_CHARS),
      }))
      .filter((m) => m.content);
  } else {
    const q = String((body && body.q) || '').trim().slice(0, MAX_MSG_CHARS);
    if (q) turns = [{ role: 'user', content: q }];
  }
  const collapsed = [];
  for (const t of turns) {
    if (collapsed.length && collapsed[collapsed.length - 1].role === t.role) collapsed[collapsed.length - 1].content += '\n' + t.content;
    else collapsed.push({ ...t });
  }
  const recent = collapsed.slice(-MAX_TURNS);
  return (recent.length && recent[recent.length - 1].role === 'user') ? recent : [];
}

/* Reply in the language the visitor writes in; the page's language decides
   only when the question has no letters of either kind ("SusBench?" is
   Latin, so English). */
export function replyLang(question, pageLang) {
  const q = String(question || '');
  if (CJK.test(q)) return 'zh';
  if (/[A-Za-z]/.test(q)) return 'en';
  return String(pageLang || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/* What to search with: the latest question, plus the one before it, so a
   follow-up like "and the metrics?" still finds its project. */
export function searchText(turns) {
  const users = turns.filter((t) => t.role === 'user').map((t) => t.content);
  return users.slice(-2).join('\n');
}

/* Tokens for lexical matching: lower-cased Latin words of 3+ letters, and
   CJK as overlapping character pairs (no word boundaries to split on). */
export function tokens(text) {
  const s = String(text || '').toLowerCase();
  const out = (s.match(/[a-z0-9][a-z0-9+.-]{2,}/g) || []).map((w) => w.replace(/[.-]+$/, ''));
  const han = s.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) || [];
  for (const run of han) {
    if (run.length === 1) out.push(run);
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

const STOP = new Set(['the', 'and', 'what', 'how', 'did', 'does', 'you', 'your', 'are', 'was', 'for', 'with', 'about', 'this', 'that', 'have', 'which', 'who', 'why', 'when', 'where', 'can', 'tell', 'more']);

const normalizedQuestion = (text) => String(text || '').normalize('NFKC').toLowerCase()
  .replace(/[^a-z0-9\u3400-\u9fff\uf900-\ufaff+]+/g, ' ').trim();

/* A cheap FAQ-first pass: canonical questions and owner-supplied aliases are
   matched deterministically before the general passage retrieval. This is
   deliberately lexical ("grep FAQ"), not another LLM call. The CMS can add
   English and Chinese aliases for reliable cross-language matching. */
export function matchFaqs(faqs, query, limit = 2) {
  if (!Array.isArray(faqs) || !String(query || '').trim()) return [];
  const qNorm = normalizedQuestion(query);
  const qTokens = [...new Set(tokens(query).filter((t) => !STOP.has(t)))];
  if (!qNorm || !qTokens.length) return [];

  return faqs.map((faq) => {
    const variants = [faq && faq.question, ...(Array.isArray(faq && faq.aliases) ? faq.aliases : [])]
      .map((x) => String(x || '').trim()).filter(Boolean);
    let score = 0, matched = false;
    for (const variant of variants) {
      const vNorm = normalizedQuestion(variant);
      const exact = vNorm === qNorm || (Math.min(vNorm.length, qNorm.length) >= 8 && (vNorm.includes(qNorm) || qNorm.includes(vNorm)));
      const vTokens = [...new Set(tokens(variant).filter((t) => !STOP.has(t)))];
      const overlap = qTokens.filter((t) => vTokens.includes(t)).length;
      const queryCoverage = overlap / Math.max(1, qTokens.length);
      const variantCoverage = overlap / Math.max(1, vTokens.length);
      const eligible = exact || overlap >= 2 || (qTokens.length === 1 && overlap === 1) || queryCoverage >= 0.6;
      if (!eligible) continue;
      matched = true;
      score = Math.max(score, exact ? 100 : queryCoverage * 4 + variantCoverage * 2 + overlap * 0.35);
    }
    // A visitor may quote a fact from the brief rather than its question.
    // Treat strong answer-text overlap as a weaker match than q/alias overlap.
    if (!matched) {
      const answerTokens = [...new Set(tokens(faq && faq.answer).filter((t) => !STOP.has(t)))];
      const overlap = qTokens.filter((t) => answerTokens.includes(t)).length;
      const coverage = overlap / Math.max(1, qTokens.length);
      if (overlap >= 2 && coverage >= 0.5) {
        matched = true;
        score = coverage * 2 + overlap * 0.2;
      }
    }
    return { faq, score, matched };
  }).filter((x) => x.matched && x.faq && x.faq.answer)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
    .map((x) => x.faq);
}

export const faqContextOf = (faqs) => (faqs || []).map((faq) => [
  `### FAQ guidance: ${String(faq.question || '').trim()}`,
  'This answer brief was written by Antares and is authoritative for this question:',
  String(faq.answer || '').trim(),
  faq.href ? `Related page: ${faq.href}` : '',
].filter(Boolean).join('\n')).join('\n\n');

/* A small TF-IDF score of each passage against the query — the fallback
   when embeddings are unavailable, and a nudge for exact names when they
   are. Titles count double. */
export function lexicalScores(query, chunks) {
  const q = [...new Set(tokens(query))].filter((t) => !STOP.has(t));
  if (!q.length) return chunks.map(() => 0);
  const docs = chunks.map((c) => {
    const tf = new Map();
    for (const t of tokens(c.text)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tokens(c.title)) tf.set(t, (tf.get(t) || 0) + 2);
    return tf;
  });
  const n = docs.length;
  const idf = new Map(q.map((t) => [t, Math.log(1 + n / (1 + docs.filter((d) => d.has(t)).length))]));
  return docs.map((d) => q.reduce((s, t) => s + (d.has(t) ? (1 + Math.log(d.get(t))) * idf.get(t) : 0), 0));
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/* Pinned passages always; then the best-scoring ones until the budget (in
   characters) is spent. `semantic` (cosine, or null) leads; the lexical
   score, scaled to at most 0.15, breaks ties toward exact names. */
export function selectPassages(chunks, { semantic, lexical, budget }) {
  const picked = chunks.filter((c) => c.pin);
  let used = picked.reduce((s, c) => s + c.text.length, 0);
  const maxLex = Math.max(1e-9, ...lexical);
  const ranked = chunks
    .map((c, i) => ({ c, i, s: (semantic ? semantic[i] : 0) + 0.15 * (lexical[i] / maxLex) }))
    .filter((x) => !x.c.pin && (semantic || lexical[x.i] > 0))
    .sort((a, b) => b.s - a.s);
  for (const { c } of ranked) {
    if (used + c.text.length > budget) continue;
    picked.push(c);
    used += c.text.length;
    if (used > budget * 0.95) break;
  }
  return picked;
}

export const contextOf = (passages) => passages
  .map((c) => `### ${c.title}${c.url ? ` (${c.url})` : ''}\n${c.text}`)
  .join('\n\n');

const LANG_RULE = {
  en: 'Reply in English.',
  zh: 'Reply in Simplified Chinese, even though the CONTEXT is mostly English. Keep names of projects, products and models as written.',
};

// Pass 1 — generate, in Antares's first-person voice, strictly from the context.
export const genPrompt = (context, lang) => `You are an AI assistant that answers in the FIRST PERSON as Antares Yuan (an AI Product Manager) — say "I", "my", "I built…". You speak only from the CONTEXT below: passages from Antares's site (case studies, projects, skills, writing, gallery, contact, bio) and background notes Antares wrote for you. ${LANG_RULE[lang] || LANG_RULE.en}

Hard rules — these matter more than sounding good:
1. FAQ FIRST. When CONTEXT contains “FAQ guidance”, treat its answer brief as Antares's authoritative position and narrative. Preserve its intent and key points. Use the rest of the site context only to support or expand it; never contradict or replace it.
2. GROUND EVERYTHING. Every factual claim — project names, what a project does, dates, numbers, where I studied, what I'm open to, the tech stack, anything specific — must be supported by the CONTEXT. You may rephrase, connect stated facts, and tell it as flowing first-person prose; you may NOT introduce any fact that isn't in the CONTEXT.
3. NEVER INVENT. No invented metrics, durations, team sizes, company names, dates, quotes, or "obvious-sounding" details.
4. GAPS. If the CONTEXT doesn't cover what's asked, say so in first person — "I haven't written that up here yet" — don't guess. Match the depth of the CONTEXT: a one-line summary → a brief answer.
5. GREETINGS / SMALL TALK (hi, thanks): reply briefly and warmly in first person, then invite a question about my work.
6. STYLE: first person, plain conversational prose — no markdown headings, bullet lists, code, or links. A line for a quick fact; a short paragraph (3–6 sentences) for a project's story. You may name the page a project lives on (e.g. /projects/kaboo/) if it helps.

CONTEXT:
${context}`;

// Pass 2 — strict fact-check + minimal rewrite (the anti-hallucination pass).
export const verifyPrompt = (context, lang) => `You are a strict fact-checker. Below is CONTEXT (Antares Yuan's site content plus background notes he wrote) and a DRAFT answer written in the first person as Antares. Return a corrected version of the DRAFT in which EVERY factual claim is supported by the CONTEXT:
- If CONTEXT contains “FAQ guidance”, preserve that authoritative answer brief's intent and key points; remove any contradiction.
- Remove or soften any claim, number, date, name, duration, or detail not present in the CONTEXT.
- Keep the first-person voice, the conversational tone, the flow, and the DRAFT's language. ${LANG_RULE[lang] || LANG_RULE.en}
- Add nothing. Don't tack on caveats like "based on the site" — just make the prose accurate.
- If the DRAFT is already fully grounded, return it unchanged.
Output ONLY the corrected answer text — no preamble, no commentary.

CONTEXT:
${context}`;

/* Some local models think aloud in <think>…</think> before answering. */
export const stripThinking = (s) => String(s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

/* Float32 vectors ⇄ base64, for caching the passage embeddings compactly. */
export function packVectors(vectors) {
  const dim = vectors[0]?.length || 0;
  const buf = new Float32Array(vectors.length * dim);
  vectors.forEach((v, i) => buf.set(v, i * dim));
  const bytes = new Uint8Array(buf.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { dim, n: vectors.length, b64: btoa(bin) };
}
export function unpackVectors({ dim, n, b64 }) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const all = new Float32Array(bytes.buffer);
  return Array.from({ length: n }, (_, i) => all.subarray(i * dim, (i + 1) * dim));
}
