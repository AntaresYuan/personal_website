/* ════════════════════════════════════════════════════════════════════════
   The agent: the model picks a skill and calls the tools itself.

   It works the way Claude Code uses skills, with the models the Worker
   already has (the Mac's qwen through the proxy, Workers AI's llama 3.1
   8B), neither of which takes a `tools` parameter here. So the model plans
   in text: every step it writes ONE JSON object, the Worker runs what it
   asked for and shows it the results, until it says it can answer.

     step 1  it sees the system prompt, the skills (name + description only)
             and the conversation      → {"actions":[{"tool":"load_skill",…}]}
     step 2  it sees the skill's instructions; only that skill's tools are
             allowed now               → {"actions":[{"tool":"search_work",…}]}
     step 3  it sees the results       → {"answer":true}

   Then the answer is written, in a separate call that can stream, from the
   skill's instructions and everything the tools returned (index.js).

   Pure: the model call and the tools are passed in (runAgent), so the loop
   is tested offline with a scripted model (test/agent.test.js).
   ════════════════════════════════════════════════════════════════════════ */

export const MAX_STEPS = 3;            // planning calls before answering anyway
export const MAX_ACTIONS = 3;          // tool calls per step
export const TOOL_NAMES = ['search_work', 'find_resources', 'get_token_usage', 'render_ui'];

const TOOL_HELP = {
  load_skill: '{"name": "<skill>"} — read a skill\'s instructions. Always the first step.',
  search_work: '{"query": "<what to look for>", "item": "<optional: the project, AI skill, post or gallery piece it is about>"} — find passages on the Work site.',
  find_resources: '{"query": "<the file or link>"} — find exact files and links (résumé, project page, GitHub, paper, demo). They are shown to the visitor as cards.',
  get_token_usage: '{"window": "today" | "month" | "last30" | "total"} — my live token usage numbers.',
  render_ui: '{"type":"choice|form|confirm|resource","title":"…",…} — return one validated interactive card when a decision or input is genuinely required. Never write HTML.',
};

/* The planner's system prompt: who it works for, the skills to choose
   from, the tools it may call now, and the reply format. */
export function plannerPrompt({ systemPrompt, catalog, loaded, allowed }) {
  const skills = catalog.map((s) => `- ${s.name}: ${s.description || s.title || ''}`.trim()).join('\n');
  const tools = allowed.map((t) => `- ${t} ${TOOL_HELP[t] || ''}`).join('\n');
  return `You plan how to answer a visitor's question on Antares Yuan's Work site. You don't write the answer: you choose a skill and call tools, then say when you have enough. The answer is written afterwards from the skill's instructions and the tool results.

${systemPrompt ? `About the assistant you plan for:\n${systemPrompt.slice(0, 1500)}\n\n` : ''}SKILLS — load the one whose description fits the visitor's latest question:
${skills}

${loaded ? `LOADED SKILL: ${loaded.name}. Follow its steps below.` : 'No skill is loaded yet: your first step must be load_skill.'}

TOOLS you may call now:
${tools}

Reply with ONE JSON object and nothing else:
- to call tools: {"actions": [{"tool": "<tool>", "args": {…}}]}  (at most ${MAX_ACTIONS})
- when you have what the answer needs: {"answer": true}

Examples:
{"actions": [{"tool": "load_skill", "args": {"name": "project-walkthrough"}}]}
{"actions": [{"tool": "search_work", "args": {"query": "Kaboo results and metrics", "item": "Kaboo"}}, {"tool": "find_resources", "args": {"query": "Kaboo"}}]}
{"actions": [{"tool": "render_ui", "args": {"type": "choice", "title": "Which version?", "message": "Choose one so I can continue.", "options": [{"id":"en","label":"English"},{"id":"zh","label":"Chinese"}]}}]}
{"answer": true}`;
}

/* The planner's input: the conversation, then what has been done. Tool
   results appear as short summaries; the answer step gets them in full. */
export function plannerInput({ turns, steps, loaded }) {
  const convo = turns.map((t) => `${t.role === 'user' ? 'Visitor' : 'Antares'}: ${t.content}`).join('\n');
  const done = steps.map((s, i) => `${i + 1}. ${s.note}`).join('\n');
  return `CONVERSATION (answer the visitor's last message):
${convo}

${done ? `DONE SO FAR:\n${done}\n\n` : ''}${loaded ? `INSTRUCTIONS OF THE LOADED SKILL (${loaded.name}):\n${loaded.prompt}\n\n` : ''}Your next step, as one JSON object:`;
}

/* The model's reply → { answer: true } | { actions: [{ tool, args }] } |
   null. Lenient about what small models wrap around the JSON (prose, code
   fences, a bare action without the "actions" list), strict about what
   the actions are. */
export function parsePlan(text) {
  const s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { end = i; break; }
  }
  if (end < 0) return null;
  let obj;
  try { obj = JSON.parse(s.slice(start, end + 1)); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  if (obj.answer === true || obj.answer === 'true' || obj.action === 'answer' || obj.tool === 'answer') return { answer: true };
  const raw = Array.isArray(obj.actions) ? obj.actions : (obj.tool || obj.action) ? [obj] : null;
  if (!raw) return null;
  const actions = raw
    .map((a) => ({ tool: String((a && (a.tool || a.action || a.name)) || '').trim(), args: (a && typeof a.args === 'object' && a.args) || (a && typeof a.arguments === 'object' && a.arguments) || {} }))
    .filter((a) => a.tool);
  return actions.length ? { actions: actions.slice(0, MAX_ACTIONS) } : null;
}

/* The loop.
   catalog:   [{ name, title, description, tools, prompt }] — the skills on offer
   callModel: async (messages) → { text, engine, model }   (throws when no model)
   runTool:   async (tool, args, skill) → { note, ...anything for the answer }
   → { ok, skill, steps, results, reason? }
   ok is false when the model never produced a usable plan: the Worker then
   answers with the fixed pipeline instead. */
export async function runAgent({ turns, catalog, systemPrompt, callModel, runTool, maxSteps = MAX_STEPS }) {
  const byName = new Map(catalog.map((s) => [s.name, s]));
  const steps = [];
  const results = [];
  let loaded = null;
  let retried = false;

  for (let step = 0; step < maxSteps; step++) {
    const allowed = loaded ? ['load_skill', ...loaded.tools.filter((t) => TOOL_NAMES.includes(t))] : ['load_skill'];
    const reply = await callModel([
      { role: 'system', content: plannerPrompt({ systemPrompt, catalog, loaded, allowed }) },
      { role: 'user', content: plannerInput({ turns, steps, loaded }) },
    ]);
    const plan = parsePlan(reply.text);
    const record = {
      engine: reply.engine,
      model: reply.model,
      output: String(reply.text || '').slice(0, 600),
      durationMs: Number(reply.durationMs) || 0,
      ...(reply.localAttemptMs != null ? { localAttemptMs: Number(reply.localAttemptMs) || 0 } : {}),
      ...(reply.cloudMs != null ? { cloudMs: Number(reply.cloudMs) || 0 } : {}),
    };

    if (!plan) {
      if (retried) return { ok: false, reason: 'no usable plan', skill: loaded, steps: [...steps, { ...record, note: 'unreadable reply' }], results };
      retried = true;
      steps.push({ ...record, note: 'Your reply was not one JSON object. Reply with exactly one JSON object, as in the examples.' });
      step--;                           // the correction doesn't use up a step
      continue;
    }
    if (plan.answer) {
      if (loaded) { steps.push({ ...record, note: 'ready to answer' }); return { ok: true, skill: loaded, steps, results }; }
      steps.push({ ...record, note: 'You must load a skill before answering. Call load_skill with the skill that fits.' });
      continue;
    }

    const notes = [];
    let terminal = null;
    for (const action of plan.actions) {
      if (action.tool === 'load_skill') {
        const name = String(action.args.name || action.args.skill || '').trim();
        const skill = byName.get(name);
        if (!skill) { notes.push(`load_skill "${name}" → no such skill. Choose one of: ${[...byName.keys()].join(', ')}.`); continue; }
        if (loaded && loaded.name === skill.name) { notes.push(`load_skill ${name} → already loaded.`); continue; }
        loaded = skill;
        notes.push(`load_skill ${name} → loaded. Tools now allowed: ${skill.tools.filter((t) => TOOL_NAMES.includes(t)).join(', ') || 'none'}.`);
        continue;
      }
      if (!loaded) { notes.push(`${action.tool} → not allowed yet: load a skill first.`); continue; }
      if (!loaded.tools.includes(action.tool) || !TOOL_NAMES.includes(action.tool)) {
        notes.push(`${action.tool} → not allowed by the ${loaded.name} skill. Allowed: ${loaded.tools.join(', ') || 'none'}.`);
        continue;
      }
      const toolStarted = Date.now();
      const result = await runTool(action.tool, action.args, loaded);
      results.push({ tool: action.tool, args: action.args, durationMs: Date.now() - toolStarted, ...result });
      notes.push(`${action.tool} ${JSON.stringify(action.args)} → ${result.note}`);
      if (result.terminal === true) terminal = result;
    }
    steps.push({ ...record, actions: plan.actions, note: notes.join('\n   ') });
    if (terminal) return { ok: true, skill: loaded, steps, results, terminal };
  }
  // Out of steps: answer with what there is, if a skill was loaded.
  return loaded ? { ok: true, skill: loaded, steps, results, reason: 'step limit' } : { ok: false, reason: 'no skill loaded', skill: null, steps, results };
}
