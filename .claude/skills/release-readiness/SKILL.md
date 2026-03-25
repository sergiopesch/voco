# Release Readiness

## When to use
Invoke before tagging a release, building a .deb package, or shipping to users.

## Checklist

### Build
- [ ] `npm run check` passes
- [ ] `npm run build` succeeds
- [ ] Rust compiles with zero warnings (`cargo check`, `cargo clippy`)
- [ ] .deb package builds successfully via `./scripts/setup.sh --install`

### Functionality
- [ ] Alt+D hotkey triggers dictation on fresh launch
- [ ] Audio capture works (tray icon turns red)
- [ ] Transcription produces correct text for clear English speech
- [ ] Text insertion works on the tested session type (Wayland/X11)
- [ ] Clipboard fallback works when primary insertion fails
- [ ] Tray icon returns to idle state after dictation completes

### First-run experience
- [ ] Model downloads successfully on first launch
- [ ] App is usable after model download without restart
- [ ] Behaviour is clear if download fails (error message, not silent failure)

### Packaging
- [ ] .deb installs cleanly on Ubuntu
- [ ] Desktop entry appears in application launcher
- [ ] App launches from launcher and appears in system tray
- [ ] No hardcoded paths to development environment

### Documentation
- [ ] README.md matches actual behaviour
- [ ] Install instructions work on a clean Ubuntu system
- [ ] Known limitations are documented honestly
- [ ] No aspirational claims about untested features

### Security
- [ ] No secrets, tokens, or credentials in the build
- [ ] No `.env` files tracked in git
- [ ] Dependencies checked for known CVEs
- [ ] Shell commands sanitize user input

## Output format
Each item: PASS / FAIL / NOT VERIFIED with notes.
List any blocking issues that must be resolved before release.
