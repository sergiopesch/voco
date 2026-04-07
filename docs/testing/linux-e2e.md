# Linux End-To-End Matrix

Use this document as the manual release sign-off path for VOCO. The goal is to validate the real Linux runtime around microphone access, tray state, global hotkeys, insertion helpers, and update UX where unit tests cannot fully exercise the system.

## Target Environments

| Environment | Session | Why It Matters | Release Expectation |
| ----------- | ------- | -------------- | ------------------- |
| Ubuntu 24.04 GNOME | Wayland | Primary Ubuntu Wayland path and the default desktop assumption | Required |
| Kubuntu 24.04 KDE | Wayland | Confirms a second mainstream Wayland compositor path | Required |
| Ubuntu 24.04 | X11 | Baseline `xdotool` and `xclip` insertion path | Required |
| Debian 12 GNOME | Wayland | Packaging and runtime spot-check outside Ubuntu | Best-effort |

## Runtime Preflight

Run this before manual testing:

```bash
npm run check
npm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run rehearse:release
npm run report:linux-runtime
```

Expected runtime diagnostics:

| Session | Type Simulation | Clipboard Insertion |
| ------- | --------------- | ------------------- |
| Wayland | `ydotool` | `wl-copy` + `ydotool` (`wl-paste` is optional for clipboard restore) |
| X11 or other | `xdotool` | `xclip` + `xdotool` |

In the app, open Settings -> Advanced and use `Refresh runtime checks` to confirm the runtime matches the host session before testing insertion.

## End-To-End Scenarios

| ID | Scenario | Pass Criteria |
| -- | -------- | ------------- |
| E2E-01 | Fresh install and first launch | App starts, tray icon appears, model download begins only when needed, no startup error loop |
| E2E-02 | Onboarding microphone access | Permission prompt resolves cleanly, correct microphone can be selected, level meter is stable at rest and responsive while speaking |
| E2E-03 | Tray and HUD state transitions | Ready, listening, transcribing, and error states are visually distinct and match actual dictation state |
| E2E-04 | Default hotkey | `Alt+D` starts and stops dictation reliably without restart |
| E2E-05 | Hotkey reconfiguration | Changing the hotkey in settings or tray updates the active binding immediately |
| E2E-06 | Wayland or X11 direct insertion | Transcript lands in a focused text field through direct type simulation when helpers are available |
| E2E-07 | `auto` fallback path | When direct type simulation fails, `auto` mode still inserts through clipboard paste |
| E2E-08 | Strict `type-simulation` path | Failure is reported without modifying the clipboard |
| E2E-09 | Socket trigger | `socat` against the expected socket path triggers dictation without UI desync |
| E2E-10 | Update checks | Update check finishes or times out cleanly and never leaves the UI stuck in `checking` |
| E2E-11 | Restart persistence | Config, selected microphone, hotkey, and update state survive app restart |
| E2E-12 | Runtime diagnostics | Missing helpers or wrong session assumptions are reflected accurately in Advanced settings |

## Scenario Notes

- Test insertion in at least one plain text editor and one browser text field.
- On Wayland, validate both the happy path and one forced failure path so `auto` and strict `type-simulation` behavior are both exercised.
- On X11, confirm no `input` group membership is needed and that direct typing still works after a hotkey change.
- If using `ydotool` v1.x, confirm `ydotoold` is actually reachable during the test session.
- Record whether the test was run against a `.deb`, AppImage, or source build.

## Evidence To Capture

Attach the following to the release note, issue, or PR:

- output from `npm run report:linux-runtime`
- distro and desktop session
- install channel used
- insertion strategy tested
- whether `auto` fallback and strict `type-simulation` were both exercised
- whether update checks completed, timed out cleanly, or hit a real error
- any compositor-specific behavior or helper package caveats

## Exit Criteria

VOCO is ready for release only when all required environments are green, strict `type-simulation` never overwrites the clipboard, runtime diagnostics match the real host environment, and there is no reproducible hotkey, tray, socket, or update-state regression across restart.
