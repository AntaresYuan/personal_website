# `/usage` — local sync agent install

The agent reads Claude Code session jsonl files, aggregates daily totals
(tokens + sessions), and POSTs the trailing window to the
`usage.antaresyuan.site` Worker so the public `/usage` heatmap stays
current. Source-aware: each machine identifies as `<ai>-<device>` so
multiple Macs aggregate cleanly on the Worker side without overwriting
each other.

See `workers/usage/README.md` for the Worker side + privacy contract.

> **Platform**: the LaunchAgent installer (`ops/launchagent/install.sh`)
> and the keychain integration are macOS-only. On Linux, run
> `node scripts/sync-usage.js` from a systemd timer or cron job, and
> either store the bearer in your platform's secret manager (e.g. `pass`,
> `secret-tool`) or paste it into the optional `secret` field of the
> config — there's no Linux equivalent of the keychain fallback wired up
> in v1.

## What the agent reads

Each event in `~/.claude/projects/<project-slug>/<session-uuid>.jsonl`
with `type: "assistant"` has a `message.usage` object. The agent sums
`input_tokens + output_tokens + cache_creation_input_tokens` per event
and groups by the event's `timestamp`'s UTC date. A "session" is a
distinct `sessionId` that had any activity on that day.

**`cache_read_input_tokens` is deliberately excluded** — those are cached
prompt bytes re-served at each turn, and on a 1M-context Claude Code
session they can be 500K+ "tokens" per turn of already-paid-for content.
Counting them inflates daily totals by 50–100× and turns the dashboard
into a meaningless billions-of-tokens number. We track "fresh work the
model did" instead.

That's it — no message content, no project names, no model ids, no
hourly distribution, no individual event details ever leave the machine.

## What the agent sends

Exactly one POST per non-empty day in the trailing window:

```
POST https://usage.antaresyuan.site/
Authorization: Bearer <SHARED_SECRET>
Content-Type: application/json

{ "date": "2026-05-14", "source": "claude-mbp", "tokens": 1234567, "sessions": 4 }
```

The shape is hardcoded in the agent's `payloadsFor()` function — a
4-field allowlist. The Worker re-validates server-side; any extra key
→ 400. Two layers of defense, one privacy contract.

## Install (one machine)

1. **Config** — copy the example and edit `source` for this machine:

   ```sh
   mkdir -p ~/.config
   cp scripts/sync-usage.config.example.json ~/.config/antares-sync-usage.json
   # edit ~/.config/antares-sync-usage.json:
   #   - source: "claude-mbp" (or "claude-imac", or whatever)
   #   - endpoint: leave as is unless you're forking
   ```

2. **Secret** — store the bearer in the macOS keychain so the agent reads
   it at runtime without a plaintext copy on disk:

   ```sh
   security add-generic-password -a "$USER" -s "antares-sync-usage" -w '<bearer>'
   ```

   The Worker's `wrangler secret put SHARED_SECRET` value goes here. If
   you'd rather paste the secret into the config file instead (less
   secure), put it in the optional `"secret"` field and the agent will
   prefer that.

3. **Dry-run** to confirm payloads look right (nothing sent):

   ```sh
   node scripts/sync-usage.js --dry-run
   ```

   You'll see one JSON line per non-empty day in the trailing 14-day
   window. Verify no extra fields, no message content.

4. **First real sync**:

   ```sh
   node scripts/sync-usage.js --verbose
   ```

   Expect a `POST <date> ok` line per day. Verify on the public side:

   ```sh
   curl -s -H 'origin: https://antaresyuan.site' https://usage.antaresyuan.site/ \
     | python3 -m json.tool | head -20
   ```

   Today's `tokens` / `sessions` should match what the dry-run printed.

5. **LaunchAgent** (hourly, runs in background):

   ```sh
   ./ops/launchagent/install.sh           # installs + bootstraps + first run
   ./ops/launchagent/install.sh status    # current state + last 20 log lines
   ./ops/launchagent/install.sh remove    # uninstall cleanly
   ```

   Logs land in `~/Library/Logs/antares-sync-usage.log`. The agent is
   idempotent — missing a tick is fine; the next tick picks it up.

6. **Stop hook** (fires after each Claude Code session ends, so totals
   refresh within seconds of your last response):

   Edit `~/.claude/settings.json` and add:

   ```json
   {
     "hooks": {
       "Stop": [
         {
           "matcher": "",
           "hooks": [
             {
               "type": "command",
               "command": "/ABSOLUTE/PATH/TO/personal_website/ops/claude-hook/sync-usage-on-stop.sh"
             }
           ]
         }
       ]
     }
   }
   ```

   Replace `/ABSOLUTE/PATH/TO/personal_website` with your repo path. The
   wrapper backgrounds the sync so session-end isn't delayed; output
   tails into the same log as the LaunchAgent.

## A second machine (e.g. iMac)

Repeat steps 1–6 with `source: "claude-imac"` (or any unique `[a-z0-9._-]+`
label up to 32 chars). The Worker's KV layout is per-source-slot inside
each day, so the two machines don't overwrite each other — the public
GET sums them.

You'll need the same `SHARED_SECRET` on both machines. Easiest: copy
it via your password manager, or `security export` from the first Mac
and `security import` on the second.

## Rotating the secret

```sh
# 1. on dev machine: generate a new one and push it to the Worker
NEW=$(openssl rand -base64 32)
echo -n "$NEW" | npx wrangler secret put SHARED_SECRET --config workers/usage/wrangler.toml
# 2. update keychain on every machine that has the agent installed
security add-generic-password -U -a "$USER" -s "antares-sync-usage" -w "$NEW"
unset NEW
```

The Worker rejects old-secret POSTs as soon as `wrangler secret put`
completes (no overlap window). Update every machine within a few
minutes; the next LaunchAgent tick on a stale machine will 401 and the
log will tell you which one needs the new value.

## Reading the live data

```sh
# the full GET response (last 90 days, summed across sources)
curl -s -H 'origin: https://antaresyuan.site' https://usage.antaresyuan.site/

# just today's number
curl -s -H 'origin: https://antaresyuan.site' https://usage.antaresyuan.site/ \
  | jq '.days[-1]'
```

## Troubleshooting

| symptom | likely cause |
|---|---|
| `POST <date> FAILED status=401` | secret in keychain doesn't match the Worker's; re-run `wrangler secret put` or update keychain |
| `POST <date> FAILED status=400 ... unexpected field` | the agent's allowlist is out of sync with the Worker's; pin the same version of both |
| LaunchAgent doesn't fire | `./ops/launchagent/install.sh status` — if not loaded, re-install. Check log at `~/Library/Logs/antares-sync-usage.log` |
| Stop hook doesn't fire | confirm the path in `~/.claude/settings.json` is absolute and the script is `chmod +x` |
| `can't read claudeProjectsDir` | wrong path in config; default `~/.claude/projects` works on a stock Claude Code install |
| every day shows 0 | no `type: "assistant"` events with `usage` in your jsonls — happens on a fresh install before any session has run |
| LaunchAgent log says "no secret available" every hour | macOS keychain is locked at LaunchAgent fire time (rare; usually only after a fresh boot before login). Unlock the keychain or move the secret to the `secret` field in the config. |
| `install: 'node' resolves under a version manager` | nvm/asdf/fnm/volta shims aren't on launchd's PATH. Install a system Node (`brew install node`) and re-run, or hardcode an absolute path in the installer. |
