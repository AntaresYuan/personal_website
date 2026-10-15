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

async function readResponse(result, started) {
  const contentType = result.headers.get('content-type') || '';
  if (!contentType.includes('application/x-ndjson') || !result.body) {
    return { response: await result.json(), firstTokenMs: null };
  }

  const reader = result.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let response = {};
  let firstTokenMs = null;
  const accept = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'delta') {
      if (firstTokenMs == null && event.text) firstTokenMs = Date.now() - started;
      return;
    }
    if (event.type === 'meta' || event.type === 'done') response = { ...response, ...event };
    if (event.type === 'error') response = { ...response, error: event.error || 'stream failed' };
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) accept(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) accept(buffer);
  return { response, firstTokenMs };
}

const rows = [];
for (const item of cases) {
  const started = Date.now();
  let response = null;
  let firstTokenMs = null;
  let status = 0;
  let error = '';
  const misses = [];
  try {
    const result = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://antaresyuan.site' },
      body: JSON.stringify({
        messages: item.messages,
        lang: item.lang,
        stream: item.performance?.maxFirstTokenMs != null,
        evaluation: { suite: 'owner-badcases', caseId: item.id },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    status = result.status;
    ({ response, firstTokenMs } = await readResponse(result, started));
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
    if (expected.toolsMax != null && tools.length > expected.toolsMax) misses.push(`tools ${tools.length} > ${expected.toolsMax}`);
    for (const text of expected.answerIncludesAll || []) if (!answer.includes(text)) misses.push(`answer missing ${JSON.stringify(text)}`);
    for (const text of expected.answerExcludesAll || []) if (answer.includes(text)) misses.push(`answer contains ${JSON.stringify(text)}`);
    for (const pattern of expected.answerMatchesAll || []) if (!(new RegExp(pattern, 'u')).test(answer)) misses.push(`answer does not match /${pattern}/u`);
  }

  const durationMs = Date.now() - started;
  if (item.performance?.maxDurationMs != null && durationMs > item.performance.maxDurationMs) {
    misses.push(`duration ${durationMs}ms > ${item.performance.maxDurationMs}ms`);
  }
  if (item.performance?.maxFirstTokenMs != null && response?.via !== 'tool') {
    if (firstTokenMs == null) misses.push('stream returned no first-token timing');
    else if (firstTokenMs > item.performance.maxFirstTokenMs) misses.push(`first token ${firstTokenMs}ms > ${item.performance.maxFirstTokenMs}ms`);
  }

  const open = item.status === 'open';
  const row = {
    ok: misses.length === 0,
    open,
    caseId: item.id,
    title: item.title,
    replayTraceId: response?.traceId || '',
    skill: response?.skill || '',
    via: response?.via || '',
    model: response?.model || '',
    status,
    durationMs,
    firstTokenMs,
    misses,
    error,
  };
  rows.push(row);
  const label = row.open ? (row.ok ? 'XPASS' : 'KNOWN') : (row.ok ? 'ok   ' : 'MISS ');
  const first = row.firstTokenMs == null ? '' : ` / first ${row.firstTokenMs}ms`;
  console.log(`${label} ${item.id} -> ${row.replayTraceId || 'no trace'} ${String(row.skill || row.error).padEnd(20)} ${String(row.durationMs).padStart(6)}ms${first}  ${item.title}`);
  for (const miss of misses) console.log(`     ${miss}`);
}

const fixed = rows.filter((row) => !row.open);
const open = rows.filter((row) => row.open);
const fixedPassed = fixed.filter((row) => row.ok).length;
const openPassed = open.filter((row) => row.ok).length;
console.log(`\nuser-reported live eval against ${endpoint}`);
console.log(`  fixed: ${fixedPassed}/${fixed.length} passed`);
console.log(`  open:  ${openPassed}/${open.length} now pass; ${open.length - openPassed} remain known failures`);
if (fixedPassed !== fixed.length) process.exitCode = 1;
