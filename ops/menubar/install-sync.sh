#!/bin/bash
# Install the local snapshot refresher as a LaunchAgent.
#
# This is the piece that makes the menu bar behave like kaboo's: a periodic
# local scan keeps a snapshot fresh on disk, so the menu bar shows current
# numbers whether or not anything has been published, and whether or not
# the machine is online.
#
# It uploads NOTHING. The agent runs with --local-only, which needs no
# bearer token. Publishing stays a separate, explicit decision.
set -euo pipefail

LABEL="com.antaresyuan.sync-usage"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/refresh-snapshot.sh"
# Install a copy outside the repo and run THAT.
#
# launchd refused to exec the script in place with "Operation not permitted"
# (exit 126) because this repo lives under ~/Downloads, which macOS guards:
# an interactive shell inherits the user's TCC grant, a launchd job does
# not. ~/.local/libexec carries no such restriction.
LIBEXEC="$HOME/.local/libexec"
SCRIPT="$LIBEXEC/antares-refresh-snapshot.sh"
LOG="$HOME/Library/Logs/antares-sync-usage.log"

[ -f "$SRC" ] || { echo "missing: $SRC" >&2; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")" "$LIBEXEC"
# Bake this repo's path into the installed copy.
#
# refresh-snapshot.sh derives REPO from its own location so the committed
# version works on any checkout. That derivation CANNOT survive the copy: the
# installed file sits in ~/.local/libexec, whose ../.. is ~/.local, not a repo.
# So export the resolved path via ANTARES_REPO, which the script prefers over
# its own derivation. Without this the LaunchAgent would cd into ~/.local and
# exit 1 — and it would do so silently, in a log nobody reads.
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
cp "$SRC" "$SCRIPT"
chmod +x "$SCRIPT"

# Unload an existing job first; launchctl load on an already-loaded label
# reports a confusing "Input/output error" rather than replacing it.
launchctl unload "$PLIST" 2>/dev/null || true

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$SCRIPT</string>
  </array>
  <!-- The installed copy lives outside the repo and cannot work out where the
       repo is, so hand it the path resolved at install time. -->
  <key>EnvironmentVariables</key>
  <dict>
    <key>ANTARES_REPO</key><string>$REPO_ROOT</string>
  </dict>
  <!-- Every 30 minutes. The menu bar refreshes itself every 15, so the
       snapshot is at most one menu-bar cycle behind the transcripts. -->
  <key>StartInterval</key><integer>1800</integer>
  <!-- Also run once at login so a machine that was asleep is current. -->
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <!-- Low priority: this is a background scan, never worth competing with
       foreground work for CPU or disk. -->
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>5</integer>
</dict>
</plist>
PLIST_EOF

launchctl load "$PLIST"

# launchctl load returns before the job is necessarily registered, so poll
# rather than asserting immediately.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if launchctl list | grep -q "$LABEL"; then
    echo "✓ installed: $LABEL (every 30 min, + at login)"
    echo "  script: $SCRIPT"
    echo "  log:    $LOG"
    exit 0
  fi
  sleep 0.5
done

echo "✗ loaded but not visible in launchctl list — check $LOG" >&2
exit 1
