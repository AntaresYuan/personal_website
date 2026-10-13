'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const llms = read('llms.txt');
const full = read('llms-full.txt');
const home = read('index.html');
const personal = read('personal/index.html');
const terminal = read('scripts/terminal.js');
const palette = read('scripts/palette.js');
const brief = read('agent-brief.txt');
const sources = JSON.parse(read('content/assistant/sources.json'));
const index = JSON.parse(read('ask-index.json'));

assert.match(llms, /^# .+ — Work/m);
assert.match(llms, /## Work sections/);
assert.match(full, /^# .+ — Work/m);
for (const forbidden of [
  '# Shipped', '# Now', '# Next', '# Later', '# Lens — how I think',
  '[Roadmap board]', '[Agent terminal]', '/personal/',
]) {
  assert.equal(full.includes(forbidden), false, `llms-full.txt leaked Personal marker: ${forbidden}`);
  assert.equal(llms.includes(forbidden), false, `llms.txt leaked Personal marker: ${forbidden}`);
}

assert.equal(index.chunks.some((chunk) => String(chunk.id).startsWith('board-')), false);
assert.equal(index.chunks.some((chunk) => chunk.id === 'lens'), false);
assert.equal(index.chunks.some((chunk) => chunk.url === '/personal/'), false);
assert.ok(index.chunks.some((chunk) => String(chunk.id).startsWith('project-')));
assert.ok(index.chunks.some((chunk) => String(chunk.id).startsWith('skill-')));
assert.ok(index.chunks.some((chunk) => String(chunk.id).startsWith('gallery-')));
assert.ok(index.chunks.some((chunk) => String(chunk.id).startsWith('post-')));
assert.ok(Array.isArray(index.resources) && index.resources.length >= 25, 'Work resource catalogue is unexpectedly small');
assert.equal(index.resources.some((resource) => String(resource.url || '').startsWith('/personal/')), false);
assert.ok(index.resources.some((resource) => resource.id === 'resume-en' && resource.kind === 'pdf'));
assert.ok(index.resources.some((resource) => resource.id === 'resume-zh' && resource.kind === 'pdf'));
assert.ok(index.resources.some((resource) => resource.id === 'page-usage'));
assert.ok(index.resources.some((resource) => resource.id === 'file-llms-summary'));
assert.ok(index.resources.some((resource) => resource.id === 'file-source' && /github\.com/.test(resource.url)));
assert.ok(index.resources.some((resource) => String(resource.id).startsWith('project-') && resource.kind === 'link'));
assert.ok(index.resources.some((resource) => String(resource.id).startsWith('skill-') && resource.kind === 'link'));
assert.ok(index.resources.some((resource) => String(resource.id).startsWith('gallery-') && resource.kind === 'image'));
for (const personalFaq of ["what does “a star to ship by” mean?", "what's Worth Fly?", "what's Gmail++ / Gmail Plus Plus?"]) {
  assert.equal(index.faqs.some((faq) => faq.question === personalFaq), false, `Personal FAQ leaked into ask-index: ${personalFaq}`);
  assert.equal(brief.includes(personalFaq), false, `Personal FAQ leaked into agent-brief: ${personalFaq}`);
}
assert.equal(brief.includes('embedded CLI'), false);

assert.ok(home.includes('scripts/ask-render.js'), 'Work home must load the rich answer renderer');
assert.ok(home.lastIndexOf('scripts/ask-history.js') < home.lastIndexOf('scripts/ask-render.js'));
assert.ok(home.lastIndexOf('scripts/ask-render.js') < home.lastIndexOf('scripts/work.js'));

assert.equal('projectLog' in sources, false);
assert.equal('lens' in sources, false);
assert.equal('contact' in sources, false);

for (const marker of ['id="hero-ask"', 'id="ask-panel"', 'scripts/qa-faq', 'scripts/ask-selection', 'scripts/ask-history']) {
  assert.equal(personal.includes(marker), false, `Personal still includes AI chat marker: ${marker}`);
}
for (const file of fs.readdirSync('work').map((slug) => `work/${slug}/index.html`)) {
  const detail = read(file);
  for (const marker of ['id="ask-panel"', 'scripts/work-detail', 'scripts/ask-selection', 'scripts/ask-history']) {
    assert.equal(detail.includes(marker), false, `Personal detail ${file} still includes AI chat marker: ${marker}`);
  }
}
assert.equal(terminal.includes('cmds.ask'), false);
assert.equal(terminal.includes('ask <question>'), false);
assert.equal(palette.includes('window.ASK_PANEL'), false);
assert.equal(palette.includes('window.QA'), false);

console.log('Work-only assistant context tests passed');
