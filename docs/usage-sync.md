# `/usage` — local sync agent install

The agent reads local AI-coding transcripts (Claude Code, Codex, …),
aggregates daily totals (five token categories + sessions + active time
+ cost-in-cents), and POSTs the trailing window to the
`usage.antaresyuan.site` Worker so the public `/usage` heatmap stays
current. Multi-device by design: each machine owns a stable slot on the
Worker side, so several Macs aggregate cleanly without overwriting each
other.

See `workers/usage/README.md` for the Worker side + privacy contract.

> **Platform**: the LaunchAgent installer (`ops/launchagent/install.sh`)
> and the keychain integration are macOS-only. On Linux, run
> `node scripts/sync-usage.js` from a systemd timer or cron job, and
> either store the bearer in your platform's secret manager (e.g. `pass`,
> `secret-tool`) or paste it into the optional `secret` field of the
> config — there's no Linux equivalent of the keychain fallback wired up
> in v1.

## What the agent reads

Each supported tool is a parser in `scripts/lib/usage-sources.js`. Adding
a tool means adding one row to `SOURCE_DEFS` — the aggregation, dedup,
cost and upload paths are shared.

| source | transcripts | notes |
|---|---|---|
| `claude` | `~/.claude/projects/<slug>/<session-uuid>.jsonl` | `type:"assistant"` events carry `message.usage` |
| `codex` | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `event_msg` / `token_count` carries cumulative usage |

By default every source whose directory exists is scanned. Restrict or
re-point them with the `sources` block in the config.

### The five token categories

The agent keeps these **distinct and non-overlapping**, and only collapses
them at display time:

| field | meaning |
|---|---|
| `inputTokens` | fresh prompt tokens |
| `outputTokens` | generated tokens |
| `cachedInputTokens` | cache reads — the prompt prefix re-served each turn |
| `cacheCreationInputTokens` | cache writes (Anthropic only; 5m + 1h tiers) |
| `reasoningOutputTokens` | thinking tokens (Codex / o-series) |

**Why store all five** — v1 shipped a single `tokens = input + output`
scalar and dropped the rest at collection time, which is irreversible:
the cache ratio could never be recovered afterwards. On real data from
this machine, `input + output` turns out to be **0.3% of Claude's actual
token traffic** (97% of it is cache reads), so the old number described
almost nothing. Store wide, render narrow.

Cross-tool normalization matters here. Anthropic reports cache reads as a
*separate additive* category; Codex counts `cached_input_tokens` **inside**
`input_tokens` and `reasoning_output_tokens` **inside** `output_tokens`
(verified against 4,066 real `token_count` events: `total == input + output`
in 99.5% of them). The Codex parser subtracts both subsets so the five
counters mean the same thing for every tool and a cross-tool total isn't a
double-count.

`tokens` is still sent and still means `input + output`, so the public
number stays on the same scale it has always been on.

### Cost computation

`MODEL_PRICING` in `scripts/lib/usage-aggregate.js` holds per-model rates
for all five categories — input, output, 5-minute cache write, 1-hour
cache write, cache read — because they bill at different multiples. The
agent reads each event's model id locally to pick the row; the **model id
never leaves the device** unless you opt into the `byModel` dimension.

Run `node scripts/sync-usage.js --stats` to see the local breakdown. Any
model id that isn't in the table is listed under **⚠ unpriced models** so a
newly-shipped family shows up as something to add rather than silently
skewing the total at default rates.

## Multi-device: canonical hostname

The device slot is resolved **once** and then persisted:

```
ANTARES_USAGE_HOSTNAME env var        (highest priority, always wins)
  ↓
~/.local/share/antares-usage/canonical-hostname   (written on first run)
  ↓
config.source  (legacy v1 field — seeds the first resolution)
  ↓
os.hostname()
```

This is ported from kaboo's CLI and fixes the v1 footgun: v1 asked you to
invent a unique label per machine, and two Macs both named "Mac" silently
overwrote each other's KV slot. Now the identity is pinned on first run,
so a machine keeps ONE slot even if its runtime hostname later changes
(VMs, DHCP renames, CI).

Check which slot a machine owns:

```sh
cat ~/.local/share/antares-usage/canonical-hostname
```

To rename a device, edit that file (or set `ANTARES_USAGE_HOSTNAME`) and
re-run. The old slot's value freezes; zero it out by POSTing
`{date, source: OLD, tokens: 0, sessions: 0}` for each day in the window.

## What the agent sends

Exactly one POST per non-empty day in the trailing window:

```
POST https://usage.antaresyuan.site/
Authorization: Bearer <SHARED_SECRET>
Content-Type: application/json

{
  "date": "2026-08-31", "source": "mbp",
  "tokens": 20678, "sessions": 4, "costCents": 366,
  "inputTokens": 4, "outputTokens": 20674,
  "cachedInputTokens": 1756812, "cacheCreationInputTokens": 845768,
  "reasoningOutputTokens": 0, "totalTokens": 3469026,
  "activeSeconds": 5400, "durationSeconds": 7200,
  "messageCount": 120, "userMessageCount": 40,
  "promptHours": [0,0,…,12,…],          // 24 ints: prompts per LOCAL hour
  "promptWeekHours": [0,0,…,5,…],       // 168 ints: weekday*24 + hour
  "tzOffsetMinutes": 480,               // the offset those hours are in
  "bySource": { "claude": { ... } },
  "byModel":  { "claude-sonnet-5": { ... } },
  "byProject":{ "kaboo": { ... } }
}
```

The shape is a hardcoded allowlist in `buildPayload()`. The Worker
re-validates server-side; any extra key → 400. Two layers of defense, one
privacy contract.

### Why the hour vectors are local, not UTC

`promptHours` / `promptWeekHours` are counted in the **device's local time**,
and the offset travels with them. The normalisation has to happen at
collection, because nothing downstream can know which timezone a machine was
in when a past session ran.

It matters more than it sounds. On this UTC+8 machine the same 3,991 prompts
read as:

| stored as | shape | plausible? |
|---|---|---|
| UTC | starts 03:00, peaks 08:00 | no — nobody starts at 3am |
| local (UTC+8) | 11:00–23:00, peaks Tue 17:00 | yes |

Vectors from two devices sum element-wise. Two machines in different zones
produce a blended shape, which is the honest answer to "when was this person
working" across machines.

Privacy: they're **counts, not timestamps** — a tally per bucket, with no way
to locate an individual session in time. Opt out with
`sendHourBreakdown: false`.

Privacy controls on **this** side:

- `sendModelBreakdown: false` — never upload `byModel`
- `sendProjectBreakdown: false` — never upload `byProject`
- `sendHourBreakdown: false` — never upload the hour vectors
- project names are reduced to the directory **leaf** (`kaboo`, not
  `/Users/you/clients/acme/kaboo`) before they can be uploaded at all
- session ids are SHA-256 hashed; the metric is "how many sessions", never
  "which session"
- no message content, no file paths, no absolute directories

## Who can see what

Three tiers, controlled independently:

| tier | how it's controlled | sees |
|---|---|---|
| public `GET /` | Worker's `USAGE_PUBLISH` var | summary + whatever you publish |
| authed `GET /detail` | bearer secret | everything in KV |
| local | `--stats` | everything, never leaves the machine |

Collection and publication are **decoupled on purpose**: the agent uploads
detail, the Worker stores it, and `USAGE_PUBLISH` decides what the public
page may render. Nothing extra is public by default. Flipping a dimension
on is a Worker config edit + redeploy — no re-collection, no site rebuild
(the frontend is data-driven and renders whatever arrives).

```sh
# publish the real total, the cache ratio and which tool did the work,
# but keep model ids and project names private:
#   workers/usage/wrangler.toml → [vars]
#   USAGE_PUBLISH = '{"fields":["totalTokens","cachedInputTokens"],"dims":["bySource"]}'
npx wrangler deploy --config workers/usage/wrangler.toml

# read everything, including the unpublished dimensions:
curl -s -H "Authorization: Bearer $(security find-generic-password -a "$USER" -s antares-sync-usage -w)" \
  'https://usage.antaresyuan.site/detail?days=7' | jq '.days[-1]'
```

Valid `fields`: `inputTokens`, `outputTokens`, `cachedInputTokens`,
`cacheCreationInputTokens`, `reasoningOutputTokens`, `totalTokens`,
`activeSeconds`, `durationSeconds`, `messageCount`, `userMessageCount`.
Valid `dims`: `bySource`, `byModel`, `byProject`, plus the hour vectors
`promptHours` and `promptWeekHours` (they ride the same `dims` allowlist, so
there's one place to audit). Unknown names are ignored, and malformed JSON
falls back to private-by-default rather than over-sharing.

## What the charts show

Two surfaces, same data, different depth.

**Homepage `#usage`** — three lenses, one at a time, switched by the tab row.
A view only appears when the Worker actually publishes what it needs, so a
deployment that publishes nothing extra shows no tabs at all:

| view | needs | answers |
|---|---|---|
| `calendar` | nothing (v1 default) | how often |
| `rhythm` | `dims: ["promptWeekHours"]` | when — 7×24 weekday × local hour |
| `trend` | ≥2 weeks of history | which direction |

**`/usage/`** — every chart at once, built by `scripts/build-usage-page.js`
and drawn by `scripts/usage-page.js`: calendar, rhythm, weekly trend with a
4-week mean, token mix, hour-of-day, day-of-week, by-tool, by-model,
by-project, and session shape. Each card hides itself when its data isn't
published, so the page never shows an empty frame.

Two deliberate choices about honesty in those captions:

- **The in-progress week is excluded** from the "last 4 full weeks" delta. On
  a Monday the newest week is one day long; including it made a normal week
  read as `-77%`.
- **"active days since <date>"** counts from the first day with real
  activity, not from the start of the 365-day window — the Worker returns a
  dense zero-padded range, so the window start is just "a year ago".

The rhythm chart is the one worth publishing first: it's the only view that
reads as a portrait of how someone works rather than a usage total. kaboo's
own dashboard leads with the same shape for that reason.

### Owner view on /usage/

`/usage/` has an **Owner view** box that takes the bearer token and reloads
from `/detail`, unlocking `byModel` / `byProject` without making them public.
The token is held in that tab's `sessionStorage` only — never written to
disk, never sent anywhere but the usage Worker, and gone when the tab closes.
A stale token falls back to the public feed rather than stranding the page on
an error.

## Preview it locally first

Before touching production, run the whole stack on `127.0.0.1` — no
Cloudflare account, no `wrangler login`, no writes to your real KV or your
real `~/.config`:

```sh
npm run preview            # serve the site + seed from your own transcripts
npm run preview:demo       # synthetic data instead, if you'd rather not
                           # look at your own numbers
```

Then open **http://localhost:8794/#usage** (the port is printed on start;
use `localhost` rather than `127.0.0.1` if your browser is sandboxed).

What it actually runs:

- the **real Worker** (`workers/usage/src/index.js`), imported in-process
  with a `Map`-backed KV binding and a small `caches.default` polyfill. The
  publish projection, bearer check, schema validator and cache
  invalidate-on-write all execute exactly as they will in production — a
  stub would hide precisely the bugs worth catching.
- the **real sync agent**, pointed at the local endpoint through
  `ANTARES_USAGE_CONFIG` / `ANTARES_USAGE_STATE_DIR`, so your committed
  config and your device's canonical hostname are never touched.
- the static site, with `content/site.json`'s `usage.endpoint` rewritten in
  flight. The file on disk is left alone.

Useful flags:

```sh
node ops/preview.js --port 9000
node ops/preview.js --no-seed                                    # start empty
node ops/preview.js --publish '{"fields":["totalTokens"],"dims":[]}'
```

`--publish` overrides `wrangler.toml`'s `USAGE_PUBLISH` for that run, which
is the cheapest way to see what a given public/private split looks like
before you commit to it. Nothing persists — stop with Ctrl-C and the KV
disappears.

To confirm the private side really is private:

```sh
curl -s http://127.0.0.1:8794/api/usage/ | grep -c byModel      # → 0
curl -s -H "authorization: Bearer local-preview-secret" \
     http://127.0.0.1:8794/api/usage/detail | jq '.days[-1].byModel'
```

## Install — recommended (one command)

`ops/setup-sync.sh` wraps the whole flow with interactive prompts.
Idempotent — safe to re-run.

```sh
git clone https://github.com/AntaresYuan/personal_website   # if not already
cd personal_website
./ops/setup-sync.sh
```

It asks for:
1. A **device label** (defaults to this Mac's short hostname; only seeds the
   canonical hostname on first run, and an existing canonical file is reused
   so re-running never splits one device across two slots)
2. The **shared bearer secret** (only if not already in your keychain).
   On a fresh device you get this from your other Mac:
   ```sh
   # run on the OTHER mac (where it's already set up):
   security find-generic-password -a "$USER" -s "antares-sync-usage" -w
   ```
   Copy the output, paste it into setup-sync.sh's prompt (input is hidden).

It **detects which tools are present** on this machine
(`~/.claude/projects`, `~/.codex/sessions`) and writes only those into the
`sources` map — so adding Codex to a machine is picked up by a re-run
rather than a hand edit. If neither exists it stops instead of writing a
config that would silently collect nothing.

It then writes `~/.config/antares-sync-usage.json` (validating the JSON
before it lands), stores the secret in keychain, prints a local `--stats`
breakdown plus a dry-run, optionally does a first real sync, optionally
installs the hourly LaunchAgent, and prints the Stop-hook snippet for
`~/.claude/settings.json`.

> **Deploy the Worker first.** The v2 agent sends fields a v1 Worker
> rejects, so a sync against an un-upgraded Worker fails every POST with
> `400`. Order: deploy Worker → run the agent.

Flags:
- `./ops/setup-sync.sh --rotate-secret` — force re-prompt for the secret
- `./ops/setup-sync.sh --source mbp` — skip the label prompt

## Install — manual (if you want to see each step)

1. **Config** — copy the example and edit it for this machine:

   ```sh
   mkdir -p ~/.config
   cp scripts/sync-usage.config.example.json ~/.config/antares-sync-usage.json
   # the `sources` block controls which tools are scanned;
   # omit it entirely to auto-discover every supported tool
   ```

2. **Secret** — store the bearer in the macOS keychain (silent input, no
   plaintext on disk, no terminal history leak):

   ```sh
   read -rs SECRET   # paste, press Enter; input is hidden
   security add-generic-password -U -a "$USER" -s "antares-sync-usage" -w "$SECRET"
   unset SECRET
   ```

3. **Inspect locally first** — no network at all:

   ```sh
   node scripts/sync-usage.js --stats
   ```

4. **Dry-run** to confirm payloads look right (nothing sent):

   ```sh
   node scripts/sync-usage.js --dry-run
   ```

5. **First real sync**:

   ```sh
   node scripts/sync-usage.js --verbose
   ```

6. **LaunchAgent** (hourly, runs in background):

   ```sh
   ./ops/launchagent/install.sh           # install + bootstrap + first run
   ./ops/launchagent/install.sh status    # current state + last 20 log lines
   ./ops/launchagent/install.sh remove    # uninstall cleanly
   ```

7. **Stop hook** — paste into `~/.claude/settings.json` (replace path):

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
slots in KV; the public GET sums across them. Canonical hostnames mean two
devices never overwrite each other's data.

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
# the full public GET response (365 days, summed across sources)
curl -s -H 'origin: https://antaresyuan.site' https://usage.antaresyuan.site/

# just today's number
curl -s -H 'origin: https://antaresyuan.site' https://usage.antaresyuan.site/ \
  | jq '.days[-1]'

# everything, including unpublished dimensions (needs the bearer)
curl -s -H "Authorization: Bearer <SHARED_SECRET>" \
  'https://usage.antaresyuan.site/detail?days=7' | jq '.days[-1]'
```

## Troubleshooting

| symptom | likely cause |
|---|---|
| `POST <date> FAILED status=401` | secret in keychain doesn't match the Worker's; re-run `wrangler secret put` or update keychain |
| **every POST 401s even with the right secret** | Worker bug fixed in v2: the bearer check compared the regex match array (`m`) instead of the captured group (`m[1]`), so it rejected everything. Redeploy the Worker. |
| `POST <date> FAILED status=400 ... unexpected field` | the agent's allowlist is out of sync with the Worker's; pin the same version of both |
| `400 body too large` | a day with many models/projects exceeded the cap; the Worker allows 64 KiB, and `MAX_DIM_KEYS` caps keys per map |
| LaunchAgent doesn't fire | `./ops/launchagent/install.sh status` — if not loaded, re-install. Check log at `~/Library/Logs/antares-sync-usage.log` |
| Stop hook doesn't fire | confirm the path in `~/.claude/settings.json` is absolute and the script is `chmod +x` |
| `no transcript directories found` | every configured `sources` path is missing; check with `--stats` |
| every day shows 0 | no usage-bearing events in your transcripts — happens on a fresh install before any session has run |
| a model's cost looks wrong | `--stats` lists **⚠ unpriced models**; add them to `MODEL_PRICING` |
| public page shows no cache/total numbers | `USAGE_PUBLISH` doesn't list them — that's the default. Publish them and redeploy. |
| LaunchAgent log says "no secret available" every hour | macOS keychain is locked at LaunchAgent fire time (rare; usually only after a fresh boot before login). Unlock the keychain or move the secret to the `secret` field in the config. |

## Common pitfalls (multi-device)

### Shared `~/.claude/projects/` across devices = real double-counting

If iCloud Drive syncs your `~/.claude` folder, or you restored a Time
Machine backup of one Mac onto another, both devices' sync agents
read the **same** jsonl files. Even with distinct device slots, the
Worker stores both → public total is 2× the same activity.

**Symptom**: two devices' daily totals are suspiciously close —
within minutes of the same `updated` timestamp, and within a few
percent of each other day after day. Independent devices should
naturally diverge.

**Fix**: either un-share `~/.claude` between devices (move out of
iCloud Drive), or install the LaunchAgent on only ONE device.

### Forked sessions look like double usage (handled)

Claude Code forks a session by **copying** the parent's jsonl, so the same
assistant turn exists in two files. The agent dedups on a content
fingerprint (`msg.id` / `requestId` when available, otherwise a hash of
timestamp + model + counters). On this machine that collapses 13,437 raw
events to 11,096 — the 2,341 difference is fork copies. `--verbose` prints
the count, so a sudden jump there means the dedup key stopped matching.

### `setup-sync.sh` keeps the old keychain secret by default

If you previously set up this device, or partially attempted setup,
the keychain may already hold a stale secret. After rotating on the
Worker side (`wrangler secret put SHARED_SECRET`), that stale value
will 401 on every POST. The default flow **keeps the existing secret**
unless you pass `--rotate-secret`:

```sh
./ops/setup-sync.sh --source claude-X --rotate-secret
```

Always use `--rotate-secret` immediately after a Worker-side rotation.

### Inspecting the KV directly

When numbers look wrong, read the raw per-slot map (requires the
wrangler CLI logged into the right account):

```sh
npx wrangler kv key get --binding USAGE_KV --remote "usage:2026-08-31" \
  --config workers/usage/wrangler.toml
```

Output is `{ "mbp": {...}, "imac": {...}, ... }`. Sum across slots = the
public GET total. Slots you don't recognise (orphans from earlier
mislabelled installs) can be zeroed via a small POST script — see the
device-rename note above.

| `install: 'node' resolves under a version manager` | nvm/asdf/fnm/volta shims aren't on launchd's PATH. Install a system Node (`brew install node`) and re-run, or hardcode an absolute path in the installer. |

