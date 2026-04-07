<!-- markdownlint-disable MD032 MD060 -->
# Testing

## Current State

Automated tests are in place for both frontend and backend.

### Rust (33 tests)

Run with `cargo test` from `apps/desktop/src-tauri/`.

| Module      | Tests | What's Covered                                                                                                              |
| ----------- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| `config`    | 10    | Default values, serialization round-trip, deserialization with defaults, enum casing, cached update state, atomic writes |
| `insertion` | 8     | Strategy parsing, session detection, runtime diagnostics, helper requirements, and command failure handling               |
| `lib`       | 15    | Base64 audio decoding, socket path fallback, socket cleanup, hotkey config, hotkey backend selection, hotkey modes, global-shortcut logic |

### Frontend (23 tests)

Run with `npm test` from project root.

| File                 | Tests | What's Covered                                                                                                        |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `store.test.ts`      | 11    | Store actions: status transitions, error handling, transcript management, audio level, config storage, update state |
| `audioLevel.test.ts` | 3     | DC-offset removal, centered RMS calculation, visual level behavior                                                    |
| `updates.test.ts`    | 9     | Version comparison, channel selection, timeout behavior, update lookup, and update cache helpers                     |

Current manual product coverage is broader than the automated test count. The onboarding flow, tray interactions, global hotkeys, microphone permissions, and compositor-specific insertion behavior still need Linux runtime validation.

## Running Tests

```bash
# All frontend tests
npm test

# All Rust tests
cd apps/desktop/src-tauri && cargo test

# Full validation (what CI runs)
npm run verify:versions
npm run check && npm run lint && npm test
npm --workspace @voco/desktop run build:frontend
desktop-file-validate packaging/flatpak/com.sergiopesch.voco.desktop
appstreamcli validate packaging/flatpak/com.sergiopesch.voco.metainfo.xml
cd apps/desktop/src-tauri && cargo check && cargo clippy -- -D warnings && cargo test

# Snap draft validation when changing snap/
# Requires either root-capable destructive mode or an LXD-backed Snapcraft setup.
cd snap && snapcraft --destructive-mode

# Release rehearsal before tagging
npm run rehearse:release

# Linux runtime preflight for manual end-to-end validation
npm run report:linux-runtime
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and PR to master:
- version consistency verification across the shipped release metadata
- TypeScript check, ESLint, Vitest (frontend)
- Vite production frontend build
- desktop-file and AppStream metadata validation for tracked store assets
- cargo check, cargo clippy (zero warnings), cargo test (Rust)

## Manual Verification

For system-level features that are hard to automate:

- Startup readiness:
  - launch app and confirm the tray icon moves from muted idle to the VOCO ready state after mic init
  - confirm log lines for `Hotkey listener attached` and `Microphone ready`
- Onboarding:
  - confirm the first-run flow shows the VOCO mic mark in the header
  - confirm the welcome step explains the local-first, tray-first workflow clearly
  - confirm microphone check uses the intended input device
  - confirm the level meter stays low at rest and moves through the middle during normal speech
  - confirm the hotkey step explains tray-state feedback clearly
  - confirm the insertion step surfaces the current Linux session and the chosen insertion strategy
- Hotkey behavior:
  - first press should immediately show listening state and the active tray indicator
  - switch hotkey at runtime from settings and tray menu, then verify the new binding triggers dictation immediately
- Trigger via Unix socket:
  `SOCKET_DIR="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}/voco-$(id -u)}"; socat - UNIX-CONNECT:"${SOCKET_DIR}/voco.sock" < /dev/null`
- Insertion behavior:
  - verify direct type simulation in a text editor
  - verify `auto` falls back to clipboard insertion when direct typing fails
  - verify strict `type-simulation` reports a failure instead of touching the clipboard
- Runtime diagnostics:
  - open Settings -> Advanced and confirm the detected session matches the desktop session
  - confirm missing helper commands are surfaced accurately after pressing `Refresh runtime checks`
- Capture environment details:
  - run `npm run report:linux-runtime` and attach the output to the test note

- State the distro, desktop environment, compositor, and insertion path used

Use [linux-e2e.md](./linux-e2e.md) as the release sign-off checklist. It is the current end-to-end test path for Ubuntu-class Linux environments.

## Automated Gaps

- Full desktop E2E dictation remains manual because microphone capture, tray behavior, global hotkeys, and simulated input are not reliable CI targets on headless Linux
- Frontend dictation hook with mocked Tauri commands
- Whisper transcription with a known audio sample
