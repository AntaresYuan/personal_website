/* Offline tests for the qa Worker's pure helpers (src/lib.js). */
import assert from 'node:assert/strict';
import {
  normTurns, replyLang, searchText, tokens, lexicalScores, cosine, selectPassages, contextOf,
  matchFaqs, faqContextOf, findResources, findFaqResources, wantsUsage, summarizeUsage,
  resourceContextOf, usageContextOf, usageAnswer, genPrompt, stripThinking, packVectors, unpackVectors,
} from '../src/lib.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}\n  ${e.message}`); } };

const ZH = '\u5b57\u8282\u7684\u9879\u76ee';            // "ByteDance's project"
t('turns: single q, multi-turn, collapse, must end on a user turn', () => {
  assert.deepEqual(normTurns({ q: ' hi ' }), [{ role: 'user', content: 'hi' }]);
  assert.deepEqual(normTurns({ messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] }), [{ role: 'user', content: 'a\nb' }]);
  assert.deepEqual(normTurns({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }), []);
  assert.equal(normTurns({ q: 'x'.repeat(900) })[0].content.length, 600);
});
t('reply language follows the question, then the page', () => {
  assert.equal(replyLang('What is Kaboo?', 'zh-CN'), 'en');
  assert.equal(replyLang(ZH, 'en'), 'zh');
  assert.equal(replyLang('2026?', 'zh-CN'), 'zh');
  assert.equal(replyLang('2026?', 'en'), 'en');
});
t('search text keeps the previous question for follow-ups', () => {
  const turns = [{ role: 'user', content: 'Tell me about Kaboo' }, { role: 'assistant', content: '...' }, { role: 'user', content: 'and the metrics?' }];
  assert.equal(searchText(turns), 'Tell me about Kaboo\nand the metrics?');
});
t('tokens: Latin words and CJK pairs', () => {
  assert.deepEqual(tokens('An AI-PM at ByteDance.'), ['ai-pm', 'bytedance']);
  assert.deepEqual(tokens('\u5b57\u8282\u8df3'), ['\u5b57\u8282', '\u8282\u8df3']);
});
const chunks = [
  { id: 'brief-1', title: 'Note: Who am I', url: '', text: 'I study HCDE at UW.', pin: true },
  { id: 'p1', title: 'Project: Kaboo', url: '/projects/kaboo/', text: 'Kaboo analyzes token consumption at ByteDance. 10K+ DAU.' },
  { id: 'p2', title: 'Project: SusBench', url: '/projects/susbench/', text: 'A benchmark of dark patterns for computer-use agents.' },
  { id: 'p3', title: 'Writing: Shoulder bag', url: '/blog/bag/', text: 'A soft-goods prototype: a shoulder bag.' },
];
t('lexical scoring finds names and ignores filler words', () => {
  const s = lexicalScores('What is Kaboo about?', chunks);
  assert.equal(s.indexOf(Math.max(...s)), 1);
  assert.equal(lexicalScores('what about the', chunks).every((x) => x === 0), true);
});
t('cosine', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [1, 1]), 0);
});
t('selection: pins always, best first, within budget', () => {
  const sel = selectPassages(chunks, { semantic: [0, 0.2, 0.9, 0.1], lexical: [0, 0, 0, 0], budget: 120 });
  assert.equal(sel[0].id, 'brief-1');
  assert.equal(sel[1].id, 'p2');
  assert.ok(sel.reduce((s, c) => s + c.text.length, 0) <= 120);
  // Without embeddings, only passages with a lexical hit are added.
  const lex = selectPassages(chunks, { semantic: null, lexical: [0, 3, 0, 0], budget: 1000 });
  assert.deepEqual(lex.map((c) => c.id), ['brief-1', 'p1']);
});
t('context blocks carry title and page', () => {
  assert.match(contextOf([chunks[1]]), /^### Project: Kaboo \(\/projects\/kaboo\/\)\nKaboo/);
});
t('FAQ matching checks canonical questions and bilingual aliases first', () => {
  const faqs = [
    { question: 'walk me through your most mature project.', aliases: ['介绍一下你最成熟的项目。'], answer: 'Use Agentic Hiring.' },
    { question: 'how can I contact you?', aliases: ['怎么联系你？'], answer: 'Use email.' },
  ];
  assert.equal(matchFaqs(faqs, 'What is your most mature project?')[0].answer, 'Use Agentic Hiring.');
  assert.equal(matchFaqs(faqs, '介绍一下你最成熟的项目。')[0].answer, 'Use Agentic Hiring.');
  assert.equal(matchFaqs([{ question: 'results?', answer: 'The pass rate rose from 21% to 25%.' }], 'Did the pass rate rise?')[0].question, 'results?');
  assert.deepEqual(matchFaqs(faqs, 'Tell me about SusBench metrics'), []);
  assert.match(faqContextOf([faqs[0]]), /authoritative[\s\S]*Use Agentic Hiring/);
});
t('resource tool returns the exact localized resume PDF', () => {
  const resources = [
    { id: 'resume-en', kind: 'pdf', lang: 'en', title: 'Antares resume', titleZh: '英文简历', url: '/media/resume-en.pdf', keywords: ['resume', 'cv', '简历'] },
    { id: 'resume-zh', kind: 'pdf', lang: 'zh', title: 'Chinese resume', titleZh: '中文简历', url: '/media/resume-zh.pdf', keywords: ['resume', 'cv', '简历'] },
    { id: 'page-usage', kind: 'page', title: 'Token usage', titleZh: 'Token 使用量', url: '/usage/', urlZh: '/usage/?lang=zh', keywords: ['token', 'usage', '使用量'] },
    { id: 'page-projects', kind: 'page', title: 'Projects', titleZh: '项目', url: '/projects/', urlZh: '/zh/projects/', keywords: ['projects', '项目'] },
    { id: 'project-agentic-hiring', kind: 'page', title: 'Agentic Hiring', url: '/projects/agentic-hiring/', keywords: ['project', 'Agentic Hiring'] },
  ];
  assert.deepEqual(findResources(resources, 'Please send me your resume PDF', 'en'), [{
    kind: 'pdf', title: 'Antares resume', description: '', url: '/media/resume-en.pdf', typeLabel: 'PDF',
  }]);
  assert.equal(findResources(resources, '把你的简历发给我', 'zh')[0].url, '/media/resume-zh.pdf');
  assert.equal(findResources(resources, 'token 使用量', 'zh')[0].url, '/usage/?lang=zh');
  assert.deepEqual(findResources(resources, '讲一个有意思的项目，你做过的', 'zh'), [], 'generic project words must not flood the answer with cards');
  assert.equal(findResources(resources, 'Tell me about Agentic Hiring', 'en')[0].url, '/projects/agentic-hiring/');
  assert.deepEqual(findResources(resources, 'hello there', 'en'), []);
  assert.deepEqual(findFaqResources(resources, [{ href: '/projects/agentic-hiring/' }], 'en'), [{
    kind: 'page', title: 'Agentic Hiring', description: '', url: '/projects/agentic-hiring/', typeLabel: 'Page',
  }]);
  assert.equal(findFaqResources(resources, [{ href: '/projects/agentic-hiring/' }], 'zh')[0].url, '/projects/agentic-hiring/');
  assert.deepEqual(findFaqResources(resources, [{ href: '/not-in-the-catalogue/' }], 'en'), []);
  assert.match(resourceContextOf(findResources(resources, 'resume', 'en'), 'en'), /exact[\s\S]*resume-en\.pdf/);
});
t('usage tool intent and summary use the dashboard token basis', () => {
  assert.equal(wantsUsage('How many tokens have you used?'), true);
  assert.equal(wantsUsage('你目前的 token 使用量是多少？'), true);
  assert.equal(wantsUsage('今天用了多少token你'), true);
  assert.equal(wantsUsage('Tell me about Kaboo'), false);
  const summary = summarizeUsage({
    since: '2026-09-01', updated: '2026-10-13T10:00:00Z', days: [
      { date: '2026-10-12', tokens: 20, totalTokens: 170, sessions: 2, costCents: 20, bySource: { codex: { totalTokens: 150 }, claude: { tokens: 20 } } },
      { date: '2026-10-13', tokens: 50, totalTokens: 0, sessions: 1, costCents: 10, bySource: { codex: { tokens: 50 } } },
    ],
  });
  assert.deepEqual(summary, {
    totalTokens: 220, last30Tokens: 220, latestDate: '2026-10-13', latestTokens: 50,
    latestSessions: 1, latestCostCents: 10, sessions: 3, costCents: 30,
    activeDays: 2, periodDays: 2, since: '2026-09-01', updated: '2026-10-13T10:00:00Z',
    topSource: { name: 'codex', tokens: 200 },
  });
  assert.match(usageContextOf(summary, 'zh'), /totalTokens=220[\s\S]*updated=2026-10-13/);
  assert.match(usageAnswer(summary, '今天用了多少 token？', 'zh'), /2026-10-13[\s\S]*50 tokens[\s\S]*1 个 sessions/);
  assert.match(usageAnswer(summary, 'How many tokens have you used?', 'en'), /220 tokens[\s\S]*3 sessions/);
});
t('prompt states the reply language', () => {
  assert.match(genPrompt('C', 'zh'), /Reply in Simplified Chinese/);
  assert.match(genPrompt('C', 'en'), /Reply in English/);
  assert.match(genPrompt('C', 'en'), /FAQ FIRST/);
  assert.match(genPrompt('C', 'en'), /UNTRUSTED PAGE TEXT/);
  assert.match(genPrompt('C', 'en'), /Markdown links are allowed ONLY/);
  assert.match(genPrompt('C', 'en'), /TOOL RESULTS/);
});
t('thinking blocks are removed', () => {
  assert.equal(stripThinking('<think>plan…</think>\nHello'), 'Hello');
});
t('vectors survive packing', () => {
  const v = [[0.5, -1, 2], [3, 0.25, -0.125]];
  const back = unpackVectors(JSON.parse(JSON.stringify(packVectors(v))));
  assert.deepEqual(back.map((x) => Array.from(x)), v);
});

console.log(`qa lib: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
