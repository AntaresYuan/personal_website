# Loop log — /usage dashboard (umbrella #149)

Autonomous devloop run on 2026-05-13. Queue: #151 → #150 → #152, in strict dependency order.

---

## #151 — Worker + KV ✅ merged, deployed, verified, closed

- **Branch**: `feat/usage-worker`
- **PR**: [#154](https://github.com/AntaresYuan/personal_website/pull/154) — squash-merged as [d41235b](https://github.com/AntaresYuan/personal_website/commit/d41235b)
- **Files**: `workers/usage/{wrangler.toml, src/index.js, README.md}` + `.gitignore` (excludes `LOOP-FRICTION.jsonl` from the loop's friction log)
- **What shipped**:
  - Zero-deps single-file Cloudflare Worker
  - `POST /` — bearer-auth, strict allowlist schema (`{date, source, tokens, sessions}` only — any extra key → 400), per-source slot map in KV, read-modify-write
  - `GET /` — last 90 days summed across source slots, CORS-locked to `antaresyuan.site`, privacy-projected to `{date, tokens, sessions}` only; source labels never leave the Worker
  - `README.md` — privacy contract, deploy steps, 8 curl smoke-test recipes covering every #151 acceptance criterion
- **Tested**:
  - `node -c src/index.js` — syntax OK
  - CJK grep on `workers/usage/` — 0 matches (pure English per CLAUDE.md)
  - Validator walked: missing/extra/wrong-type fields, real-date drift (`2026-02-30`), oversize body, unauthorized, wrong bearer, corrupted KV entry
- **Independent code review** ([sub-agent](https://github.com/AntaresYuan/personal_website/pull/154#issuecomment-4446930090)): clean privacy contract, clean validator, clean auth, clean CORS, clean off-by-one. One wording fix (misleading "different sources never collide" comment) — addressed in [e254968](https://github.com/AntaresYuan/personal_website/commit/e254968) before merge.
- **Operator bind** (one-time setup, done):
  - `wrangler kv namespace create USAGE_KV` → id `5631e998e5...` (committed in `f83a5f0`)
  - `SHARED_SECRET` rotated (the chat-leaked one is dead) and stored in macOS keychain at `(account="$USER", service="antares-sync-usage")` — #150 sync agent reads from there at runtime
  - `usage.antaresyuan.site` custom domain bound (same-zone Anycast = CN-reachable, mirrors `qa.antaresyuan.site`)
  - `workers_dev = false` + `routes[]` block pinned in `wrangler.toml` (`f83a5f0`) so the binding is reproducible from git — next deploy doesn't need dashboard
- **Friction log entries**: `retry` (wrangler v2 vs v3 `kv:namespace` → `kv namespace` syntax fix, caught operator-side)
- **Live verification** (`/tmp/smoke-usage.js`, reads secret from keychain, never prints it): **23/23 checks green**
  - POST 401 (no auth) ✓ · POST 401 (bad bearer) ✓ · POST 400 (`{model:"opus"}` extra field) ✓ · POST 200 (happy) ✓
  - Two-source POST + GET sum: 1234567 + 100000 = 1334567 tokens, 4 + 1 = 5 sessions ✓
  - GET response shape is exactly `{date, tokens, sessions}` per day ✓
  - **Privacy grep on GET body**: no `claude-`, no `source` substring ✓ ✓
  - GET days[] is 90 long, oldest-first, ends with today UTC ✓
  - CORS preflight from `antaresyuan.site` → 204 + ACAO ✓; from foreign origin → no ACAO header ✓
  - Cleanup zeros POSTed for the 2 test source slots so they don't pollute real-data heatmap
- **Issue closed**: [#151](https://github.com/AntaresYuan/personal_website/issues/151#issuecomment-4447110371) (auto-closed by PR #154 merge; full smoke-test verification posted as the closing comment)

---

## #150 — Local sync agent ✅ merged, verified live, closed

- **Branch**: `feat/usage-sync-agent`
- **PR**: [#155](https://github.com/AntaresYuan/personal_website/pull/155) — merged as [19be022](https://github.com/AntaresYuan/personal_website/commit/19be022)
- **Files**: `scripts/sync-usage.js`, `scripts/sync-usage.config.example.json`, `ops/launchagent/{plist.template, install.sh}`, `ops/claude-hook/sync-usage-on-stop.sh`, `docs/usage-sync.md`
- **Privacy gate**: 4-field allowlist constructed at the boundary in `payloadsFor()` — extra fields can't slip through by construction
- **Secret resolution**: macOS keychain first (account=$USER, service=antares-sync-usage), config fallback
- **Live verification**: 14 days POSTed (`14 ok, 0 failed`), idempotent re-run consistent, public GET reflects synced totals, leftover smoke-test slots zeroed
- **Independent code review** ([sub-agent](https://github.com/AntaresYuan/personal_website/pull/155)): clean privacy, clean allowlist enforcement, clean secret handling. 3 operational fixes applied pre-merge: install.sh chmods Stop hook, hard-fails on version-manager Node (nvm/asdf/fnm/volta), guards macOS-only
- **Operator install** (when ready): `./ops/launchagent/install.sh` for hourly + Stop hook snippet in `~/.claude/settings.json`

## #152 — `/usage` frontend ✅ merged, deploy polling, closed

- **Branch**: `feat/usage-section`
- **PR**: [#156](https://github.com/AntaresYuan/personal_website/pull/156) — merged as [2f9a1b4](https://github.com/AntaresYuan/personal_website/commit/2f9a1b4)
- **Files**: `content/site.json` (+ usage block), `index.html`, `scripts/build-html.js`, `scripts/render.js`, `styles/main.css`
- **What shipped**: above-the-fold section with 12×7 hand-SVG heatmap (calendar-aligned, 4-yellow-shade quartile), 4-number stats row (tokens · sessions · 7-day active · since), rotating fun-fact (4 book references, 7s cycle), pulsing "live · Ns ago" indicator, 60s setInterval + visibilitychange handling, silent-hide on Worker error
- **SSR shell**: build-html.js emits the 84-cell empty heatmap + em-dash stat skeletons (including "since —" so the row width is stable from SSR → first paint)
- **Heatmap math**: 4 test cases passed (today=Wed/Thu/Sun/Sat) — Sunday-edge now produces 84 cells with 6 future placeholders (prior algorithm silently dropped ~2 oldest cells)
- **Independent code review** ([sub-agent](https://github.com/AntaresYuan/personal_website/pull/156#issuecomment-4447205506)): privacy contract clean (no leak vectors), 4 bugs flagged + fixed in [3f774e9](https://github.com/AntaresYuan/personal_website/commit/3f774e9) — Sunday-edge cells, stats-row reflow on first fetch, missing fetch timeout, spammy aria-live on 60s/7s update cadences
- **Deploy verification**: background curl-poll on `https://antaresyuan.site/` for the `id="usage"` marker — see this loop's exit message

## Loop complete

3 PRs (`#154`, `#155`, `#156`), 3 squash-merges via `--admin`, 1 follow-up commit (`f83a5f0`) for the Worker's wrangler routes config. End-to-end pipeline live:

```
Local Mac (claude-mbp)
  ~/.claude/projects/*/SESSION.jsonl
  └─ scripts/sync-usage.js (zero-deps, --dry-run, allowlist gate)
     │
     ▼ POST {date, source, tokens, sessions}  +  Bearer (keychain)
        usage.antaresyuan.site  (custom domain on the same Cloudflare zone)
     ├─ schema re-validate (extra field → 400)
     ├─ KV: usage:YYYY-MM-DD  ← per-source slot map
     └─ GET /  →  {days: [{date, tokens, sessions}], since, updated}  (sum across sources, no slot data ever on the wire)
                    │
                    ▼ scripts/render.js wireUsage(site)
                       index.html #usage  ← 12×7 hand-SVG heatmap + 4 stats + rotating fun-fact
```

### Friction events logged for /iterate

1. `retry` — wrangler v2 vs v3 `kv:namespace` syntax (operator-side, caught + fixed in docs + main during loop)
2. `stop_condition_hit` — wrangler-bind handoff after #151 PR merge (system worked as designed)

Both events are in `LOOP-FRICTION.jsonl` for the next /iterate retro.

### What's left on the operator

- (Tomorrow morning) visual smoke on `https://antaresyuan.site/` — heatmap shading, stat numbers, live counter ticking, fun-fact rotating
- (Optional, for continuous data) install the LaunchAgent (`./ops/launchagent/install.sh`) + Stop hook (snippet in `docs/usage-sync.md`)
- (Future, if adding iMac) repeat the sync-agent setup with `source: "claude-imac"` — Worker sums slots automatically
