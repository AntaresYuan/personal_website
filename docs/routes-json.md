# `_routes.json` — why `include` is no longer empty

`#134` set this file to `{ version: 1, include: [], exclude: [] }` with the
reasoning "the site is pure static; this rules out any phantom Functions
routing." That intent still holds for every path except one.

`functions/api/usage-detail.js` has to run as a Pages Function, because:

- **CORS.** The private feed lives on `usage.antaresyuan.site/detail`, which
  deliberately sends no `Access-Control-Allow-Origin` (private data must not be
  readable by any page that asks). So the browser could never fetch it
  cross-origin — it failed at the preflight, before auth was even consulted.
  Serving it from the site's own origin removes the preflight entirely.
- **Login.** Cloudflare Access runs *before* a Worker or Function executes, so
  it cannot be attached to `usage.antaresyuan.site` as a whole without also
  blocking the CLI — `launchd` has no browser and cannot answer an email OTP,
  so every machine's upload would begin failing silently. Gating only this one
  same-origin path leaves `POST /` and `GET /detail` untouched for the CLI.
- **Secret handling.** The bearer stays server-side in the Pages environment
  variable `USAGE_DETAIL_TOKEN`. It is never sent to the browser.

`include` is kept as narrow as possible (`/api/*`) so everything else is still
served as a static asset, preserving the original goal.

Two traps worth remembering:

- **An empty `include` means no Function ever runs.** A Function added without
  editing this file returns 404, which looks like a missing file rather than a
  routing rule.
- **The schema documents exactly three properties** (`version`, `include`,
  `exclude`). Do not add a comment key to this file — notes belong here
  instead, where a typo cannot break the deploy.
