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

## #150 — Local sync agent 🚧 in progress

Endpoint is live, secret is in keychain — resuming the loop. Writing `scripts/sync-usage.js` (zero-deps Node, `--dry-run` mode), config example, LaunchAgent plist + Stop hook, and `docs/usage-sync.md`.

## #152 — `/usage` section ⏳ queued (blocked on #150 → real data)

Will add SSR shell + 12×7 hand-SVG heatmap + 60s refetch + fun-fact rotator + `usage.endpoint`/`usage.enabled` in `content/site.json`. Section silently hides on GET error so a fork without the Worker doesn't see a broken widget.
