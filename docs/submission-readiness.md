# Submission Readiness

Status snapshot: April 7, 2026.

This document is the publish gate for VOCO's Linux distribution channels.

It separates:
- artifact buildability
- metadata quality
- install and runtime validation
- channel-specific review risk

## Current Verdict

| Channel | Artifact Builds | Metadata Shape | Local Install Validation | Store Submission Verdict |
| --- | --- | --- | --- | --- |
| `.deb` | Yes | Good | Good | Closest to ready |
| Flatpak | Baseline only | Good | Not fully validated | Not ready |
| Snap / Ubuntu App Center | Yes | Coherent draft | Build validated, install not locally verified | Not ready |

## `.deb`

### Ready

- Tauri `.deb` bundling works.
- Debian metadata is version-aligned with the repo release metadata.
- AppStream metadata is bundled into the package.
- Desktop metadata validates.
- The release workflow already publishes `.deb` artifacts.

### Verified

- `cargo tauri build --bundles deb`
- `desktop-file-validate packaging/flatpak/com.sergiopesch.voco.desktop`
- `appstreamcli validate packaging/flatpak/com.sergiopesch.voco.metainfo.xml`
- package inspection confirmed:
  - version aligned with the current repo release
  - deduplicated runtime dependencies
  - packaged metainfo file

### Remaining Before Calling It Done

- smoke-test install and launch on a clean Ubuntu machine
- verify launcher presence and tray behaviour from the installed package
- verify upgrade-over-install and uninstall paths on a clean system

### Go / No-Go

Go once the clean-machine install, launch, tray, and upgrade checks pass.

## Flatpak / Flathub

### Ready

- tracked manifest exists in `packaging/flatpak/`
- desktop file validates
- AppStream metadata validates

### Verified

- `desktop-file-validate packaging/flatpak/com.sergiopesch.voco.desktop`
- `appstreamcli validate packaging/flatpak/com.sergiopesch.voco.metainfo.xml`

### Blocking Issues

- the product model is still a poor sandbox fit:
  - global hotkeys
  - host-level text insertion
  - Wayland `ydotool` / input-device assumptions
  - typing into arbitrary host applications
- `flatpak-builder` end-to-end validation is not yet part of the repo validation story
- runtime permission behaviour has not been verified in a real Flatpak sandbox

### Submission Verdict

Do not submit to Flathub yet. The metadata is acceptable, but the runtime/product fit is still unresolved.

### Go / No-Go

No-go until the sandbox and host-integration story is proven in a real Flatpak runtime.

## Snap / Ubuntu App Center

### Ready

- tracked snap sources now exist under `snap/`
- `snapcraft --destructive-mode` builds a real artifact
- desktop metadata validates
- version metadata is aligned with the repo release version
- the draft is honest about `classic` confinement

### Verified

- `desktop-file-validate snap/gui/com.sergiopesch.voco.desktop`
- `snapcraft --destructive-mode`
- built artifact:
  - `snap/voco_<version>_amd64.snap`

### Remaining Warnings

- Snapcraft still emits a classic-confinement warning set around ELF interpreter and rpath expectations for bundled runtime binaries and libraries
- Snapcraft still emits some unused-library warnings
- metadata still lacks a `donation` field

### Blocking Issues

- local install and runtime verification still require privileged install:
  - `snap install --dangerous --classic ...`
- this machine did not complete that install step because `sudo` required a password
- Ubuntu App Center publication still depends on manual review because VOCO uses `classic` confinement

### Submission Verdict

Closer than before, but still not ready for submission. The packaging path is now real, but store review risk and runtime validation are still open.

### Go / No-Go

No-go until the snap is installed locally, smoke-tested end to end, and the classic-confinement review case is written clearly enough for submission.

## Final Checklist

Use this before any store submission attempt.

### For `.deb`

- [ ] install on clean Ubuntu
- [ ] launch from app launcher
- [ ] verify tray icon and onboarding
- [ ] verify Wayland insertion path
- [ ] verify X11 insertion path
- [ ] verify uninstall and reinstall

### For Flatpak

- [ ] build with `flatpak-builder`
- [ ] verify microphone access in sandbox
- [ ] verify update and external URL behaviour in sandbox
- [ ] verify whether hotkeys and host insertion are acceptable or fundamentally blocked
- [ ] decide whether Flathub is a real target or should be deferred

### For Snap

- [ ] install locally with `snap install --dangerous --classic`
- [ ] launch from App Center-style desktop entry path
- [ ] verify tray, mic access, hotkey registration, and insertion helpers
- [ ] review the remaining Snapcraft classic/library warnings and decide which are acceptable
- [ ] prepare the classic-confinement review justification for store submission

## Recommendation

Near-term release priority:
1. `.deb`
2. GitHub-only Snap artifact for manual testing
3. Flatpak only after resolving the sandbox/product fit

Near-term store priority:
1. finish local Snap install/runtime validation
2. prepare classic-confinement review notes
3. postpone Flathub submission until the host-integration model is either redesigned or explicitly proven workable
