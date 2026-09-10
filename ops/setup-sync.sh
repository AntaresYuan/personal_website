#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# ops/setup-sync.sh — one-shot setup of the AI-usage sync agent on a new
# Mac (or re-run safely on an existing one).
#
# Handles:
#   1. Device slot (canonical hostname; auto-suggests this Mac's hostname)
#   2. Tool detection (Claude Code, Codex — only what's actually present)
#   3. Config file at ~/.config/antares-sync-usage.json
#   4. SHARED_SECRET in macOS keychain (silent input; updates if present)
#   5. Local stats + dry-run, then optional first real sync
#   6. LaunchAgent install (optional)
#   7. Prints the Stop-hook snippet to paste into ~/.claude/settings.json
#
# Idempotent: rerun anytime. Backs up existing config + leaves an existing
# keychain entry alone unless you pass --rotate-secret.
#
# Usage:
#   ./ops/setup-sync.sh
#   ./ops/setup-sync.sh --rotate-secret    # force re-prompt for secret
#   ./ops/setup-sync.sh --source mbp       # skip the device-label prompt
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Guards ────────────────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
  echo "setup-sync: macOS only (uses keychain + launchctl)." >&2
  echo "            For Linux see docs/usage-sync.md → 'Platform' note." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$HOME/.config/antares-sync-usage.json"
EXAMPLE="$REPO_ROOT/scripts/sync-usage.config.example.json"
SYNC_JS="$REPO_ROOT/scripts/sync-usage.js"
LA_INSTALLER="$REPO_ROOT/ops/launchagent/install.sh"
HOOK_SCRIPT="$REPO_ROOT/ops/claude-hook/sync-usage-on-stop.sh"
# The v2 agent splits parsing/aggregation into these libs; a partial clone
# or a stale checkout would otherwise fail deep inside the first run.
SYNC_LIBS=(
  "$REPO_ROOT/scripts/lib/usage-sources.js"
  "$REPO_ROOT/scripts/lib/usage-aggregate.js"
)
CANONICAL_FILE="$HOME/.local/share/antares-usage/canonical-hostname"
ENDPOINT="https://usage.antaresyuan.site"
# $USER is empty under launchd and some CI shells, and `security -a ""` looks
# up the wrong account and silently finds nothing. Same fallback chain the
# agent and refresh-snapshot.sh use, so all three agree on one account.
KC_ACCOUNT="${USER:-${LOGNAME:-$(id -un)}}"

for f in "$EXAMPLE" "$SYNC_JS" "$LA_INSTALLER" "$HOOK_SCRIPT" "${SYNC_LIBS[@]}"; do
  [[ -f "$f" ]] || { echo "setup-sync: missing $f — clone the repo first?" >&2; exit 1; }
done
command -v node >/dev/null || { echo "setup-sync: need node (try 'brew install node')" >&2; exit 1; }

# ── Parse flags ───────────────────────────────────────────────────
ROTATE_SECRET=0
SOURCE_FROM_FLAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rotate-secret) ROTATE_SECRET=1; shift ;;
    --source)        SOURCE_FROM_FLAG="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,/^# ──/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "setup-sync: unknown arg: $1" >&2; exit 2 ;;
  esac
done

echo "── setup-sync — AI-coding usage sync agent on this Mac ──"
echo ""

# ── 1. Device slot ────────────────────────────────────────────────
# The agent resolves its slot from a canonical hostname persisted at
# ~/.local/share/antares-usage/canonical-hostname, so labels can no longer
# silently collide between machines. The value chosen here only SEEDS that
# first resolution — and if a canonical file already exists we reuse it, so
# re-running this script never splits one device's history across two slots.
if [[ -n "$SOURCE_FROM_FLAG" ]]; then
  SOURCE="$SOURCE_FROM_FLAG"
elif [[ -f "$CANONICAL_FILE" ]]; then
  SOURCE="$(tr -d '[:space:]' < "$CANONICAL_FILE" || true)"
  echo "This device already owns a slot: ${SOURCE:-(empty)}"
  echo "  (from $CANONICAL_FILE — reusing it so history stays on one slot)"
fi

if [[ -z "${SOURCE:-}" ]]; then
  hostname_short="$(hostname -s 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9._-' || true)"
  [[ -z "$hostname_short" ]] && hostname_short="thismac"
  echo "Device label for this Mac (default: $hostname_short)"
  echo "  Pinned on first run, then reused. Override later with ANTARES_USAGE_HOSTNAME."
  read -rp "> " source_input
  SOURCE="${source_input:-$hostname_short}"
fi

if ! [[ "$SOURCE" =~ ^[a-z0-9._\-]+$ ]] || [[ ${#SOURCE} -gt 32 ]]; then
  echo "setup-sync: source must match [a-z0-9._-]+ and be ≤ 32 chars (got: '$SOURCE')" >&2
  exit 1
fi
echo "  → device slot = $SOURCE"
echo ""

# ── 2. Detect which AI tools are present ──────────────────────────
# Scanning is opt-in per tool: only directories that exist get written into
# the config. Detecting here (rather than hardcoding Claude, as v1 did) is
# what lets a fresh install pick up Codex without hand-editing afterwards.
SRC_LINES=()
found_any=0

add_source() {   # $1 = source name, $2 = path (~ ok), $3 = human label
  local expanded="${2/#\~/$HOME}"
  if [[ -d "$expanded" ]]; then
    SRC_LINES+=("    \"$1\": \"$2\"")
    echo "  ✓ $3"
    found_any=1
  else
    echo "  – $3 not present (skipped)"
  fi
}

echo "Detecting local AI-coding tools:"
add_source claude '~/.claude/projects' 'Claude Code'
add_source codex  '~/.codex/sessions'  'Codex'
echo ""

if [[ $found_any -eq 0 ]]; then
  echo "setup-sync: no supported transcript directories found." >&2
  echo "  Run a Claude Code or Codex session first, then re-run this script." >&2
  exit 1
fi

# ── 3. Config file ────────────────────────────────────────────────
mkdir -p "$(dirname "$CONFIG")"
if [[ -f "$CONFIG" ]]; then
  backup="$CONFIG.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$CONFIG" "$backup"
  echo "Existing config found — backed up to $backup"
fi

# Join the detected sources with trailing commas on all but the last line.
sources_block=""
for i in "${!SRC_LINES[@]}"; do
  if [[ $i -lt $(( ${#SRC_LINES[@]} - 1 )) ]]; then
    sources_block+="${SRC_LINES[$i]},"$'\n'
  else
    sources_block+="${SRC_LINES[$i]}"
  fi
done

cat > "$CONFIG" <<EOF
{
  "endpoint": "$ENDPOINT",
  "source": "$SOURCE",
  "sources": {
$sources_block
  },
  "sendModelBreakdown": true,
  "sendProjectBreakdown": true
}
EOF

# Fail loudly here rather than letting the agent trip over broken JSON on
# every hourly LaunchAgent tick.
if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$CONFIG" 2>/dev/null; then
  echo "setup-sync: generated config is not valid JSON — aborting" >&2
  cat "$CONFIG" >&2
  exit 1
fi
echo "Wrote $CONFIG"
echo ""
echo "  Note: sendModelBreakdown / sendProjectBreakdown upload those maps to"
echo "  the Worker, which keeps them SERVER-SIDE. What the public page shows"
echo "  is controlled separately by the Worker's USAGE_PUBLISH var."
echo ""

# ── 4. Secret in keychain ─────────────────────────────────────────
has_secret=0
if security find-generic-password -a "$KC_ACCOUNT" -s "antares-sync-usage" -w >/dev/null 2>&1; then
  has_secret=1
fi

if [[ $has_secret -eq 1 ]] && [[ $ROTATE_SECRET -eq 0 ]]; then
  echo "Secret already in keychain — keeping it (pass --rotate-secret to replace)"
else
  echo "Need the shared bearer secret."
  echo ""
  echo "To read it from your OTHER Mac (the one already set up), run on THAT Mac:"
  echo "  security find-generic-password -a \"\$USER\" -s \"antares-sync-usage\" -w"
  echo ""
  echo "Paste it below (input is hidden; press enter when done):"
  read -rs SECRET
  echo ""
  if [[ -z "$SECRET" ]]; then echo "setup-sync: empty secret — aborting" >&2; exit 1; fi

  # Verify BEFORE storing. A mistyped secret used to be accepted here and
  # then failed 401 on every LaunchAgent tick from then on — into a log file
  # nobody reads, so the only symptom was "the numbers stopped moving".
  # GET /detail takes the same bearer and writes nothing, so it's the safe
  # way to ask "is this key real?" without putting junk in KV.
  echo -n "Checking the secret against $ENDPOINT ... "
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
            -H "authorization: Bearer $SECRET" "$ENDPOINT/detail?days=1" || echo "000")"
  case "$code" in
    200)
      echo "ok" ;;
    401)
      echo "REJECTED (401)"
      echo "setup-sync: that secret is not the one the Worker expects — nothing was stored." >&2
      echo "            Re-read it on the working Mac; note it's the SYNC bearer," >&2
      echo "            not a Cloudflare API token." >&2
      unset SECRET
      exit 1 ;;
    000)
      # Offline / DNS / timeout: refusing to store would strand someone
      # setting up on a plane, so keep it but be explicit that it's unproven.
      echo "could not reach the endpoint"
      echo "  Storing it unverified — run 'node scripts/sync-usage.js --doctor' once you're online." ;;
    *)
      echo "unexpected HTTP $code"
      echo "  Storing it unverified — the endpoint answered, but not with 200/401." ;;
  esac

  security add-generic-password -U -a "$KC_ACCOUNT" -s "antares-sync-usage" -w "$SECRET" 2>/dev/null
  unset SECRET
  echo "Stored in keychain (account=$KC_ACCOUNT, service=antares-sync-usage)"
fi
echo ""

# ── 5. Local stats, then dry-run ──────────────────────────────────
# --stats touches no network at all: it's the safest way to confirm the
# parsers actually found your transcripts before anything is uploaded.
echo "Local scan (nothing leaves this machine):"
echo "─────────────────────────────────────────────────────"
node "$SYNC_JS" --stats
echo "─────────────────────────────────────────────────────"
echo ""

echo "Dry-run (no POSTs yet) — printing what would be sent:"
echo "─────────────────────────────────────────────────────"
node "$SYNC_JS" --dry-run
echo "─────────────────────────────────────────────────────"
echo ""
echo "IMPORTANT: the Worker must already be running the v2 code, or these"
echo "payloads get rejected with 400 (the v1 Worker doesn't know the new"
echo "fields). Deploy the Worker first, then sync."
echo ""

read -rp "Run a real sync now (Y/n)? " confirm
if [[ ! "${confirm:-Y}" =~ ^[Nn]$ ]]; then
  node "$SYNC_JS" --verbose
  echo ""
fi

# ── 6. LaunchAgent ────────────────────────────────────────────────
read -rp "Install the hourly LaunchAgent now (Y/n)? " confirm
if [[ ! "${confirm:-Y}" =~ ^[Nn]$ ]]; then
  "$LA_INSTALLER" install
  echo ""
fi

# ── 7. Stop-hook snippet ──────────────────────────────────────────
cat <<EOF

✓ Setup complete.

Device slot: $SOURCE
  pinned at $CANONICAL_FILE

For per-session freshness (the dashboard refreshes within seconds of you
finishing a Claude Code chat), add this to ~/.claude/settings.json:

  {
    "hooks": {
      "Stop": [
        {
          "matcher": "",
          "hooks": [
            {
              "type": "command",
              "command": "$HOOK_SCRIPT"
            }
          ]
        }
      ]
    }
  }

Verify:
  node scripts/sync-usage.js --stats     # local breakdown, no network
  ./ops/launchagent/install.sh status    # see launchd state + last log
  tail -f ~/Library/Logs/antares-sync-usage.log

Visit https://antaresyuan.site/#usage to see this device's contribution
merged into the public dashboard.
EOF
