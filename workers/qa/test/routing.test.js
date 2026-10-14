/* The routing eval: every case in routing-cases.json against the real
   ask-index.json (run after a build). It checks the skill each question
   reaches, the Work items it focuses on, the QA pair it uses, and that the
   project-walkthrough reads its item's own passages first. Routing needs no
   model, so this runs offline on every change to skills, QA pairs or names. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { routeQuestion, planFor } from '../src/skills.js';

const root = new URL('../../../', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('ask-index.json', root), 'utf8'));
const { cases } = JSON.parse(fs.readFileSync(new URL('routing-cases.json', import.meta.url), 'utf8'));

let pass = 0;
const failures = [];
for (const c of cases) {
  const turns = [...(c.after || []).map((content, i) => ({ role: i % 2 ? 'assistant' : 'user', content })), { role: 'user', content: c.ask }];
  const route = routeQuestion({ turns, index });
  const plan = planFor(route, index);
  try {
    assert.equal(route.skill, c.skill, `skill ${route.skill} (${route.reason}), expected ${c.skill}`);
    if (c.focus) assert.deepEqual(route.focus.map((e) => e.id), c.focus, 'focus');
    if (c.qa) assert.ok(route.faqs.some((f) => f.question.startsWith(c.qa)), `QA pair: got ${route.faqs.map((f) => f.question).join(' + ') || 'none'}`);
    if (c.skill === 'project-walkthrough') {
      for (const e of route.focus) assert.ok(plan.must.some((id) => id === e.chunkPrefix || id.startsWith(`${e.chunkPrefix}-`) || id.startsWith(`${e.chunkPrefix}#`)), `${e.id}'s passages are read first`);
    }
    pass++;
  } catch (e) {
    failures.push(`  ${JSON.stringify(c.ask)}${c.after ? ` (after ${JSON.stringify(c.after[0])})` : ''}: ${e.message}`);
  }
}
const bySkill = cases.reduce((m, c) => ({ ...m, [c.skill]: (m[c.skill] || 0) + 1 }), {});
console.log(`routing eval: ${pass}/${cases.length} passed — ${Object.entries(bySkill).map(([k, v]) => `${k} ${v}`).join(', ')}`);
if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
