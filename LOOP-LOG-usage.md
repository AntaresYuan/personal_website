# Loop log — /usage dashboard (umbrella #149)

Autonomous devloop run on 2026-05-13. Queue: #151 → #150 → #152, in strict dependency order.

---

## #151 — Worker + KV ✅ merged, ⏸ paused for operator bind

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
- **Deploy verification**: ⏸ **pending operator bind**. The Worker can't be exercised until you `wrangler login` + create KV namespace + `wrangler secret put SHARED_SECRET` + `wrangler deploy` + bind `usage.antaresyuan.site` in the Cloudflare dashboard. Instructions are in [`workers/usage/README.md`](https://github.com/AntaresYuan/personal_website/blob/main/workers/usage/README.md) and the [#151 comment](https://github.com/AntaresYuan/personal_website/issues/151#issuecomment-4446932302).

### Loop paused — handoff to operator

Stop condition fired: **wrangler-bind handoff**. The loop won't resume #150/#152 until you confirm the endpoint is live (curl tests 1–8 from the Worker README all green). Issue #151 stays open until then.

Save the `SHARED_SECRET` value — you'll paste it into `~/.config/antares-sync-usage.json` for #150's sync agent.

---

## #150 — Local sync agent ⏳ queued (blocked on #151 endpoint)

Will write `scripts/sync-usage.js` (zero-deps Node, `--dry-run` mode), the LaunchAgent plist + Stop hook, and `docs/usage-sync.md`. PR can be opened immediately after the endpoint is live (need to run a real POST to satisfy acceptance).

## #152 — `/usage` section ⏳ queued (blocked on #150 → real data)

Will add SSR shell + 12×7 hand-SVG heatmap + 60s refetch + fun-fact rotator + `usage.endpoint`/`usage.enabled` in `content/site.json`. Section silently hides on GET error so a fork without the Worker doesn't see a broken widget.
