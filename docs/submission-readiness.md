# Distribution Readiness

Status reviewed: July 15, 2026.

This document is a gate checklist, not proof that the current workspace or next release candidate
passed it. Record candidate-specific command output and desktop evidence in the testing results and
release artifacts; do not infer readiness from packaging files merely existing in the repository.

## Current Channel Boundary

| Channel | Current role | Host integration | Publication status |
| --- | --- | --- | --- |
| GitHub Release `.deb` | Primary Ubuntu package | Installs the persistent IBus component | Published channel; validate every candidate |
| AppImage | Local packaging experiment | Does not install the IBus component | Not published until every helper is pinned |
| Flatpak / Flathub | Packaging experiment | Host input and hotkey model unresolved | Not published; no submission claim |
| Snap / Ubuntu App Center | Tracked draft | Requires classic confinement and store review | Not published; no submission claim |

Ubuntu is the primary reference and release-test environment. Debian-derived distributions are
best-effort and are not part of the regular desktop matrix. A `.deb` payload being structurally
compatible with Debian does not prove desktop behavior there.

## GitHub Release `.deb`

For each release candidate, retain evidence for all applicable gates:

- version consistency and source-tree validation
- frontend build, type checks, lint, unit tests, Rust tests, formatting, and Clippy
- Debian bundle build and exact payload verification
- `desktop-file-validate` and `appstreamcli validate`
- clean Ubuntu install and launch from the packaged desktop entry
- tray, onboarding, microphone, update-check, hotkey, and insertion smoke tests
- persistent `VOCO Dictation` setup and owned-cursor behavior in normal and failure cases
- upgrade over the prior published package, including resident IBus protocol refresh instructions
- uninstall and reinstall, including confirmation that per-user input-source settings and XDG data
  are not silently removed

Headless ownership/protocol tests and deterministic audio replay are necessary but do not prove
visible IBus preedit, focus transitions, target-app layout, or a complete desktop matrix. The live
cursor candidate status and any pending manual cases belong in
[Cursor Streaming QA Results](testing/cursor-streaming-qa-results.md).

## AppImage

Publication is paused while the Tauri/linuxdeploy path relies on mutable helper downloads. Before
restoring it, pin and verify every packaging tool, then validate launch, tray, microphone capture,
local transcription, one-shot insertion, update instructions, and clean shutdown on Ubuntu. The
AppImage does not install the host IBus component; without a matching component already installed,
automatic live-cursor mode must report its preview-only limitation rather than being recorded as a
passing owned-cursor run.

## Flatpak / Flathub

The tracked manifest and metadata are preparation material only. Before any Flathub submission,
the project must demonstrate in a real Flatpak runtime that microphone access, global hotkeys,
arbitrary host-application insertion, external links, updates, and the IBus architecture have an
acceptable sandboxed design. Until then, do not describe Flatpak as an install or release channel.

## Snap / Ubuntu App Center

The tracked Snap configuration is a draft. Classic confinement is currently the honest fit for
VOCO's host-level hotkeys, input simulation, notifications, and arbitrary target applications, and
it requires store review. Before submission, build in an isolated environment, inspect confinement
and ELF/rpath warnings, install the exact artifact with the intended confinement, run end-to-end
desktop tests, and prepare a precise classic-confinement justification. Until those steps are
recorded, do not describe the Snap or Ubuntu App Center path as ready.

## Evidence Rules

- Name the exact version, commit SHA, artifact digest, operating system, desktop, display protocol,
  and test date.
- Distinguish automated, headless, disposable-desktop, and active-workstation evidence.
- Keep historical failures as history; do not relabel them as current candidate results.
- Leave an unperformed case as pending. Do not promote a channel based on expected compatibility.
- Do not publish Flatpak, Flathub, Snap, or Ubuntu App Center availability until the matching
  artifact and runtime path have actually been verified and published.
