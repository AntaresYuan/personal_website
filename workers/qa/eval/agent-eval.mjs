#!/usr/bin/env node
/* The agent eval: the questions in test/routing-cases.json, asked of the
   real Worker and its real models, and the skill each answer used compared
   with the one expected. This measures how well the models choose skills,
   which the offline tests (scripted models) cannot.

     node workers/qa/eval/agent-eval.mjs                       # the live Worker
     node workers/qa/eval/agent-eval.mjs http://127.0.0.1:8787  # wrangler dev

   Every question is a real request: a few seconds each, on the Workers AI
   budget (and the Mac, when it is up). The route column says which model
   answered; each row's Query ID opens its full trace in D1. */
import fs from 'node:fs';

const endpoint = process.argv[2] || 'https://qa.antaresyuan.site/';
const { cases } = JSON.parse(fs.readFileSync(new URL('../test/routing-cases.json', import.meta.url), 'utf8'));

const rows = [];
for (const c of cases) {
  const messages = [...(c.after || []).map((content, i) => ({ role: i % 2 ? 'assistant' : 'user', content })), { role: 'user', content: c.ask }];
  const started = Date.now();
  let skill = '', via = '', traceId = '', error = '';
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://antaresyuan.site' },
      body: JSON.stringify({ messages, lang: /[\u3400-\u9fff]/.test(c.ask) ? 'zh' : 'en' }),
      signal: AbortSignal.timeout(60_000),
    });
    const d = await r.json();
    ({ skill = '', via = '', traceId = '' } = d);
    if (!r.ok) error = d.error || String(r.status);
  } catch (e) { error = String(e.message || e); }
  const ok = skill === c.skill;
  rows.push({ ok, ask: c.ask, expected: c.skill, skill, via, ms: Date.now() - started, traceId, error });
  console.log(`${ok ? 'ok  ' : 'MISS'} ${String(skill || error).padEnd(20)} (expected ${c.expected || c.skill}) ${via.padEnd(6)} ${String(Date.now() - started).padStart(6)}ms  ${traceId}  ${c.ask}`);
}
const hit = rows.filter((r) => r.ok).length;
const bySkill = {};
for (const r of rows) {
  const b = (bySkill[r.expected] ||= { hit: 0, n: 0 });
  b.n++; if (r.ok) b.hit++;
}
console.log(`\nskill chosen correctly: ${hit}/${rows.length} (${Math.round((hit / rows.length) * 100)}%)`);
for (const [skill, b] of Object.entries(bySkill)) console.log(`  ${skill.padEnd(20)} ${b.hit}/${b.n}`);
const routes = rows.reduce((m, r) => ({ ...m, [r.via || 'error']: (m[r.via || 'error'] || 0) + 1 }), {});
console.log(`answered by: ${Object.entries(routes).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`median latency: ${rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)]}ms`);
if (hit !== rows.length) process.exitCode = 1;
