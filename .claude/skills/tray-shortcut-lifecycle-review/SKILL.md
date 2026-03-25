# Tray and Shortcut Lifecycle Review

## When to use
Invoke when changes touch the system tray, global shortcut registration, window visibility, app lifecycle, or any code in `tray.rs`, `lib.rs` (setup/shortcut sections), or `useGlobalShortcut.ts`.

## What to review

### Tray lifecycle
- Does the tray icon render correctly on startup?
- Do tray state transitions (idle/recording/processing) update the icon reliably?
- Does the tray menu reflect correct state (Start/Stop Dictation)?
- Is `set_recording_state` called at the right times from the frontend?

### Global shortcut
- Is Alt+D registered successfully on startup?
- Does `eval_toggle()` correctly call `window.__toggleDictation()` via JS eval?
- Is the 100ms delay between `window.show()` and `window.eval()` still necessary?
- Do the three trigger mechanisms (Tauri plugin, evdev, Unix socket) all call the same path?

### evdev fallback
- Does the evdev listener handle missing `/dev/input/event*` devices?
- Is the `input` group requirement documented?
- Does it clean up properly on app exit?

### Window lifecycle
- Is the invisible window correctly positioned off-screen?
- Does `getUserMedia` work reliably with the 1x1 transparent window approach?
- Are there race conditions between window show/hide and JS evaluation?

### Edge cases
- What happens if the shortcut is already registered by another app?
- What happens if the tray icon fails to render?
- Does the app recover gracefully from a crashed transcription?

## Output format
| Component | Severity | Issue | File:line | Recommendation |
|-----------|----------|-------|-----------|----------------|
