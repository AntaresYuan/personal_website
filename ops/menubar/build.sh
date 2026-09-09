#!/usr/bin/env bash
# Build the menu bar readout. One Swift file, no package manifest, no Xcode
# project — swiftc ships with the Command Line Tools that any Mac doing
# development already has.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc not found. Install the Xcode Command Line Tools:" >&2
  echo "  xcode-select --install" >&2
  exit 1
fi

echo "building usagebar …"
# -O because this runs for weeks at a time; the compile is 2s either way.
# WebKit for the popover; both sources compile as one module.
swiftc -O -o usagebar usagebar.swift popover.swift main.swift \
  -framework Cocoa -framework WebKit \
  -target "$(uname -m)-apple-macosx13.0"

echo "verifying formatters and parser (no GUI needed) …"
./usagebar --check

echo
echo "built: $(pwd)/usagebar"
echo "run:      ./usagebar"
echo "install:  ./install.sh      (starts at login)"
echo "verify:   ./usagebar --title            # prints what the bar would show"
echo "local:    USAGEBAR_ENDPOINT=http://127.0.0.1:8796/api/usage/ ./usagebar --title"
