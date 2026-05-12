#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   scaffold-reset.js — wipe the personal content so a fork can start clean.

     npm run reset-content        (or: node scripts/scaffold-reset.js)

   Replaces content/*.json + content/blog/*.md with placeholders, clears the
   tokens in content/site.json, and prints the remaining manual steps (the
   images in media/, the FAQ in scripts/qa-faq.js, your Cloudflare config).
   It does NOT touch any code, styles, the CMS config, or the Workers.

   Safety: if the git remote is the original repo (AntaresYuan/personal_website)
   it refuses unless you pass --force — so running this from the source repo by
   accident doesn't nuke the live site's content.

   After it runs:  node scripts/build.js   (or: npm run build)
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const force = process.argv.includes('--force');

/* ── guard: don't wipe the original repo by mistake ───────────────────── */
if (!force) {
  let remote = '';
  try { remote = execSync('git config --get remote.origin.url', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { /* no git / no remote — nothing to guard against */ }
  if (/AntaresYuan\/personal_website(\.git)?$/i.test(remote)) {
    console.error('✋ This looks like the original repo (remote: ' + remote + ').');
    console.error('   Refusing to wipe its content. If you really mean it: node scripts/scaffold-reset.js --force');
    process.exit(1);
  }
}

/* ── placeholder content ──────────────────────────────────────────────── */
const write = (rel, obj) => {
  fs.writeFileSync(path.join(root, rel), JSON.stringify(obj, null, 2) + '\n');
  console.log('  reset  ' + rel);
};

write('content/site.json', {
  meta: {
    title: 'Your Name',
    siteName: 'Your Name',
    description: 'One line about you — this becomes the meta description and the /llms.txt summary.',
    url: 'https://your-site.example',
    author: 'Your Name',
    lang: 'en',
    locale: 'en_US',
    ogImage: 'media/avatar-calm.png',
    ogImageWidth: '512',
    ogImageHeight: '512',
  },
  footer: {
    copyright: '© ' + new Date().getFullYear() + ' Your Name',
    tagline: 'A short line for the footer.',
    lastUpdated: '',
  },
  analytics: { cfAnalyticsToken: '' },
  giscus: { repo: '', repoId: '', category: '', categoryId: '', mapping: 'pathname', theme: 'preferred_color_scheme', inputPosition: 'bottom' },
  qa: { workerUrl: '' },
});

write('content/profile.json', {
  name: 'Your',
  nameAccent: 'Name',
  role: 'What you do',
  location: 'City · status',
  status: 'Building in public',
  slogan: 'A line that sums you up.',
  manifesto: 'A sentence or two on how you work.',
  resumeEn: '',
  resumeZh: '',
  avatar: { calm: 'media/avatar-calm.png', talking: 'media/avatar-talking.png', alt: 'Your Name — portrait' },
  tags: ['Tag one', 'Tag two', 'Tag three'],
  ctas: [
    { audience: 'for recruiters', label: 'what I\'ve shipped', anchor: '#shipped', note: 'projects + impact' },
    { audience: 'for founders', label: 'what I\'m building', anchor: '#now', note: 'current focus' },
    { audience: 'for everyone', label: 'get in touch', anchor: '#contact', note: 'how to reach me' },
  ],
});

write('content/board.json', {
  cards: [
    {
      started: '', updated: '', order: 1, status: 'shipped', id: 'shipped-1',
      title: 'An example shipped project',
      summary: 'One or two sentences on what it is and why it mattered.',
      impact: '',
      tags: ['EXAMPLE', '0→1'],
      links: [{ label: 'Demo', href: '#' }, { label: 'Code', href: '#' }],
      details: '## Context\n\nReplace this with the longer story — two or three short paragraphs.\n\n## What I owned\n\n- Decision X\n- Decision Y\n\n## Outcome\n\nWhat happened. What you’d do differently.',
    },
    {
      started: '', updated: '', order: 1, status: 'now', id: 'now-1',
      title: 'Something you’re building',
      summary: 'What you’re working on right now.',
      impact: '',
      tags: ['EXAMPLE'],
      links: [],
      details: '## The bet\n\nWhy this, why now.\n\n## Where it is\n\nCurrent state.',
    },
    {
      started: '', updated: '', order: 1, status: 'next', id: 'next-1',
      title: 'On the roadmap',
      summary: 'Something planned but not started.',
      impact: '', tags: ['EXAMPLE'], links: [],
      details: '',
    },
  ],
});

write('content/lens.json', {
  head: { cmd: '$ grep -i', title: 'how_i_think.md', meta: 'principles' },
  items: [
    { num: '/ 01', main: 'A principle you actually hold.', aside: 'The one-line reason it matters.' },
    { num: '/ 02', main: 'Another one.', aside: 'Keep these short and real.' },
  ],
});

write('content/contact.json', {
  head: { cmd: '$ ./reach-out', title: 'open to:', meta: '' },
  intro: 'What you’re open to — roles, collaborations, conversations. <em>Tell people how to start one.</em>',
  items: [
    { key: 'email', label: 'you@example.com', href: 'mailto:you@example.com' },
    { key: 'linkedin', label: 'Your Name', href: '#' },
    { key: 'github', label: '@yourhandle', href: 'https://github.com/yourhandle' },
  ],
});

write('content/agent-brief.json', { notes: [] });

/* ── blog: clear posts, leave one example ─────────────────────────────── */
const blogDir = path.join(root, 'content', 'blog');
fs.mkdirSync(blogDir, { recursive: true });
for (const f of fs.readdirSync(blogDir)) {
  if (f.endsWith('.md')) { fs.rmSync(path.join(blogDir, f)); console.log('  remove content/blog/' + f); }
}
fs.writeFileSync(path.join(blogDir, 'hello-world.md'),
  '---\ntitle: "Hello, world"\ndate: ' + new Date().toISOString().slice(0, 10) + '\nsummary: "Your first post. Write what this blog is for."\ndraft: false\n---\n\nThis is your first post. Edit it in `/admin/` (the **Blog** collection) or by\nhand at `content/blog/hello-world.md`, then run `npm run build`.\n\nMarkdown works: headings, lists, `code`, ```fenced``` blocks, > quotes,\n[links](https://example.com), and images.\n');
console.log('  reset  content/blog/hello-world.md');

/* ── done — what’s left to do by hand ─────────────────────────────── */
console.log(`
✓ Content reset. Still yours to do:

  1. media/avatar-calm.png + media/avatar-talking.png — replace with your own
     images (or delete them and update content/profile.json → avatar). Same for
     any résumé PDFs in media/ (set profile.json → resumeEn / resumeZh, or "").
  2. scripts/qa-faq.js — the hand-written FAQ behind ⌘K and the "ask" bar.
     Edit the FAQ array for your site (a few Q&A pairs is plenty).
  3. content/site.json → meta.url, footer, and (optionally) the analytics /
     giscus / qa tokens. README has the setup steps for each.
  4. Deploy: point Cloudflare Pages at your fork. For /admin/ to work, deploy
     the OAuth Worker in workers/decap-oauth/ (see its README); for the "ask"
     assistant, deploy workers/qa/ and put its URL in site.json → qa.workerUrl.
  5. Run:  npm run build   (or: node scripts/build.js)  — then commit.

The code, styles, CMS config, and Workers were not touched.
`);
