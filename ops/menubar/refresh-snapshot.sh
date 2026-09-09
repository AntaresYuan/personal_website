#!/bin/bash
# Refresh the local usage snapshot that the usagebar menu bar app reads.
#
# Run from a LaunchAgent, so it cannot rely on an interactive shell's PATH:
# launchd gives a job a minimal environment, and `node` is not in it.
#
# Resolving node here rather than hardcoding a path into the plist, because
# the only node on this machine is under ~/.nvm/versions/node/<version>/,
# and that path changes every time nvm installs a new release — a plist
# pointing at v20.14.0 would silently stop working after an upgrade. The
# sandbox runtime's node is deliberately NOT used: it lives in a content-
# addressed directory that is not stable across sessions.
set -uo pipefail

# Repo root, derived from this script's own location (ops/menubar/ → ../..)
# rather than hardcoded: the previous absolute path only worked on the machine
# it was written on, and this file is committed. An explicit override still
# wins, for the copy installed under ~/.local/libexec.
REPO="${ANTARES_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

find_node() {
  # Explicit override wins.
  if [ -n "${ANTARES_NODE:-}" ] && [ -x "${ANTARES_NODE}" ]; then
    echo "${ANTARES_NODE}"; return 0
  fi
  # Common system locations.
  for p in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$p" ] && { echo "$p"; return 0; }
  done
  # Highest nvm version, sorted so v20 beats v9 (version sort, not lexical).
  local nvm
  nvm=$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)
  [ -n "$nvm" ] && [ -x "$nvm" ] && { echo "$nvm"; return 0; }
  return 1
}

NODE=$(find_node) || {
  echo "$(date '+%Y-%m-%dT%H:%M:%S') no usable node found" >&2
  exit 1
}

cd "$REPO" || { echo "repo not found: $REPO" >&2; exit 1; }

# --window=90 so the snapshot carries enough history for the popover's
# sparkline and all-time figures, not just the 14-day upload window.
# Space-separated form, matching how ops/preview.js invokes the same
# agent. The `=` spelling was silently ignored by the arg parser until
# that was fixed, which quietly capped this job at the 14-day default
# and cost 36 of 41 days in the snapshot.
#
# No --local-only: this job both refreshes the snapshot AND uploads.
# It ran local-only for a while, which meant the public site silently
# froze at whatever the previous machine had last pushed -- 81 days
# stale, showing 124M tokens while this machine was at 1.01B. Nothing
# failed; the numbers were simply old, which is the hard kind to notice.
#
# Uploading needs the bearer, and a machine that has none must still be
# able to keep its own snapshot current. So fall back to --local-only
# rather than exiting: a laptop without the secret should degrade to
# read-only, not stop feeding the menu bar.
# launchd hands a job a minimal environment: $USER is NOT set, and `set -u`
# turns that into a fatal "unbound variable" — the job would die every 30
# minutes without ever reaching either branch. Derive the account name from
# the environment instead, matching what sync-usage.js itself looks up.
KC_ACCOUNT="${USER:-${LOGNAME:-$(id -un)}}"
if security find-generic-password -a "$KC_ACCOUNT" -s "antares-sync-usage" -w >/dev/null 2>&1; then
  exec "$NODE" scripts/sync-usage.js --window 90
fi
echo "$(date '+%Y-%m-%dT%H:%M:%S') no upload secret; snapshot only" >&2
exec "$NODE" scripts/sync-usage.js --local-only --window 90
