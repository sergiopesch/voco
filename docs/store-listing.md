# Store Listing Pack

This file is the current VOCO copy pack for GitHub Releases, Flathub preparation, and future Snap listing work.

## App Title

`VOCO`

## Subtitle

`Voice-native interface layer. Built for Linux.`

## One-Line Summary

VOCO is a local dictation app for Linux that pastes what you say into the focused app.

## Short Description

VOCO lives in the Linux tray and listens on demand. It transcribes locally and pastes into whatever has keyboard focus. If typing is interrupted, Stop copies the words it did not type to the clipboard; after an unexpected exit, tray Review offers the last saved text.

## Full Description

VOCO is a desktop dictation tool built for Linux users who want fast voice capture without giving up clarity or control.

It stays out of the way until you trigger it, then moves through a small set of explicit states:

- ready
- listening
- processing
- complete
- blocked

Key product points:

- tray-first workflow with a compact command panel
- first-run voice test and desktop setup check
- local-first transcription path
- explicit Linux install and upgrade guidance
- settings that remain compact instead of sprawling

VOCO is designed for:

- developers
- writers
- creators
- Linux users who want reliable dictation without a cluttered desktop utility

## Privacy / Trust Copy

VOCO needs microphone access for voice input. Normal dictation is transcribed on-device and does
not require an account or cloud transcription service. There are no assistant or cloud conversation modes.

Configuration stays local on the machine. VOCO automatically requests GitHub Releases metadata for
update awareness, without uploading audio or transcripts. A developer-only environment flag can
persist one debug WAV and transcript timeline for regression testing; it is off by default and is
not part of normal dictation. Existing `voice` installs migrate forward to `voco` paths
automatically.

## Packaging Notes

Current release priorities:

- GitHub Releases
- `.deb`
- checksums

AppImage publication is paused until the complete Linux packaging toolchain is immutable and
checksum-verified.

Current store path:

- Ubuntu App Center remains a classic-confinement review candidate after local install and runtime validation
- Flathub is deferred until the sandbox and host-integration story is proven workable

Current Snap note:

- use `classic` confinement for the honest v1 draft because VOCO depends on host-level hotkeys and text insertion helpers

## Release Notes Template

### Summary

One paragraph describing the headline product change.

### What Improved

- list user-visible improvements first
- mention install or packaging changes explicitly when they affect Linux users

### Upgrade Notes

- confirm whether settings are preserved
- confirm whether hotkeys changed
- confirm whether a restart is required

### Known Issues

- list channel-specific caveats
- call out Wayland or tray limitations when relevant

## Screenshot Shot List

Capture these surfaces on a clean Linux desktop with legible text and restrained composition:

1. First-run voice test with live transcript
2. Desktop setup check
3. Compact command panel with current state visible
4. Settings window on the Updates section
5. Tray or GNOME panel microphone and waveform during dictation

## Screenshot Rules

- use a dark desktop background with minimal visual noise
- keep VOCO centered and readable
- avoid unrelated terminal clutter or browser tabs
- ensure panel shadows and graphite highlights remain visible
- capture at high resolution, then export scaled store assets from those masters
