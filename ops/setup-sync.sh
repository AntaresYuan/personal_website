#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# ops/setup-sync.sh — one-shot setup of the Claude-usage sync agent
# on a new Mac (or re-run safely on an existing one).
#
# Handles:
#   1. Source label (auto-suggests "claude-<hostname>")
#   2. Config file at ~/.config/antares-sync-usage.json
#   3. SHARED_SECRET in macOS keychain (silent input; updates if present)
#   4. Dry-run + first real sync
#   5. LaunchAgent install (optional)
#   6. Prints the Stop-hook snippet to paste into ~/.claude/settings.json
#
# Idempotent: rerun anytime. Backs up existing config + leaves an existing
# keychain entry alone unless you pass --rotate-secret.
#
# Usage:
#   ./ops/setup-sync.sh
#   ./ops/setup-sync.sh --rotate-secret    # force re-prompt for secret
#   ./ops/setup-sync.sh --source claude-X  # skip the source-label prompt
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

for f in "$EXAMPLE" "$SYNC_JS" "$LA_INSTALLER" "$HOOK_SCRIPT"; do
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

echo "── setup-sync — Claude usage sync agent on this Mac ──"
echo ""

# ── 1. Source label ───────────────────────────────────────────────
if [[ -n "$SOURCE_FROM_FLAG" ]]; then
  SOURCE="$SOURCE_FROM_FLAG"
else
  hostname_short="$(hostname -s 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9._-' || true)"
  [[ -z "$hostname_short" ]] && hostname_short="thismac"
  default_source="claude-${hostname_short}"
  echo "Source label for this device (default: $default_source)"
  echo "  must be unique across all your devices — they collide if not."
  read -rp "> " source_input
  SOURCE="${source_input:-$default_source}"
fi

if ! [[ "$SOURCE" =~ ^[a-z0-9._\-]+$ ]] || [[ ${#SOURCE} -gt 32 ]]; then
  echo "setup-sync: source must match [a-z0-9._-]+ and be ≤ 32 chars (got: '$SOURCE')" >&2
  exit 1
fi
echo "  → source = $SOURCE"
echo ""

# ── 2. Config file ────────────────────────────────────────────────
mkdir -p "$(dirname "$CONFIG")"
if [[ -f "$CONFIG" ]]; then
  backup="$CONFIG.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$CONFIG" "$backup"
  echo "Existing config found — backed up to $backup"
fi
cat > "$CONFIG" <<EOF
{
  "endpoint": "https://usage.antaresyuan.site",
  "source": "$SOURCE",
  "claudeProjectsDir": "~/.claude/projects"
}
EOF
echo "Wrote $CONFIG"
echo ""

# ── 3. Secret in keychain ─────────────────────────────────────────
has_secret=0
if security find-generic-password -a "$USER" -s "antares-sync-usage" -w >/dev/null 2>&1; then
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
  security add-generic-password -U -a "$USER" -s "antares-sync-usage" -w "$SECRET" 2>/dev/null
  unset SECRET
  echo "Stored in keychain (account=\$USER, service=antares-sync-usage)"
fi
echo ""

# ── 4. Dry-run ────────────────────────────────────────────────────
echo "Dry-run (no POSTs yet) — printing what would be sent:"
echo "─────────────────────────────────────────────────────"
node "$SYNC_JS" --dry-run
echo "─────────────────────────────────────────────────────"
echo ""

read -rp "Run a real sync now (Y/n)? " confirm
if [[ ! "${confirm:-Y}" =~ ^[Nn]$ ]]; then
  node "$SYNC_JS" --verbose
  echo ""
fi

# ── 5. LaunchAgent ────────────────────────────────────────────────
read -rp "Install the hourly LaunchAgent now (Y/n)? " confirm
if [[ ! "${confirm:-Y}" =~ ^[Nn]$ ]]; then
  "$LA_INSTALLER" install
  echo ""
fi

# ── 6. Stop-hook snippet ──────────────────────────────────────────
cat <<EOF

✓ Setup complete.

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
  ./ops/launchagent/install.sh status    # see launchd state + last log
  tail -f ~/Library/Logs/antares-sync-usage.log

Visit https://antaresyuan.site/#usage to see this device's contribution
merged into the public dashboard.
EOF
