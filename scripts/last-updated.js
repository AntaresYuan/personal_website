/* ════════════════════════════════════════════════════════════════════════
   last-updated.js — the site's "last updated" date, computed once.

   Pinned by content/site.json → footer.lastUpdated when that's a non-empty
   string; otherwise automatic: the date of the last commit (the rebuild
   workflow runs on every content change, so HEAD is the content commit at
   build time), falling back to today's date when not in a git checkout.

   Exported as a 'YYYY-MM-DD' string. Shared by build-html / build-sitemap /
   build-llms so they all agree (and so render.js leaves the baked-in value
   alone unless footer.lastUpdated is set — see scripts/render.js renderMeta).
   ════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');

module.exports = (() => {
  let pinned = '';
  try {
    const footer = JSON.parse(fs.readFileSync(path.join(root, 'content/site.json'), 'utf8')).footer || {};
    pinned = String(footer.lastUpdated || '').trim();
  } catch (_) { /* missing / unreadable site.json — fall through */ }
  if (pinned) return pinned;

  try {
    const d = execSync('git log -1 --format=%cs', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  } catch (_) { /* not a git checkout, or git missing — fall through */ }

  return new Date().toISOString().slice(0, 10);
})();
