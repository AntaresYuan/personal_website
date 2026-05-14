#!/usr/bin/env bash
# Install / uninstall the sync-usage LaunchAgent for the current user.
#
# Usage:
#   ./ops/launchagent/install.sh          # install + load
#   ./ops/launchagent/install.sh remove   # unload + remove
#   ./ops/launchagent/install.sh status   # show launchd state + last log
#
# Idempotent: re-running install replaces the existing plist and bootstraps
# fresh. The script is hourly + RunAtLoad, so bootstrap fires one sync
# immediately.

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "install: this installer is macOS-only (uses launchctl + security)." >&2
  echo "         For Linux, run sync-usage.js from systemd or cron — see docs/usage-sync.md." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/sync-usage.js"
TEMPLATE="$REPO_ROOT/ops/launchagent/com.antaresyuan.sync-usage.plist.template"
HOOK_SCRIPT="$REPO_ROOT/ops/claude-hook/sync-usage-on-stop.sh"

LABEL="com.antaresyuan.sync-usage"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/antares-sync-usage.log"

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "install: can't find 'node' on PATH — install Node 18+ first" >&2
  exit 1
fi

# launchd runs with a minimal env — no nvm/asdf/fnm/volta in PATH. Plists
# that point at a version-manager shim will silently fail every tick.
# Hard-fail here so the user picks a stable system Node instead.
case "$NODE_BIN" in
  *"/.nvm/"*|*"/.asdf/"*|*"/.fnm/"*|*"/.volta/"*|*"/nodenv/"*)
    echo "install: 'node' resolves under a version manager:" >&2
    echo "  $NODE_BIN" >&2
    echo "launchd can't read your shell's PATH, so the agent would 404 hourly." >&2
    echo "Install a system Node (e.g. 'brew install node') and re-run, or" >&2
    echo "edit this script to hardcode a stable absolute path." >&2
    exit 1
    ;;
esac
if [[ ! -f "$SCRIPT" ]]; then
  echo "install: missing $SCRIPT" >&2
  exit 1
fi
if [[ ! -f "$TEMPLATE" ]]; then
  echo "install: missing $TEMPLATE" >&2
  exit 1
fi

cmd="${1:-install}"

case "$cmd" in
  install)
    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
    # Some filesystems / fresh checkouts drop the +x bit. The Stop hook
    # is invoked by Claude Code's type:"command" runner — it must be
    # executable.
    chmod +x "$SCRIPT" "$HOOK_SCRIPT"
    sed \
      -e "s|__NODE__|$NODE_BIN|g" \
      -e "s|__SCRIPT__|$SCRIPT|g" \
      -e "s|__LOG__|$LOG|g" \
      "$TEMPLATE" > "$PLIST"
    # Reload: bootout then bootstrap (idempotent across reinstalls).
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$UID" "$PLIST"
    echo "installed: $PLIST"
    echo "label:     $LABEL"
    echo "node:      $NODE_BIN"
    echo "script:    $SCRIPT"
    echo "log:       $LOG"
    echo "loaded — first sync fires now, then hourly. tail -f the log to watch."
    ;;
  remove|uninstall)
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    if [[ -f "$PLIST" ]]; then
      mv "$PLIST" "/tmp/$LABEL.plist.$(date +%s)"
      echo "removed: $PLIST (moved to /tmp)"
    else
      echo "remove: nothing at $PLIST"
    fi
    ;;
  status)
    echo "label:  $LABEL"
    echo "plist:  $PLIST"
    echo "log:    $LOG"
    echo ""
    launchctl print "gui/$UID/$LABEL" 2>/dev/null | head -30 || echo "(not loaded)"
    echo ""
    if [[ -f "$LOG" ]]; then
      echo "last 20 lines of log:"
      tail -20 "$LOG"
    else
      echo "(log not created yet)"
    fi
    ;;
  *)
    echo "usage: $0 [install|remove|status]" >&2
    exit 2
    ;;
esac
