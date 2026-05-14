#!/usr/bin/env bash
# Claude Code Stop hook — fire a sync after a session ends so the Worker
# (and the public /usage heatmap) reflects the freshest data within seconds.
#
# Wired in ~/.claude/settings.json:
#
#   {
#     "hooks": {
#       "Stop": [
#         {
#           "matcher": "",
#           "hooks": [
#             { "type": "command",
#               "command": "/ABSOLUTE/PATH/TO/personal_website/ops/claude-hook/sync-usage-on-stop.sh" }
#           ]
#         }
#       ]
#     }
#   }
#
# The hook backgrounds the sync (`&` + `disown`) so it never blocks the
# end-of-session UI. Stdout/stderr go to the same log as the LaunchAgent,
# so `tail -f ~/Library/Logs/antares-sync-usage.log` covers both.

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/sync-usage.js"
LOG="$HOME/Library/Logs/antares-sync-usage.log"

if [[ ! -f "$SCRIPT" ]]; then
  echo "sync-usage-on-stop: missing $SCRIPT" >&2
  exit 0   # don't fail the session-end if the script is gone
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "sync-usage-on-stop: no node on PATH — skipping" >&2
  exit 0
fi

mkdir -p "$(dirname "$LOG")"
nohup "$NODE_BIN" "$SCRIPT" >> "$LOG" 2>&1 &
disown
exit 0
