# Linux Packaging

VOCO's v1 packaging plan is intentionally staged.

## Current

- GitHub Releases
- `.deb`
- `.AppImage`
- release checksums
- update checks against GitHub Releases inside the app

## Next

- Flathub packaging
- Flatpak manifest baseline now lives in `packaging/flatpak/`
- Ubuntu App Center review path once the tracked Snap draft and confinement story are settled

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

- Ubuntu / Debian
- x86_64 / amd64
- Wayland and X11, with documented insertion caveats

## Listing Assets

Store copy, release-note structure, and screenshot requirements live in [docs/store-listing.md](store-listing.md).

## Flatpak Baseline

The repo now includes an initial Flatpak packaging baseline:

- `packaging/flatpak/com.sergiopesch.voco.yml`
- `packaging/flatpak/com.sergiopesch.voco.desktop`
- `packaging/flatpak/com.sergiopesch.voco.metainfo.xml`

This is a starting point for Flathub submission work, not a claimed production-ready Flathub package yet. The next packaging pass should validate sandbox permissions, runtime dependencies, and release build behavior inside `flatpak-builder`.

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

The next packaging pass should validate `snapcraft --destructive-mode` on Ubuntu 24.04+ with root-capable host packaging or an LXD-backed Snapcraft environment, confirm the staged runtime helpers behave correctly in real desktop sessions, and decide whether any future product changes could make stricter confinement realistic.

## AppImage Fallback Packaging

Tauri currently generates a complete `VOCO.AppDir` locally on this machine, but it may stop before writing the final `.AppImage` file.

The repo now includes:

- `scripts/package-appimage.sh`

This helper:

- normalizes the expected lowercase icon name inside `VOCO.AppDir`
- downloads `appimagetool` if needed
- runs `appimagetool` in extract-and-run mode so it does not require host FUSE 2

Local `npm run build` now falls back to this helper automatically when Tauri stops at the final `linuxdeploy` step.

Use it manually after `cargo tauri build` if no final `.AppImage` file was emitted automatically.
