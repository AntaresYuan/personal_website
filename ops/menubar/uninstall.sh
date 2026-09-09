#!/usr/bin/env bash
# Remove the usagebar login item and stop the running process.
set -euo pipefail

LABEL="antares.usagebar"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl unload "$PLIST" 2>/dev/null || true
pkill -f "menubar/usagebar" 2>/dev/null || true
rm -f "$PLIST"

if launchctl list 2>/dev/null | grep -q "$LABEL"; then
  echo "✗ still loaded — try: launchctl remove $LABEL" >&2
  exit 1
fi
echo "✓ removed (the built binary is left in place; delete ops/menubar/usagebar to remove it too)"
