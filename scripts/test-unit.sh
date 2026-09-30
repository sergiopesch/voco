#!/usr/bin/env bash
# `npm test`: fast checks that need no microphone, speech model or desktop
# session. CI runs the renderer, desktop and speech-model suites as separate
# steps.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PYTHONDONTWRITEBYTECODE=1

# Source provenance: one speech engine, and patched crates that match upstream.
python3 scripts/verify-speech-engine.py
python3 scripts/verify-tray-backport.py
python3 scripts/verify-shortcut-backport.py

# Speech reports, the package assembler and the speech runtime.
npm run test:dictation-quality
npm run test:dictation-quality-events
npm run test:speech-report
npm run test:speech-package
npm run test:speech-runtime
python3 scripts/test-report-performance.py

# Capture and desktop integration.
python3 scripts/test-panel-setup.py
node --test scripts/audio-worklet-capture.test.mjs
npm run test:native-capture-audit
npm run test:ibus
python3 scripts/test-native-kde-identity.py
python3 scripts/test-speech-worker.py

# Dictation scoring and evaluation tools.
node --test scripts/comparative-dictation.test.mjs
python3 scripts/test-audio-continuity.py
node scripts/speech-score.test.mjs
node --test scripts/speech-integrity.test.mjs
node scripts/speech-continuity.test.mjs
node --test scripts/browser-long-accuracy.test.mjs scripts/browser-capture-lifecycle.test.mjs
npm run test:dictation-evaluation

# The desktop app's Vitest suite.
npm run test --workspaces --if-present
