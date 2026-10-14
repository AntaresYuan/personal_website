#!/usr/bin/env node
/* Replay owner-reported bad cases against a real Worker and real models.

     node workers/qa/eval/user-reported-eval.mjs
     node workers/qa/eval/user-reported-eval.mjs http://127.0.0.1:8787
     node workers/qa/eval/user-reported-eval.mjs --case AQ-20261014-CD336A23

   Raw historical trajectories stay in Cloudflare. This runner sends only
   the sanitized messages in test/user-reported-cases.json and validates the
   public response contract. */
import fs from 'node:fs';

const args = process.argv.slice(2);
let endpoint = 'https://qa.antaresyuan.site/';
let onlyId = '';
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--case') onlyId = args[++index] || '';
  else if (!args[index].startsWith('--')) endpoint = args[index];
}
const fixture = JSON.parse(fs.readFileSync(new URL('../test/user-reported-cases.json', import.meta.url), 'utf8'));
const cases = onlyId ? fixture.cases.filter((item) => item.id === onlyId) : fixture.cases;

if (!cases.length) {
  console.error(`No user-reported case matches ${onlyId || '(empty dataset)'}.`);
  process.exit(2);
}

const rows = [];
for (const item of cases) {
  const started = Date.now();
  let response = null;
  let status = 0;
  let error = '';
  const misses = [];
  try {
    const result = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://antaresyuan.site' },
      body: JSON.stringify({ messages: item.messages, lang: item.lang }),
      signal: AbortSignal.timeout(60_000),
    });
    status = result.status;
    response = await result.json();
    if (!result.ok) misses.push(`HTTP ${result.status}: ${response.error || 'request failed'}`);
  } catch (cause) {
    error = String(cause && cause.message || cause);
    misses.push(error);
  }

  if (response) {
    const expected = item.expected;
    const tools = Array.isArray(response.tools) ? response.tools : [];
    const resources = Array.isArray(response.resources) ? response.resources : [];
    const urls = resources.map((resource) => resource && resource.url).filter(Boolean);
    const answer = String(response.answer || '');
    const allowedSkills = expected.skillsAllowed || [expected.skill];
    if (!allowedSkills.includes(response.skill)) misses.push(`skill ${response.skill || 'none'} not in ${allowedSkills.join(', ')}`);
    for (const tool of expected.toolsInclude || []) if (!tools.includes(tool)) misses.push(`missing tool ${tool}`);
    for (const url of expected.resourceUrlsInclude || []) if (!urls.includes(url)) misses.push(`missing resource ${url}`);
    for (const url of expected.resourceUrlsExclude || []) if (urls.includes(url)) misses.push(`unexpected resource ${url}`);
    if (expected.resourcesMax != null && resources.length > expected.resourcesMax) misses.push(`resources ${resources.length} > ${expected.resourcesMax}`);
    for (const text of expected.answerIncludesAll || []) if (!answer.includes(text)) misses.push(`answer missing ${JSON.stringify(text)}`);
    for (const text of expected.answerExcludesAll || []) if (answer.includes(text)) misses.push(`answer contains ${JSON.stringify(text)}`);
    for (const pattern of expected.answerMatchesAll || []) if (!(new RegExp(pattern, 'u')).test(answer)) misses.push(`answer does not match /${pattern}/u`);
  }

  const row = {
    ok: misses.length === 0,
    caseId: item.id,
    title: item.title,
    replayTraceId: response?.traceId || '',
    skill: response?.skill || '',
    via: response?.via || '',
    model: response?.model || '',
    status,
    durationMs: Date.now() - started,
    misses,
    error,
  };
  rows.push(row);
  console.log(`${row.ok ? 'ok  ' : 'MISS'} ${item.id} -> ${row.replayTraceId || 'no trace'} ${String(row.skill || row.error).padEnd(20)} ${String(row.durationMs).padStart(6)}ms  ${item.title}`);
  for (const miss of misses) console.log(`     ${miss}`);
}

const passed = rows.filter((row) => row.ok).length;
console.log(`\nuser-reported live eval: ${passed}/${rows.length} passed against ${endpoint}`);
if (passed !== rows.length) process.exitCode = 1;
