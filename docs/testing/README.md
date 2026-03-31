<!-- markdownlint-disable MD032 MD060 -->
# Testing

## Current State

Automated tests are in place for both frontend and backend.

### Rust (19 tests)

Run with `cargo test` from `apps/desktop/src-tauri/`.

| Module      | Tests | What's Covered                                                                                                              |
| ----------- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| `config`    | 4     | Default values, serialization round-trip, deserialization with defaults, kebab-case strategy                              |
| `insertion` | 3     | Strategy serialization (kebab-case), session detection, command failure on non-zero exit                                  |
| `lib`       | 12    | Base64 audio decoding, socket path, hotkey config, hotkey backend selection, hotkey modes, global-shortcut backend logic |

### Frontend (8 tests)

Run with `npm test` from project root.

| File            | Tests | What's Covered                                                                                      |
| --------------- | ----- | --------------------------------------------------------------------------------------------------- |
| `store.test.ts` | 8 | All store actions: status transitions, error handling, transcript management, audio level, config storage |

## Running Tests

```bash
# All frontend tests
npm test

# All Rust tests
cd apps/desktop/src-tauri && cargo test

# Full validation (what CI runs)
npm run check && npm run lint && npm test
cd apps/desktop/src-tauri && cargo check && cargo clippy -- -D warnings && cargo test
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and PR to master:
- TypeScript check, ESLint, Vitest (frontend)
- cargo check, cargo clippy (zero warnings), cargo test (Rust)

## Manual Verification

For system-level features that are hard to automate:

- Startup readiness:
  - launch app and confirm tray icon transitions gray -> green after mic init
  - confirm log lines for `Hotkey listener attached` and `Microphone ready`
- Hotkey behavior:
  - first press should immediately show listening state and red tray icon
  - switch hotkey at runtime from tray menu and verify new binding triggers dictation
- Trigger via Unix socket: `socat - UNIX-CONNECT:$XDG_RUNTIME_DIR/voice.sock < /dev/null`
- Insertion behavior:
  - verify direct type simulation in a text editor
  - verify fallback path messaging when paste simulation fails

- State the distro, desktop environment, compositor, and insertion path used

## Future Test Targets

- E2E dictation flow (requires mic + ASR + insertion — Playwright or Tauri WebDriver)
- Frontend dictation hook with mocked Tauri commands
- Whisper transcription with a known audio sample
