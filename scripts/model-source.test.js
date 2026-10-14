#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'scripts/lib/work-shell.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'scripts/work.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles/work.css'), 'utf8');
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(shell.includes('id="ask-model-source"'), 'ask panel needs a model-source status');
assert(shell.includes('role="status"'), 'model source should announce route changes accessibly');
assert(runtime.includes("if (via === 'local') setSource('local', model)"), 'local replies must select the local indicator');
assert(runtime.includes("else if (via === 'cloud') setSource('cloud', model)"), 'Workers replies must select the cloud indicator');
assert(runtime.includes("else if (via === 'tool') setSource(model === 'render_ui' ? 'ui' : 'tool', model)"), 'tool replies must distinguish live data from A2UI');
assert(runtime.includes('model: d.model'), 'the Worker model name must reach the indicator');
assert(css.includes('.ask-model-source[data-source="local"]'), 'local indicator styling is missing');
assert(css.includes('.ask-model-source[data-source="cloud"]'), 'cloud indicator styling is missing');
assert(css.includes('.ask-model-source[data-source="tool"]'), 'tool indicator styling is missing');
assert(css.includes('.ask-model-source[data-source="ui"]'), 'A2UI indicator styling is missing');
assert(css.includes('.ask-trace'), 'query trace affordance styling is missing');
assert(home.includes('id="ask-model-source"'), 'generated home page is stale');
assert(!runtime.includes('Answered by a model running on my MacBook'), 'the old per-answer source note should be removed');

console.log('model source indicator tests passed');
