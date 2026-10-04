#!/usr/bin/env bash
# The toolbar button starts real VOCO capture and inference into a Chromium field,
# inside private X11/Pulse.
runner=test-browser-toolbar-app.mjs
source "$(dirname "${BASH_SOURCE[0]}")/lib/browser-app-sandbox.sh"
