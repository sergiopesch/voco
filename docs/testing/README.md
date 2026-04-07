<!-- markdownlint-disable MD032 MD060 -->
# Testing

## Current State

Automated tests are in place for both frontend and backend.

### Rust (23 tests)

Run with `cargo test` from `apps/desktop/src-tauri/`.

| Module      | Tests | What's Covered                                                                                                              |
| ----------- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| `config`    | 8     | Default values, serialization round-trip, deserialization with defaults, enum casing, cached update state                 |
| `insertion` | 3     | Strategy serialization (kebab-case), session detection, command failure on non-zero exit                                  |
| `lib`       | 12    | Base64 audio decoding, socket path, hotkey config, hotkey backend selection, hotkey modes, global-shortcut backend logic |

### Frontend (19 tests)

Run with `npm test` from project root.

| File               | Tests | What's Covered                                                                                                     |
| ------------------ | ----- | ------------------------------------------------------------------------------------------------------------------ |
| `store.test.ts`    | 9     | Store actions: status transitions, error handling, transcript management, audio level, config storage, update state |
| `audioLevel.test.ts` | 3   | DC-offset removal, centered RMS calculation, visual level behavior                                                 |
| `updates.test.ts`  | 7     | Version comparison, channel selection, update lookup, and update cache helpers                                     |

Current manual product coverage is broader than the automated test count. The onboarding flow, tray interactions, and Linux insertion behavior still need manual verification on Linux.

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
  - confirm microphone check uses the intended input device
  - confirm the level meter stays low at rest and moves through the middle during normal speech
  - confirm accent-aware is visible as a disabled future feature, not an active option
- Hotkey behavior:
  - first press should immediately show listening state and the active tray indicator
  - switch hotkey at runtime from settings and tray menu, then verify the new binding triggers dictation immediately
- Trigger via Unix socket: `socat - UNIX-CONNECT:$XDG_RUNTIME_DIR/voco.sock < /dev/null`
- Insertion behavior:
  - verify direct type simulation in a text editor
  - verify fallback path messaging when paste simulation fails

- State the distro, desktop environment, compositor, and insertion path used

## Future Test Targets

- E2E dictation flow (requires mic + ASR + insertion — Playwright or Tauri WebDriver)
- Frontend dictation hook with mocked Tauri commands
- Whisper transcription with a known audio sample
