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
`input_tokens + output_tokens` per event and groups by the event's
`timestamp`'s UTC date. A "session" is a distinct `sessionId` that had
any activity on that day.

**Why only input + output**, not the cache fields:

- `cache_read_input_tokens` is the cached prompt being **re-served** each
  turn. On a 1M-context session a single re-read is 500K+ already-paid-for
  tokens — counting it inflated dailies 50–100×.
- `cache_creation_input_tokens` is Claude Code writing its tools schema
  + system prompt **to cache once per new session** (~hundreds of K tokens
  of fixed overhead per session). Treating that as "work" makes session
  count drive the chart instead of actual usage.

`input + output` matches the convention used by the Anthropic dashboard
and the popular `ccusage`-style CLIs, so the number is directly
comparable to other tools the visitor might be using.

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

## Install — recommended (one command)

`ops/setup-sync.sh` wraps the whole flow with interactive prompts.
Idempotent — safe to re-run.

```sh
git clone https://github.com/AntaresYuan/personal_website   # if not already
cd personal_website
./ops/setup-sync.sh
```

It asks for:
1. A **source label** (auto-suggests `claude-<hostname>`; must be unique
   across your devices so they don't collide on Worker KV slots)
2. The **shared bearer secret** (only if not already in your keychain).
   On a fresh device you get this from your other Mac:
   ```sh
   # run on the OTHER mac (where it's already set up):
   security find-generic-password -a "$USER" -s "antares-sync-usage" -w
   ```
   Copy the output, paste it into setup-sync.sh's prompt (input is hidden).

It then writes `~/.config/antares-sync-usage.json`, stores the secret in
keychain, runs a dry-run + first real sync, optionally installs the
hourly LaunchAgent, and prints the Stop-hook snippet for
`~/.claude/settings.json`.

Flags:
- `./ops/setup-sync.sh --rotate-secret` — force re-prompt for the secret
- `./ops/setup-sync.sh --source claude-X` — skip the label prompt

## Install — manual (if you want to see each step)

1. **Config** — copy the example and edit `source` for this machine:

   ```sh
   mkdir -p ~/.config
   cp scripts/sync-usage.config.example.json ~/.config/antares-sync-usage.json
   # edit ~/.config/antares-sync-usage.json → source: "claude-<this-mac>"
   ```

2. **Secret** — store the bearer in the macOS keychain (silent input, no
   plaintext on disk, no terminal history leak):

   ```sh
   read -rs SECRET   # paste, press Enter; input is hidden
   security add-generic-password -U -a "$USER" -s "antares-sync-usage" -w "$SECRET"
   unset SECRET
   ```

3. **Dry-run** to confirm payloads look right (nothing sent):

   ```sh
   node scripts/sync-usage.js --dry-run
   ```

4. **First real sync**:

   ```sh
   node scripts/sync-usage.js --verbose
   ```

5. **LaunchAgent** (hourly, runs in background):

   ```sh
   ./ops/launchagent/install.sh           # install + bootstrap + first run
   ./ops/launchagent/install.sh status    # current state + last 20 log lines
   ./ops/launchagent/install.sh remove    # uninstall cleanly
   ```

6. **Stop hook** — paste into `~/.claude/settings.json` (replace path):

   ```json
   {
     "hooks": {
       "Stop": [
         { "matcher": "",
           "hooks": [
             { "type": "command",
               "command": "/ABSOLUTE/PATH/TO/personal_website/ops/claude-hook/sync-usage-on-stop.sh" }
           ]
         }
       ]
     }
   }
   ```

## Adding a second / Nth device

Same `setup-sync.sh` flow as above — the script is idempotent and
designed for repeat use on new machines. The Worker stores per-source
slots in KV; the public GET sums across them. Different `source` labels
mean two devices never overwrite each other's data.

Quick walkthrough for a fresh Mac:

```sh
# 1. Clone the repo
git clone https://github.com/AntaresYuan/personal_website ~/personal_website
cd ~/personal_website

# 2. (If node isn't installed)
brew install node

# 3. Get the shared secret from your already-set-up Mac.
#    On THAT mac, in a terminal:
#      security find-generic-password -a "$USER" -s "antares-sync-usage" -w
#    Copy the printed string. AirDrop / 1Password it over to this mac.

# 4. Run the setup
./ops/setup-sync.sh
# → answer the prompts; paste the secret when asked
# → say yes to LaunchAgent install
```

Within an hour the new device starts contributing to the dashboard total
on `antaresyuan.site/#usage`. No Worker or frontend changes needed.

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
