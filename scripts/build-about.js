#!/usr/bin/env node
/* Render /about/ on the shared Work shell. The copy is assembled from the
   existing profile, Work message and contact sources so the page stays in
   sync with the CMS instead of becoming a second biography to maintain. */
'use strict';
const fs = require('fs');
const path = require('path');
const { escapeHtml: e } = require('./lib/blog');
const shell = require('./lib/work-shell');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const site = read('content/site.json');
const profile = read('content/profile.json');
const work = read('content/work.json');
const contact = read('content/contact.json');
const SITE_URL = (site.meta?.url ?? 'https://example.com').replace(/\/$/, '');

if (site.features?.about === false) {
  const outDir = path.join(root, 'about');
  fs.mkdirSync(outDir, { recursive: true });
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="refresh" content="0;url=/">
<link rel="canonical" href="${SITE_URL}/">
<title>Redirecting to Antares Yuan</title>
</head>
<body>
<p>About is temporarily unavailable. <a href="/">Return home</a>.</p>
<script>location.replace('/');</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  console.log(`✓ wrote about/         (${html.length} bytes, disabled → home)`);
  return;
}

const tags = (profile.tagsWork ?? []).map((tag) => `<li>${e(tag)}</li>`).join('');
const contactLinks = (contact.items ?? []).map((item) => {
  const external = /^https?:\/\//.test(item.href || '');
  return `<li><a href="${e(item.href || '#')}"${external ? ' target="_blank" rel="noopener"' : ''}>
    <span>${e(item.key || item.label)}</span><strong>${e(item.label)}</strong>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>
  </a></li>`;
}).join('');

const main = `  <section class="about" aria-labelledby="about-title">
    <header class="about-hero">
      <div class="about-copy">
        <p class="about-kicker">About me</p>
        <h1 class="about-title" id="about-title">I build AI products that stay grounded in real problems.</h1>
        <p class="about-lead">I’m ${e(work.name?.first || profile.name)} (${e(work.name?.middle || 'Chenjie')}) ${e(work.name?.last || profile.nameAccent)}, an AI product manager working across product strategy, human-centered design and hands-on building.</p>
        ${tags ? `<ul class="about-tags" aria-label="Quick facts">${tags}</ul>` : ''}
      </div>
      <figure class="about-portrait">
        <img src="/${e(String(profile.avatar?.calm || 'media/avatar-calm.png').replace(/^\/+/, ''))}" alt="${e(profile.avatar?.alt || 'Antares Yuan')}" width="240" height="240">
      </figure>
    </header>

    <div class="about-grid">
      <section class="about-card about-card-wide">
        <p class="about-card-label">How I work</p>
        <p class="about-statement">${e(work.message?.body || profile.manifesto || '')}</p>
      </section>
      <section class="about-card">
        <p class="about-card-label">What I care about</p>
        <ul class="about-points">
          <li>AI agents that earn trust through clear product behavior.</li>
          <li>0→1 systems that connect research, strategy and shipping.</li>
          <li>Human-centered interfaces for complex AI capabilities.</li>
        </ul>
      </section>
      <section class="about-card">
        <p class="about-card-label">Currently</p>
        <p>${e(contact.intro || profile.status || '')}</p>
        ${profile.resumeEn ? `<a class="about-resume" href="${e(profile.resumeEn)}" target="_blank" rel="noopener">View résumé <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg></a>` : ''}
      </section>
    </div>

    <section class="about-links" aria-labelledby="about-links-title">
      <h2 id="about-links-title">Elsewhere</h2>
      <ul>${contactLinks}</ul>
    </section>
  </section>`;

const outDir = path.join(root, 'about');
fs.mkdirSync(outDir, { recursive: true });
const html = shell.pageHtml({
  title: 'About me',
  description: `About ${profile.name || 'Antares'} ${profile.nameAccent || 'Yuan'} — AI product manager, human-centered designer and builder.`,
  canonical: `${SITE_URL}/about/`,
  active: 'about',
  bodyClass: 'about-page',
  main,
});
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`✓ wrote about/         (${html.length} bytes)`);
