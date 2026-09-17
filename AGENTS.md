# VOCO development guide

VOCO is a local English dictation app for Linux. Keep it small, fast and clear.
Read [README](README.md), [the code map](docs/architecture/code-map.md) and
[release status](docs/release-candidate.md) before making changes.

## Product contract

- No account, subscription, telemetry or cloud transcription.
- One normal output path: streaming dictation directly to the cursor.
- No assistant, OpenClaw, realtime conversation, enhancement or appearance settings.
- Preserve the tray-first interface and system accessibility preferences.
- Keep microphone and shortcut configuration; recover interrupted dictation explicitly.
- Clipboard paste replaces clipboard text and never sends Enter. Never blindly
  replay uncertain output or overwrite text after focus changes.

## Architecture

The production path is `runtime/speech/` → Rust `benchmark_stream.rs` →
`benchmarkPhraseQueue.ts` → `insertion.rs`. Despite their historical names,
these are production modules. The selected runtime is NVIDIA Nemotron English
0.6B Q8 CPU. Whisper and Chromium exact-field dictation are separate compatibility
paths with their own checks. Research model adapters are not selectable products.

Rust owns OS integration, files, processes, packaging and validation. React owns
presentation and recording orchestration. Keep both typed and state-driven.
Comment invariants and non-obvious decisions; avoid narrating every line.

Configuration deserialization ignores retired output choices and returns cursor,
stable streaming and enhancement off. Patches reject removed fields. These fixed
snapshot fields remain for the legacy dictation engine contract; they are not
settings. Preserve microphone, shortcut and onboarding state during migration.

glib 0.18.5 is vendored with the exact upstream RUSTSEC-2024-0429 fix. Keep
all GTK/WebKit consumers on that single patched copy. Verify source provenance
and optimized iterator regression before accepting a dependency change; adding
glib 0.20 directly leaves the GTK dependency behind. [Backport](vendor/glib/VOCO-PATCH.md).

## Delivery invariants

- Warm the selected worker before reporting readiness. Imports do not start it.
- Flush Stop audio into the same live stream before finish; do not copy/replay a
  whole recording. Recover a dead worker only at a safe session boundary.
- Keep bounded queues, deadlines, sequence/sample accounting and recovery.
- Legacy ydotool requires a literal space argument, not `space`. Its paste delay
  is 24 ms; modern numeric arguments and terminal gestures have separate contracts.
- X11 shortcut scope belongs to the exact focus window, UUID and renderer epoch
  through final delivery. Keep the 650-second lease and release ownership safely.
- Completed IBus authority and a poll in flight differ. Consuming X11 callbacks
  proceed through debounce; passive evdev retains its duplicate guard.
- IBus protocol 6 is dictation-shortcut-only; older helpers must reconnect after upgrade. Never restore text mutation there.
- Bounded accessible-field observations are not atomic ownership or cursor paint.
- Logs are optional, private and bounded. No dictated text, audio, clipboard values,
  URLs or window titles in performance logs. Reject unsafe log/socket targets.

## Working practices

Inspect first, make a concrete plan, and change only what the task requires.
Preserve unrelated dirty worktrees and frozen evidence. User instructions authorize
product changes; otherwise discuss significant behavior, security, privacy or stack
tradeoffs first. Do not add dependencies without a concrete need.

Keep product docs concise and written for people using VOCO. Release/test history
belongs in scoped records, not the README. Update setup, operation, architecture and
agent guidance whenever behavior changes. Historical tests retain dates and scope.

## Validation

Run focused checks first, then the relevant wider gates:

```bash
npm run verify:versions
npm run check
npm run lint
npm test
npm run test:dictation-renderer
npm run test:microphone-renderer
npm run test:chromium-exact-field
python3 scripts/verify-glib-backport.py
python3 scripts/test-glib-variant.py --output /tmp/voco-glib-check
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
npm run build
```

Use isolated audio, input, clipboard and desktop fixtures. Do not inject test
speech into a live user session. Python worker tests require NumPy and psutil;
protocol tests also require the pinned model/runtime. Record unavailable checks
as unavailable, never passed. Preserve failures and attempted-trial denominators.

Source excludes model weights and compiled runtime payloads. Follow
[runtime provisioning](docs/linux-packaging.md#runtime-provisioning); never replace
missing pinned artifacts with mutable downloads. A base Tauri `.deb` is incomplete:
assemble and verify the NVIDIA payload before calling it installable.

For Crabbox, run `crabbox doctor` first. `local-container` provides local userspace
isolation, not a remote VM or proof of a distribution's default desktop.

## Release and evidence

Current public release: **2026.0.39**, glib iterator safety backport. The `.38` and `.37` cuts
are frozen historical evidence. New product bytes need a new version, fresh checks
and artifact receipts; do not reuse an older result as current qualification.

Pass all CI gates, including Whisper accuracy. No waiver is authorized. Keep a
clean commit, exact package/source hashes, licenses, checksums and release notes.
The hosted Release workflow must not assemble NVIDIA installers. Userspace checks,
native install/remove, physical audio and compositor/application behavior are
distinct evidence levels. Never claim fastest, most accurate, universal
compatibility or stability from a limited test corpus.
