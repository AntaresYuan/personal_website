/* ════════════════════════════════════════════════════════════════════════
   Skills: who answers a question. Pure: no bindings, no I/O, so the routing
   can be tested offline (test/routing.test.js runs a bilingual eval set).

   Each skill is a SKILL.md in content/agent/skills/ (CMS → Agent infra →
   Skills): a title, a description of when it is used, the tools it may
   call, and its instructions, which become the SKILL part of the system
   prompt. ask-index.json → skills carries them here. This file is where
   "when it is used" is decided, by rules rather than by a model, so every
   description should say what the rule below does:

     token-usage          my own token usage, and no Work item named
     qa                   one of the owner's QA pairs
     share-files          a request for a file or link
     project-walkthrough  a named Work item (project, AI skill, post,
                          gallery piece), or a short follow-up to one
     general              anything else

   Order matters: token-usage, then an exact QA pair, then share-files, a
   named item, a looser QA pair, a follow-up, and general. Intents are read
   from the current question only, with any item names taken out first, so
   "/ai-pm-resume" is not a résumé request and "Kaboo token usage" is not a
   question about my tokens. A skill switched off in the CMS, or without the
   tool it needs, is skipped; general is always there.
   ════════════════════════════════════════════════════════════════════════ */
import { scoreFaqs, wantsUsage } from './lib.js';

export const SKILL_IDS = ['token-usage', 'qa', 'share-files', 'project-walkthrough', 'general'];

/* ── Named Work items ─────────────────────────────────────────────────── */
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HAN = /[\u3400-\u9fff]/;

// Where a name occurs in the text: -1 if it doesn't. Latin names must stand
// as whole words ("Kaboo", not "kaboos"); Chinese has no word boundaries.
const findName = (text, name) => {
  const n = norm(name);
  if (HAN.test(n)) return text.indexOf(n);
  const m = new RegExp(`(?<![a-z0-9])${escapeRe(n)}(?![a-z0-9])`).exec(text);
  return m ? m.index : -1;
};

/* The Work items named in `text`, in the order they appear. A name inside a
   longer one that also matched ("Kaboo" inside "Kaboo Pro") is not counted
   twice. → [{ entity, at, name }] */
export function namedItems(text, entities) {
  const t = norm(text);
  const hits = [];
  for (const entity of Array.isArray(entities) ? entities : []) {
    let best = null;
    for (const name of entity.names || []) {
      const at = findName(t, name);
      if (at >= 0 && (!best || norm(name).length > best.name.length)) best = { entity, at, name: norm(name) };
    }
    if (best) hits.push(best);
  }
  hits.sort((a, b) => a.at - b.at || b.name.length - a.name.length);
  const out = [];
  for (const hit of hits) {
    const inside = out.some((o) => hit.at >= o.at && hit.at + hit.name.length <= o.at + o.name.length);
    if (!inside) out.push(hit);
  }
  return out;
}
export const detectEntities = (text, entities) => namedItems(text, entities).map((hit) => hit.entity);

// The question with the item names blanked out, for reading its intent.
const withoutNames = (text, hits) => {
  let t = norm(text);
  for (const hit of hits) t = t.split(hit.name).join(' ');
  return t;
};

/* ── Intents ──────────────────────────────────────────────────────────── */
// A request for a file or a link, as opposed to a question about one:
// "send me the paper" is resources, "what does the paper find" is not.
const FETCH = [
  /\b(?:resume|résumé|cv|curriculum vitae)\b/i,
  /\b(?:send|share|download|attach)\b/i,
  /\b(?:links?|urls?|pdf)\b/i,
  /\b(?:github|repo|repository|source code)\b/i,
  /\bwhere (?:can|do) i (?:find|get|see|read|download|try|open)\b/i,
  /\u7b80\u5386|\u5c65\u5386|\u53d1\u7ed9|\u53d1\u6211|\u53d1\u4e00\u4e0b|\u4e0b\u8f7d|\u94fe\u63a5|\u7f51\u5740|\u9644\u4ef6|\u6e90\u7801|\u4ed3\u5e93|\u5728\u54ea(?:\u91cc)?(?:\u770b|\u627e|\u4e0b\u8f7d|\u8bfb|\u8bd5)/,
];
export const wantsFetch = (text) => FETCH.some((re) => re.test(String(text || '')));

// A follow-up leans on the previous question: short, or opening with "and",
// "what about", or pointing back with "it" / "this project".
const FOLLOW_UP_CUES = [
  /^(?:and|also|so|then|but|what about|how about)\b/i,
  /^(?:why|how|what|which one|the (?:result|metric|impact|users?|role))\s*[?!.,]*$/i,
  /\b(?:it|its|that|this|they|them|there)\b/i,
  /^(?:\u90a3|\u8fd8\u6709|\u7136\u540e|\u6240\u4ee5|\u4f46\u662f)/,
  /\u5b83|\u8fd9\u4e2a\u9879\u76ee|\u90a3\u4e2a\u9879\u76ee|\u8be5\u9879\u76ee|\u5176\u4e2d|\u91cc\u9762|\u5177\u4f53|\u8be6\u7ec6|\u4e3a\u4ec0\u4e48|\u600e\u4e48|\u5462[?\uff1f]?$/,
];
export const isFollowUp = (text) => {
  const t = String(text || '').trim();
  return t.length <= 80 && FOLLOW_UP_CUES.some((re) => re.test(t));
};

// "and today?" after a token question stays with the usage skill.
const USAGE_WINDOW = /\b(?:today|yesterday|this (?:week|month)|last 30|total|overall)\b|\u4eca\u5929|\u4eca\u65e5|\u672c\u6708|\u8fd9\u4e2a\u6708|\u6700\u8fd1|\u603b\u5171|\u4e00\u5171/i;
const usageFollowUp = (current, previous) => !!previous && wantsUsage(previous)
  && String(current || '').trim().length <= 30 && USAGE_WINDOW.test(current);

/* ── Routing ──────────────────────────────────────────────────────────── */
// A QA pair is "about" an item when the page it links to is the item's page.
const pagePath = (href) => {
  const raw = String(href || '').trim();
  if (!raw.startsWith('/')) return '';
  let p = raw.split(/[?#]/, 1)[0].replace(/^\/zh(?=\/)/, '');
  if (!p.endsWith('/')) p += '/';
  return p;
};
const pairAbout = (focus) => (faq) => focus.some((e) => pagePath(faq.href) && pagePath(faq.href) === pagePath(e.url));

/* The skill's settings from its SKILL.md, and whether it may use a tool:
   only tools its `tools:` line lists, and only while they are on. An old
   index without skills or tools allows everything. */
export const skillConfig = (index, id) => (index && index.skills && index.skills[id]) || {};
export function usesTool(index, id, tool) {
  const listed = skillConfig(index, id).tools;
  if (Array.isArray(listed) && !listed.includes(tool)) return false;
  const t = index && index.tools && index.tools[tool];
  return !t || t.enabled !== false;
}
// The tool a skill can't work without: token-usage answers from the live
// numbers, share-files hands over the cards. The others still answer from
// whatever their tools find.
const REQUIRED_TOOL = { 'token-usage': 'get_token_usage', 'share-files': 'find_resources' };
// Switched on, with the tool it needs (general always is).
export function skillAvailable(index, id) {
  if (id === 'general') return true;
  if (skillConfig(index, id).enabled === false) return false;
  return !REQUIRED_TOOL[id] || usesTool(index, id, REQUIRED_TOOL[id]);
}

/* → { skill, reason, focus: [entity], faqs: [faq], score? }
   `turns`: the conversation, ending with the visitor's question. */
export function routeQuestion({ turns, index }) {
  const users = (turns || []).filter((t) => t.role === 'user').map((t) => t.content);
  const current = users[users.length - 1] || '';
  const previous = users.length > 1 ? users[users.length - 2] : '';
  const on = (id) => skillAvailable(index, id);
  const entities = (index && index.entities) || [];
  const hits = namedItems(current, entities);
  const named = hits.map((h) => h.entity);
  const bare = withoutNames(current, hits);
  const route = (skill, reason, extra = {}) => ({ skill, reason, focus: [], faqs: [], ...extra });

  if (on('token-usage') && !named.length && (wantsUsage(bare) || usageFollowUp(current, previous))) {
    return route('token-usage', 'asks about my token usage');
  }
  const pairs = on('qa') ? scoreFaqs(index && index.faqs, current) : [];
  const exact = pairs.filter((p) => p.exact);
  if (exact.length) return route('qa', 'matches a QA pair exactly', { faqs: exact.map((p) => p.faq), focus: named, score: exact[0].score });
  if (on('share-files') && wantsFetch(bare)) return route('share-files', 'asks for a file or link', { focus: named.slice(0, 2) });
  if (on('project-walkthrough') && named.length) {
    return route('project-walkthrough', 'names a Work item', { focus: named.slice(0, 2), faqs: pairs.map((p) => p.faq).filter(pairAbout(named)) });
  }
  if (pairs.length) return route('qa', 'matches a QA pair', { faqs: pairs.map((p) => p.faq), score: pairs[0].score });
  if (on('project-walkthrough') && previous && isFollowUp(current)) {
    const carried = detectEntities(previous, entities);
    if (carried.length) return route('project-walkthrough', 'follows up on a Work item', { focus: carried.slice(0, 2), carried: true });
  }
  return route('general', 'no skill owns it');
}

/* ── What each skill reads ────────────────────────────────────────────── */
const ownChunk = (prefix) => (c) => c.id === prefix || c.id.startsWith(`${prefix}-`) || c.id.startsWith(`${prefix}#`);

/* → { must: [chunk id], fill: chars of other passages, retrieve: bool,
       site: bool }
   must: the skill's own passages, in reading order (for two items, each
   item's summary first, then their stories). fill: how much of the rest of
   the site may follow, ranked by the question. site: false when the skill
   doesn't use search_work; it then reads only the background notes. */
export function planFor(route, index) {
  const chunks = (index && index.chunks) || [];
  if (route.skill === 'token-usage') return { must: [], fill: 0, retrieve: false, site: false };
  if (!usesTool(index, route.skill, 'search_work')) return { must: [], fill: 0, retrieve: false, site: false };
  if (route.skill === 'project-walkthrough') {
    const lists = route.focus.map((e) => chunks.filter(ownChunk(e.chunkPrefix)).map((c) => c.id));
    const must = [...lists.map((l) => l[0]).filter(Boolean), ...lists.flatMap((l) => l.slice(1))];
    // A named item already supplies an exact scope. Semantic fill from the
    // rest of the corpus is more likely to leak another project's facts
    // than to help answer the question.
    return { must, fill: 0, retrieve: false, site: true };
  }
  if (route.skill === 'qa') {
    const targets = new Set(route.faqs.map((f) => pagePath(f.href)).filter(Boolean));
    // The owner-written QA answer is authoritative. When it names an
    // internal page, read that page exactly; never pad it with semantically
    // similar passages from unrelated projects or writing.
    return { must: chunks.filter((c) => targets.has(pagePath(c.url))).map((c) => c.id), fill: 0, retrieve: false, site: true };
  }
  if (route.skill === 'share-files') {
    return { must: route.focus.map((e) => (chunks.find(ownChunk(e.chunkPrefix)) || {}).id).filter(Boolean), fill: 0, retrieve: false, site: true };
  }
  return { must: [], fill: Infinity, retrieve: true, site: true };
}

// The skill's instructions, the body of its SKILL.md (the Worker falls back
// to a one-line instruction when it is empty).
export const skillPrompt = (index, id) => String(skillConfig(index, id).prompt || '');
