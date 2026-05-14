# antares-usage — `/usage` dashboard Worker

Backend for the `/usage` section on https://antaresyuan.site. Receives
per-day, per-source usage from sync agents via authenticated POST; serves
the sum-across-sources daily totals via a public GET.

See **#149** for the umbrella + privacy contract, **#151** for this Worker's
spec, **#150** for the local sync agent, and **#152** for the frontend.

## Privacy contract — read first, do not bend

The GET response is **only**:

```json
{
  "days": [
    { "date": "2026-05-13", "tokens": 1234567, "sessions": 8 }
  ],
  "since": "2025-05-15",
  "updated": "2026-05-13T11:18:09Z"
}
```

Never on the wire:

- ⛔ Source labels (`claude-mbp`, `claude-imac`, etc.) — per-source data
  stays in KV; GET sums and drops the source map.
- ⛔ Per-hour distribution (presence inference, security risk)
- ⛔ Project / repo names
- ⛔ Model breakdown
- ⛔ Message contents or counts
- ⛔ Streak / "days in a row"
- ⛔ Any device hostname, IP, user, or PII

Enforcement points:

1. Local sync agents POST only the allowlisted shape.
2. Worker **re-validates** the POST schema; any extra key → `400`.
3. Worker GET handler builds the response from the allowlisted projection;
   no path emits the source slot.

Worker logs include `date` and the source slot label (for ops sanity
during deploy) but **never** the body. Don't add request-body logging.

## Architecture

```
KV key: usage:2026-05-13
value : {
  "claude-mbp":  { "tokens":  800000, "sessions": 5, "updated": "2026-05-13T03:42:11Z" },
  "claude-imac": { "tokens": 1200000, "sessions": 3, "updated": "2026-05-13T11:18:09Z" }
}
```

POST = read this map, set `[source] = { tokens, sessions, updated }`,
write back. Each source owns its own slot in the JSON value so two
sources' data never overwrite each other in normal operation. The parent
KV key is shared, so concurrent same-date writes CAN race at the KV
level (last-write wins on the whole object) — each write carries
**absolute** counters (not deltas) and sync cadence is hourly per source,
so realistic loss is zero. Same-source concurrent writes are last-wins
by design.

GET = read the last 365 days in parallel (one calendar year, matches the
GitHub-style year strip the frontend renders), sum each day across slots,
drop the slot map, return `{date, tokens, sessions}` per day plus the
global `updated` watermark. Window is controlled by `WINDOW_DAYS` in
`src/index.js`.

## Deploy (one-time)

```sh
cd workers/usage
npx wrangler login                                  # browser auth

npx wrangler kv namespace create USAGE_KV           # copy returned id (Wrangler v3+ syntax)
# paste the id into wrangler.toml [[kv_namespaces]].id

npx wrangler secret put SHARED_SECRET               # paste a long random bearer

npx wrangler deploy                                 # first deploy
```

After the first deploy, bind the custom domain so visitors and sync
agents hit `usage.antaresyuan.site` (NOT `*.workers.dev`, which is
intermittently CN-blocked):

> Cloudflare dashboard → Workers & Pages → `antares-usage` → Settings →
> Domains & Routes → **Add Custom Domain** → `usage.antaresyuan.site`

Same-zone Anycast = same endpoints that serve the main site, so a
CN-reachable site = a CN-reachable Worker. (Mirrors what `qa.antaresyuan.site`
does for `workers/qa`.)

## Smoke tests (after deploy)

Replace `SECRET` with the bearer you put above.

```sh
# 1. POST without auth → 401
curl -s -o - -w '\nHTTP %{http_code}\n' \
  -X POST https://usage.antaresyuan.site/ \
  -H 'content-type: application/json' \
  --data '{"date":"2026-05-13","source":"claude-test","tokens":1,"sessions":1}'

# 2. POST with bad auth → 401
curl -s -o - -w '\nHTTP %{http_code}\n' \
  -X POST https://usage.antaresyuan.site/ \
  -H 'authorization: Bearer wrong' \
  -H 'content-type: application/json' \
  --data '{"date":"2026-05-13","source":"claude-test","tokens":1,"sessions":1}'

# 3. POST with extra field → 400 (privacy guard — drop server-side)
curl -s -o - -w '\nHTTP %{http_code}\n' \
  -X POST https://usage.antaresyuan.site/ \
  -H "authorization: Bearer SECRET" \
  -H 'content-type: application/json' \
  --data '{"date":"2026-05-13","source":"claude-test","tokens":1,"sessions":1,"model":"opus"}'

# 4. POST happy path → 200 { "ok": true }
curl -s -o - -w '\nHTTP %{http_code}\n' \
  -X POST https://usage.antaresyuan.site/ \
  -H "authorization: Bearer SECRET" \
  -H 'content-type: application/json' \
  --data '{"date":"2026-05-13","source":"claude-test","tokens":1234567,"sessions":4}'

# 5. GET — should sum across sources and never echo the source slot
curl -s -H 'origin: https://antaresyuan.site' https://usage.antaresyuan.site/ \
  -o /tmp/usage-get.json
cat /tmp/usage-get.json | python3 -m json.tool | head -8

# 6. Privacy grep — these must each print 0
grep -c 'claude-'  /tmp/usage-get.json
grep -c 'source'   /tmp/usage-get.json

# 7. CORS preflight from the site origin → 204 with ACAO
curl -s -o - -w '\nHTTP %{http_code}\n' \
  -X OPTIONS https://usage.antaresyuan.site/ \
  -H 'origin: https://antaresyuan.site' \
  -H 'access-control-request-method: GET' -D - | head -20

# 8. CORS preflight from a foreign origin → no ACAO header in the response
curl -s -o - -w '\nHTTP %{http_code}\n' \
  -X OPTIONS https://usage.antaresyuan.site/ \
  -H 'origin: https://evil.example' \
  -H 'access-control-request-method: GET' -D - | head -20
```

After 4. a `usage:2026-05-13` KV row exists with `claude-test` slot;
5–6. prove the GET strips it.

## Rotating the secret

```sh
npx wrangler secret put SHARED_SECRET               # paste new bearer
```

Then update every sync agent's `~/.config/antares-sync-usage.json` →
`secret`. The Worker rejects old-secret POSTs immediately on the next
deploy (no overlap window — keep it short).

## Source slots

Convention: `<ai>-<device>`. The Worker accepts any
`[a-z0-9._-]+` token up to 32 chars; the cap is just a guard, not a
contract. Examples:

- `claude-mbp`, `claude-imac` — Claude Code on each Mac
- `anthropic-api`, `openai-api` — future API pollers (each gets its own
  source slot; the Worker doesn't care about the prefix)

Sync agents pick their slot via `~/.config/antares-sync-usage.json` →
`source`. See `scripts/sync-usage.js` (issue #150).
