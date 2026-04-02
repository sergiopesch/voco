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

## Later

- Snap
- RPM if Fedora-class support becomes a priority

## Asset Naming

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

## AppImage Fallback Packaging

Tauri currently generates a complete `VOCO.AppDir` locally on this machine, but it may stop before writing the final `.AppImage` file.

The repo now includes:

- `scripts/package-appimage.sh`

This helper:

- normalizes the expected lowercase icon name inside `VOCO.AppDir`
- downloads `appimagetool` if needed
- runs `appimagetool` in extract-and-run mode so it does not require host FUSE 2

Use it after `cargo tauri build` or `npm run build` if no final `.AppImage` file was emitted automatically.
