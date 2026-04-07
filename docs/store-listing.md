# Store Listing Pack

This file is the current VOCO copy pack for GitHub Releases, Flathub preparation, and future Snap listing work.

## App Title

`VOCO`

## Subtitle

`Voice-native interface layer. Built for Linux.`

## One-Line Summary

VOCO is a voice-first Linux desktop tool for dictation, interaction, and fast system workflows.

## Short Description

VOCO lives in the Linux tray, listens on demand, and inserts speech directly into the app you are already using. It keeps the visible experience compact, keeps state clear, and defaults to a local-first workflow.

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
- onboarding flow for microphone setup, hotkeys, and HUD preferences
- a voice-profile step that communicates future accent-aware work without pretending it ships today
- local-first transcription path
- explicit Linux install and upgrade guidance
- settings that remain compact instead of sprawling

VOCO is designed for:
- developers
- writers
- creators
- Linux users who want reliable dictation without a cluttered desktop utility

## Privacy / Trust Copy

VOCO needs microphone access for voice input features. Audio is used for dictation and related voice workflows. Configuration stays local on the machine. Existing `voice` installs migrate forward to `voco` paths automatically.

## Packaging Notes

Current release priorities:
- GitHub Releases
- `.deb`
- `.AppImage`
- checksums

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

1. First-run welcome screen
2. Microphone check with live level meter
3. Hotkey and HUD onboarding step
4. Voice profile onboarding step with the future feature visibly disabled
5. Compact command panel with current state visible
6. Settings window on the Updates section
7. Listening HUD in-context on a desktop

## Screenshot Rules

- use a dark desktop background with minimal visual noise
- keep VOCO centered and readable
- avoid unrelated terminal clutter or browser tabs
- ensure panel shadows and graphite highlights remain visible
- capture at high resolution, then export scaled store assets from those masters
