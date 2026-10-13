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
assert.equal(render.safeUrl('/media/袁晨杰产品简历(策略AI产品 8.19).pdf'), '/media/%E8%A2%81%E6%99%A8%E6%9D%B0%E4%BA%A7%E5%93%81%E7%AE%80%E5%8E%86%28%E7%AD%96%E7%95%A5AI%E4%BA%A7%E5%93%81%208.19%29.pdf');
assert.match(render.markdown('Read [my résumé](/media/resume.pdf).'), /<a href="\/media\/resume\.pdf">my résumé<\/a>/);
const complexLink = render.markdown('📄 [简历附件：袁晨杰产品简历](/media/袁晨杰产品简历(策略AI产品 8.19).pdf)');
assert.match(complexLink, /href="\/media\/%E8%A2%81%E6%99%A8%E6%9D%B0%E4%BA%A7%E5%93%81%E7%AE%80%E5%8E%86%28%E7%AD%96%E7%95%A5AI%E4%BA%A7%E5%93%81%208\.19%29\.pdf"/);
assert.doesNotMatch(complexLink, /<\/a>\.pdf\)/, 'parentheses in a PDF URL must stay inside the link');
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
