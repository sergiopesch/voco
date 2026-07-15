# Linux Packaging

VOCO's v1 packaging plan is intentionally staged.

## Current

- GitHub Releases
- `.deb`
- release checksums
- update checks against GitHub Releases inside the app

AppImage remains a local packaging experiment and is not published until the full linuxdeploy and
appimagetool chain can be supplied from immutable, checksum-verified sources.

## Next

- Ubuntu App Center review path after local snap install and runtime validation
- Flatpak sandbox validation to determine whether Flathub is a real fit
- release workflow polish for the channels that already build cleanly

## Later

- strict-confinement investigation only if VOCO stops depending on host-level desktop automation
- RPM if Fedora-class support becomes a priority

## Asset Naming

Branding note:
- package and listing assets should use VOCO's graphite microphone branding rather than the older purple treatment

- `voco_<version>_amd64.deb`
- `voco_checksums.txt`

## Packaging Principles

- use Linux-native desktop metadata
- keep uninstall paths clean
- avoid hidden system modification
- document permissions and runtime expectations
- keep the first-run setup clear about microphone access and feature availability

## Support Matrix

Current primary validation target:

- Ubuntu
- x86_64 / amd64
- Wayland and X11, with documented insertion caveats

Debian-derived distributions are best-effort. The `.deb` format and dependency metadata target
Debian-family package managers, but that compatibility is not a substitute for a recorded desktop
runtime test.

Automatic live cursor revisions use a persistent, package-owned IBus component at
`/usr/share/ibus/component/voco.xml`, launched through `/usr/libexec/voco-ibus-engine`. The `.deb`
depends on `ibus`, `python3`, `gir1.2-ibus-1.0`, and `python3-gi`. Installation only makes
the source available: the user must add and select `VOCO Dictation`, and no maintainer script may
modify GNOME settings or restart IBus. The app talks to the engine through an owner-only socket at
`$XDG_RUNTIME_DIR/voco/ibus-engine.sock`; disconnects fail closed to preview-only behavior.

A locally built experimental AppImage cannot install the host component and therefore does not
claim live cursor support by itself. Stable cursor mode does not fall back to compatibility keyboard
injection when the input source or target preedit context is unavailable.

## Listing Assets

Store copy, release-note structure, and screenshot requirements live in [docs/store-listing.md](store-listing.md).
Submission status and release gating live in [docs/submission-readiness.md](submission-readiness.md).
Release rehearsal steps live in [docs/release-process.md](release-process.md).

## Flatpak Baseline

The repo now includes an initial Flatpak packaging baseline:

- `packaging/flatpak/com.sergiopesch.voco.yml`
- `packaging/flatpak/com.sergiopesch.voco.desktop`
- `packaging/flatpak/com.sergiopesch.voco.metainfo.xml`

This is a starting point for Flathub submission work, not a claimed production-ready Flathub package yet. The next packaging pass should validate sandbox permissions, runtime dependencies, and release build behavior inside `flatpak-builder` before Flathub is treated as an active release target.

## Snap Status

The repo now includes a tracked Snap draft:

- `snap/snapcraft.yaml`
- `snap/gui/com.sergiopesch.voco.desktop`

Ubuntu App Center work is still a draft path, not a publish-ready channel.

The likely first store submission still uses `classic` confinement on purpose.

Why not strict yet:

- VOCO registers global hotkeys
- on Wayland it can rely on direct `evdev` keyboard access
- text insertion shells out to `ydotool`, `xdotool`, `wl-copy`, `wl-paste`, and `xclip`
- it opens external URLs with `xdg-open`
- it uses `notify-send` for desktop notifications
- its core user promise is typing into arbitrary host applications, which is exactly where strict confinement becomes unnatural

So the honest first Snap is a classic-confinement review candidate, not a pretend-strict package that quietly breaks VOCO's core workflow.

The next packaging pass should install the built snap locally, verify tray, microphone, hotkey, and insertion behavior in a real desktop session, and then decide whether any future product changes could make stricter confinement realistic.

## Experimental AppImage Packaging

This path is for local packaging research only. It is not part of the release workflow because the
upstream Tauri/linuxdeploy stages are not yet fully pinned, even though the final `appimagetool`
fallback itself is checksum-verified.

The repo now includes:

- `scripts/package-appimage.sh`

This helper:

- normalizes the expected lowercase icon name inside `VOCO.AppDir`
- requires `VOCO_APPIMAGETOOL_PATH` and `VOCO_APPIMAGETOOL_SHA256` for a pre-fetched immutable
  `appimagetool` binary, and verifies it before execution
- runs `appimagetool` in extract-and-run mode so it does not require host FUSE 2

Default `npm run build` builds only the locked Debian bundle. After an explicit experimental
AppImage attempt, this helper can finish an existing AppDir only when both pinned-tool environment
variables are set. That does not make the earlier linuxdeploy stages release-safe.

Use it manually only after an explicit experimental
`cargo tauri build --features custom-protocol --bundles appimage` run created the AppDir.

```bash
VOCO_APPIMAGETOOL_PATH=/path/to/pinned/appimagetool \
VOCO_APPIMAGETOOL_SHA256=<verified-sha256> \
bash ./scripts/package-appimage.sh
```
