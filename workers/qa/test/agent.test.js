/* The agent loop (src/agent.js) with a scripted model: what it is shown,
   what it may call, and when it gives up so the fixed pipeline answers. */
import assert from 'node:assert/strict';
import { parsePlan, runAgent, plannerPrompt, MAX_STEPS } from '../src/agent.js';

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}\n  ${e.stack}`); } };

const catalog = [
  { name: 'project-walkthrough', title: 'Project', description: 'A named project, skill, post or gallery piece.', tools: ['search_work', 'find_resources'], prompt: '## Steps\n1. Call search_work with item.' },
  { name: 'share-files', title: 'Files', description: 'A file or link.', tools: ['find_resources'], prompt: '## Steps\n1. Call find_resources.' },
  { name: 'a2ui', title: 'Interactive', description: 'Missing input or a decision.', tools: ['render_ui'], prompt: '## Steps\n1. Call render_ui once.' },
  { name: 'general', title: 'General', description: 'Anything else.', tools: ['search_work', 'find_resources'], prompt: '## Steps\n1. Call search_work.' },
];
const turns = [{ role: 'user', content: 'How does Kaboo measure token usage?' }];

// A model that replies from a script, one entry per call, and remembers
// what it was shown.
const scripted = (replies) => {
  const seen = [];
  const callModel = async (messages) => {
    seen.push(messages);
    const text = replies[seen.length - 1];
    if (text === undefined) throw new Error('script ran out');
    return { text, engine: 'cloud', model: 'fake' };
  };
  return { callModel, seen };
};
const toolLog = [];
const runTool = async (tool, args, skill) => {
  toolLog.push({ tool, args, skill: skill.name });
  return { note: `${tool} ok`, passages: [], cards: [] };
};

await t('parsePlan reads JSON however a small model wraps it', () => {
  assert.deepEqual(parsePlan('{"answer": true}'), { answer: true });
  assert.deepEqual(parsePlan('Sure!\n```json\n{"actions":[{"tool":"load_skill","args":{"name":"qa"}}]}\n```'),
    { actions: [{ tool: 'load_skill', args: { name: 'qa' } }] });
  assert.deepEqual(parsePlan('{"tool": "search_work", "args": {"query": "a {curly} thing"}}'),
    { actions: [{ tool: 'search_work', args: { query: 'a {curly} thing' } }] });
  assert.deepEqual(parsePlan('<think>hmm {"x":1}</think>{"action": "answer"}'), { answer: true });
  assert.equal(parsePlan('I would load the project skill.'), null);
  assert.equal(parsePlan('{"actions": []}'), null);
  assert.equal(parsePlan('{"actions": [{"tool": "load_skill"'), null);
});

await t('the planner sees the skills by description, and only load_skill until one is loaded', () => {
  const p = plannerPrompt({ systemPrompt: 'SYS', catalog, loaded: null, allowed: ['load_skill'] });
  assert.match(p, /- project-walkthrough: A named project/);
  assert.match(p, /first step must be load_skill/);
  assert.doesNotMatch(p, /- search_work/);
});

await t('happy path: load a skill, call its tools, answer', async () => {
  toolLog.length = 0;
  const m = scripted([
    '{"actions":[{"tool":"load_skill","args":{"name":"project-walkthrough"}}]}',
    '{"actions":[{"tool":"search_work","args":{"query":"Kaboo metrics","item":"Kaboo"}},{"tool":"find_resources","args":{"query":"Kaboo"}}]}',
    '{"answer": true}',
  ]);
  const r = await runAgent({ turns, catalog, systemPrompt: 'SYS', callModel: m.callModel, runTool });
  assert.equal(r.ok, true);
  assert.equal(r.skill.name, 'project-walkthrough');
  assert.deepEqual(toolLog.map((x) => x.tool), ['search_work', 'find_resources']);
  assert.deepEqual(r.results.map((x) => x.tool), ['search_work', 'find_resources']);
  assert.ok(r.steps.every((step) => Number.isInteger(step.durationMs) && step.durationMs >= 0));
  assert.ok(r.results.every((result) => Number.isInteger(result.durationMs) && result.durationMs >= 0));
  // The second call shows the skill's instructions and its tools.
  const [sys2, user2] = m.seen[1];
  assert.match(sys2.content, /LOADED SKILL: project-walkthrough/);
  assert.match(sys2.content, /- search_work/);
  assert.match(user2.content, /INSTRUCTIONS OF THE LOADED SKILL \(project-walkthrough\):\n## Steps/);
  assert.match(user2.content, /load_skill project-walkthrough → loaded/);
});

await t('a tool the loaded skill does not list is refused, not run', async () => {
  toolLog.length = 0;
  const m = scripted([
    '{"actions":[{"tool":"load_skill","args":{"name":"share-files"}}]}',
    '{"actions":[{"tool":"search_work","args":{"query":"résumé"}},{"tool":"find_resources","args":{"query":"résumé"}}]}',
    '{"answer": true}',
  ]);
  const r = await runAgent({ turns, catalog, callModel: m.callModel, runTool });
  assert.deepEqual(toolLog.map((x) => x.tool), ['find_resources']);
  assert.match(m.seen[2][1].content, /search_work → not allowed by the share-files skill/);
  assert.equal(r.ok, true);
});

await t('tools before a skill is loaded are refused', async () => {
  toolLog.length = 0;
  const m = scripted([
    '{"actions":[{"tool":"search_work","args":{"query":"x"}}]}',
    '{"actions":[{"tool":"load_skill","args":{"name":"general"}}]}',
    '{"answer": true}',
  ]);
  const r = await runAgent({ turns, catalog, callModel: m.callModel, runTool });
  assert.equal(toolLog.length, 0);
  assert.match(m.seen[1][1].content, /not allowed yet: load a skill first/);
  assert.equal(r.skill.name, 'general');
});

await t('the observed share_files alias loads share-files and runs the real tool in one step', async () => {
  toolLog.length = 0;
  const m = scripted([
    '{"actions":[{"tool":"share_files","args":{"query":"résumé"}}]}',
    '{"answer": true}',
  ]);
  const r = await runAgent({ turns, catalog, callModel: m.callModel, runTool });
  assert.equal(r.ok, true);
  assert.equal(r.skill.name, 'share-files');
  assert.deepEqual(toolLog.map((x) => x.tool), ['find_resources']);
  assert.equal(m.seen.length, 2);
  assert.match(r.steps[0].note, /loaded share-files and normalized to find_resources/);
});

await t('an unknown skill is named back with the real choices', async () => {
  const m = scripted([
    '{"actions":[{"tool":"load_skill","args":{"name":"projects"}}]}',
    '{"actions":[{"tool":"load_skill","args":{"name":"project-walkthrough"}}]}',
    '{"answer": true}',
  ]);
  const r = await runAgent({ turns, catalog, callModel: m.callModel, runTool });
  assert.match(m.seen[1][1].content, /no such skill\. Choose one of: project-walkthrough, share-files, a2ui, general/);
  assert.equal(r.skill.name, 'project-walkthrough');
});

await t('one unreadable reply gets a correction; it does not use up a step', async () => {
  const m = scripted([
    'I think the project skill fits.',
    '{"actions":[{"tool":"load_skill","args":{"name":"general"}}]}',
    '{"actions":[{"tool":"search_work","args":{"query":"x"}}]}',
    '{"answer": true}',
  ]);
  const r = await runAgent({ turns, catalog, callModel: m.callModel, runTool });
  assert.equal(r.ok, true);
  assert.match(m.seen[1][1].content, /not one JSON object/);
  assert.equal(m.seen.length, 4);
});

await t('two unreadable replies → no plan, so the fixed pipeline answers', async () => {
  const m = scripted(['load the project skill', 'still prose']);
  const r = await runAgent({ turns, catalog, callModel: m.callModel, runTool });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no usable plan');
});

await t('answering before loading a skill is sent back once', async () => {
  const m = scripted(['{"answer": true}', '{"actions":[{"tool":"load_skill","args":{"name":"general"}}]}', '{"answer": true}']);
  const r = await runAgent({ turns, catalog, callModel: m.callModel, runTool });
  assert.match(m.seen[1][1].content, /must load a skill before answering/);
  assert.equal(r.ok, true);
});

await t('a terminal A2UI tool ends the loop without an extra model call', async () => {
  const m = scripted([
    '{"actions":[{"tool":"load_skill","args":{"name":"a2ui"}}]}',
    '{"actions":[{"tool":"render_ui","args":{"type":"choice","title":"Choose","options":["One","Two"]}}]}',
  ]);
  const calls = [];
  const r = await runAgent({
    turns, catalog, callModel: m.callModel,
    runTool: async (tool, args) => {
      calls.push({ tool, args });
      return { note: 'card ready', terminal: true, ui: { id: 'AQ-1-UI1', type: 'choice' } };
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.skill.name, 'a2ui');
  assert.equal(r.terminal.ui.id, 'AQ-1-UI1');
  assert.equal(m.seen.length, 2);
  assert.deepEqual(calls.map((call) => call.tool), ['render_ui']);
});

await t('out of steps: answer with what there is, or give up if no skill', async () => {
  const busy = Array(MAX_STEPS).fill('{"actions":[{"tool":"load_skill","args":{"name":"general"}}]}');
  const r = await runAgent({ turns, catalog, callModel: scripted(busy).callModel, runTool });
  assert.deepEqual([r.ok, r.reason, r.skill.name], [true, 'step limit', 'general']);
  const never = Array(MAX_STEPS).fill('{"answer": true}');
  const r2 = await runAgent({ turns, catalog, callModel: scripted(never).callModel, runTool });
  assert.equal(r2.ok, false);
});

console.log(`qa agent: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
