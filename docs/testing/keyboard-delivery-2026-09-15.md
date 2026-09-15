# Legacy keyboard-delivery optimization — 15 September 2026

Private revision `2026.0.37+local7` makes one production change: legacy ydotool
paste commands now specify `--delay 24` alongside the existing `--key-delay 12`.
There is no new helper, cache, dependency, model, setting or UI behavior.
Exact package/build/app-test status belongs to the accompanying artifact receipts.
The owner has successfully tested installed +local6; later acceptance is separate.

## Why this is bounded

The installed legacy helper defaults to a 100 ms initial delay. Its implementation
also passes that same delay into key emission, ignoring the separately parsed
key-delay value. This explains the owner's measured 254 ms median keyboard stage.
An explicit nonzero 24 ms delay retains 6–12 ms event spacing for the existing
normal/terminal gestures. The key sequence, literal leading space, press/release
order and modifier release are unchanged. Modern numeric-event helpers retain
exactly their previous arguments. Unknown helpers still fail before mutation.

`insertion.rs` remains the sole command-construction authority. No shortcut,
focus/readback, clipboard ordering, subprocess timeout or uncertain-delivery retry
rules change. The separate type-simulation path also remains unchanged.

## Evidence and limits

64 alternating real legacy-helper trials (eight per configuration) checked normal
and terminal chords with/without a leading space. Every event sequence matched.
Normal helper completion medians fell 301.9→73.8 ms; with a leading space,
252.1→62.1 ms. These measure the helper process/socket, not ASR or cursor paint.

Eight private recipient cases additionally relay those actual helper events into
XTest/GTK, testing both chord styles and immediate/1.8-second delayed clipboard
reads. This is an isolated event-to-recipient check, not a real terminal or physical
Wayland qualification. Three failed fixture setup attempts remain recorded (X focus
synchronization and selected seed text); they are not hidden application failures.

The owner must test the new installed candidate before release. Do not extrapolate
an approximately 190–228 ms helper saving into a measured first-word improvement.
Keep the previous .37+local6 artifacts and owner 57.275-second test as the baseline.

## Verification entry points

- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib insertion::tests`
- `python3 scripts/test-legacy-ydotool.py` (private socket/device namespaces only)
- Complete Rust/static/build checks and exact-package native fixtures in fresh outputs.
- External `keyboard-delivery-review-2026-09-15` receipts bind helper, source, app,
  package, expected key events, actual timings and preserved unsuccessful attempts.
