#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {}, URL };
vm.createContext(context);
vm.runInContext(fs.readFileSync('scripts/ask-render.js', 'utf8'), context);
const render = context.window.ASK_RENDER;

assert.equal(render.safeUrl('javascript:alert(1)'), '');
assert.equal(render.safeUrl('/media/resume.pdf'), '/media/resume.pdf');
assert.equal(render.safeUrl('/media/袁晨杰 resume.pdf'), '/media/%E8%A2%81%E6%99%A8%E6%9D%B0%20resume.pdf');
assert.match(render.markdown('Read [my résumé](/media/resume.pdf).'), /<a href="\/media\/resume\.pdf">my résumé<\/a>/);
assert.match(render.markdown('Visit https://example.com/docs.'), /href="https:\/\/example\.com\/docs"/);
assert.match(render.markdown('- one\n- **two**'), /<ul><li>one<\/li><li><strong>two<\/strong><\/li><\/ul>/);
assert.doesNotMatch(render.markdown('<img src=x onerror=alert(1)>'), /<img/);
assert.match(render.markdown('<img src=x onerror=alert(1)>'), /&lt;img/);

const cards = render.resources([
  { kind: 'pdf', title: 'Résumé', description: 'English', url: '/media/resume.pdf' },
  { kind: 'link', title: '<unsafe>', url: 'javascript:alert(1)' },
], { aria: 'Files', link: 'Link', image: 'Image' });
assert.match(cards, /data-kind="pdf"/);
assert.match(cards, />Résumé</);
assert.doesNotMatch(cards, /javascript:/);

console.log('Ask rich rendering tests passed');
