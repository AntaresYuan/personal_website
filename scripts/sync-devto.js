#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   sync-devto.js — cross-post new blog posts to DEV (dev.to), canonical→home.

     node scripts/sync-devto.js

   For each published post in content/blog/ that isn't already on dev.to (it
   checks dev.to's API by `canonical_url`, so it's stateless and re-runnable),
   it POSTs the post to dev.to with `canonical_url` pointing back to this site
   (so the original keeps the SEO). Posts are created as **drafts** by default
   — review and publish them on dev.to — set DEVTO_PUBLISH=true to publish
   immediately.

   Needs `DEVTO_API_KEY` (DEV → Settings → Extensions → DEV API Keys). If it's
   not set, this is a no-op and exits 0 — so the GitHub Action that runs it is
   harmless until you configure the secret. Wired in .github/workflows/sync-devto.yml.

   Why dev.to and not Medium: Medium's write API was closed to new integrations
   in Jan 2025. dev.to's API is open, documented, and has a `canonical_url`
   field — the right shape for SEO-safe syndication.
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadPosts } = require('./lib/blog');

const root = path.join(__dirname, '..');
const site = JSON.parse(fs.readFileSync(path.join(root, 'content/site.json'), 'utf8'));
const SITE_URL = (site.meta?.url ?? '').replace(/\/$/, '');

const KEY = process.env.DEVTO_API_KEY;
const PUBLISH = process.env.DEVTO_PUBLISH === 'true';
const API = 'https://dev.to/api';

if (!KEY) {
  console.log('sync-devto: DEVTO_API_KEY not set — skipping (configure the secret to enable).');
  process.exit(0);
}
if (!SITE_URL || /example/.test(SITE_URL)) {
  console.log('sync-devto: content/site.json → meta.url isn’t a real site URL — skipping.');
  process.exit(0);
}

const canonicalFor = (slug) => `${SITE_URL}/blog/${slug}/`;
// site-relative Markdown links/images → absolute (dev.to needs them absolute)
const absLinks = (md) => String(md).replace(/(!?\]\()\/(?!\/)/g, `$1${SITE_URL}/`);

async function devto(method, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: { 'api-key': KEY, 'content-type': 'application/json', accept: 'application/vnd.forem.api-v1+json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) { const e = new Error(`dev.to ${method} ${endpoint} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`); e.status = res.status; throw e; }
  return data;
}

(async () => {
  const posts = loadPosts();   // published only
  if (!posts.length) { console.log('sync-devto: no published posts.'); return; }

  // What's already on dev.to (drafts included), keyed by canonical_url.
  let mine;
  try { mine = await devto('GET', '/articles/me/all?per_page=1000'); }
  catch (e) { console.error('sync-devto: couldn’t list your dev.to articles —', e.message); process.exitCode = 1; return; }
  const norm = (u) => String(u || '').replace(/\/+$/, '');
  const onDevto = new Set((Array.isArray(mine) ? mine : []).map((a) => norm(a.canonical_url)));

  let created = 0, failed = 0, skipped = 0;
  for (const p of posts) {
    const canonical = canonicalFor(p.slug);
    if (onDevto.has(norm(canonical))) { skipped++; continue; }
    try {
      const r = await devto('POST', '/articles', {
        article: {
          title: p.title,
          body_markdown: absLinks(p.body),
          published: PUBLISH,
          canonical_url: canonical,
          ...(p.summary ? { description: p.summary } : {}),
        },
      });
      created++;
      console.log(`sync-devto: ${PUBLISH ? 'published' : 'created draft'} “${p.title}” → ${r && r.url ? r.url : '(dev.to)'}  (canonical → ${canonical})`);
    } catch (e) {
      failed++;
      console.error(`sync-devto: FAILED “${p.title}” — ${e.message}`);
    }
  }
  console.log(`sync-devto: done — ${created} new, ${skipped} already on dev.to, ${failed} failed.`);
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error('sync-devto:', e); process.exitCode = 1; });
