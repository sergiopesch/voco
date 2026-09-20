# Local .44 onboarding and cursor candidate

Source base: `b1803b7`, branch `codex/onboarding-speech-test`. These are local
changes for 2026.0.44. The installed/public .43 app was not replaced, restarted or
published as part of this work. New runtime bytes require separate release
qualification and publisher approval.

## Behavior

- Setup selects the system default microphone on an explicit Start Test action.
  Finishing saves that default instead of restoring an old browser microphone.
  The default speaker needs no separate device choice; Test speaker plays a short
  local tone. Merely opening onboarding does not record.
- The input band grows from its center with received audio. The production local
  recognition queue displays progressive words inside setup, with no clipboard,
  external insertion, preedit ownership or desktop shortcut lease. Test output
  does not count as successful desktop delivery in quality logs.
- Finish Onboarding can stop an active successful test, drain capture and final
  recognition, then save completion. Stop Test also allows reviewing the result
  before finishing. Silence, denied capture and recognizer failure do not pass.
- Alt+D while testing stops the test and keeps setup open. Failed test audio can
  be discarded for retry without discarding an unrelated dictation recovery.
- Ordinary Alt+D requires a focused editable accessible control and valid caret
  (or focused terminal control). A missing cursor produces a desktop notification;
  protected fields and an unavailable accessibility probe have distinct messages.
  Capture does not begin when preflight fails. Notifications do not raise VOCO.
- Structured native errors retain their message instead of `[object Object]`.

## Verification

- Root `npm test` passed; frontend: 441 passed, 2 skipped. The final focused
  frontend run also passed after the finishing/error-message changes.
- Rust unit tests: 381 passed, one ignored.
- TypeScript, Rust formatting and Clippy passed. ESLint: zero errors, four
  pre-existing `any` warnings in the recording environment interface.
- Desktop focus and delivery-observation tests: 32 and 46 passed.
- Existing native-capture renderer regression: 42 scenarios passed. Existing
  microphone/settings renderer regression: 31 scenarios passed. The separate
  dictation renderer suite passed all 71 scenarios, including retained samples, final flush,
  uncertain paste and recovery.
- New onboarding renderer: eight scenarios passed, including native and WebKit
  paths, default selection, meter, speaker action, live transcript, Stop, Finish
  during recording, denied-access retry, recognition-error retry, silence and
  no-cursor notification. Media, recognition and native IPC are mocked in these
  browser checks. Default and minimum-window screenshots were inspected.
- Actual GTK in private X11/D-Bus: six scenarios passed (empty entry, text view,
  button, password, read-only field, return to entry), exercising the production
  Python helper. No host focus, clipboard or microphone was used.
- Speech-runtime unit checks: 30 passed. Real pinned model/worker protocol:
  13 checks passed, including warmup, sequencing, silence and cancellation.

## Package

The final complete Debian candidate passed `verify-deb-package.sh`, including
runtime/model provenance, desktop/AppStream metadata, icons, IBus and browser
integration payloads. SHA-256: `1aff977a950b663a5c8ef8dee086644a98da46d8a5330ff23094565e9e9952e1`.
The final renderer receipt matches current source hashes, and the embedded
frontend was rebuilt after the last product edit. No installation or publication
was performed. Existing users can open Settings → Troubleshooting → Re-run
onboarding after installing the candidate.

## Evidence and limitations

The reviewable artifact folder is `../candidate-2026.0.44/` relative to this
checkout. It holds the package, checksums, source identity and copied evidence.
The onboarding entry point is:

```bash
CHOKIDAR_USEPOLLING=true VOCO_RENDERER_SUITE=onboarding \
  VOCO_RENDERER_EVIDENCE_DIR=/tmp/voco-onboarding-new-run \
  node scripts/test-native-capture-renderer.mjs
```

The machine's file-watcher quota was exhausted. Browser tests used polling.
The host package build stopped at Tauri's manifest watcher; the build was repeated
in a network-disabled Ubuntu container with the same host toolchain and pinned
runtime. Container setup attempts initially lacked file-access capabilities and
compiler-alternative links; each failure log was retained. A pre-final package
was rejected because its frontend preceded the last error-message change. Final
assembly is checked against the final frontend source, not that intermediate file.

Earlier browser attempts caught an unadmitted onboarding trigger and the
small-window meter/paint problem, both corrected. Other failures were obsolete
harness navigation/selectors and a concurrent test-server port collision. The
final tests used separate sequential renderer runs. The GTK harness initially
failed its mount layout before running; the corrected isolated run passed.

These results do not prove physical-microphone quality, audible speaker output,
all receiving applications, a native Wayland session, or installed-package
onboarding. Custom controls that expose no accessible caret are deliberately
rejected. This change does not establish the original .43 paste-failure root cause;
its previous logs did not retain the native error message.
