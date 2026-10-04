#!/usr/bin/env bash
# Full Chromium recipient + real VOCO capture/inference, inside private X11/Pulse.
runner=test-browser-full-app.mjs
source "$(dirname "${BASH_SOURCE[0]}")/lib/browser-app-sandbox.sh"
