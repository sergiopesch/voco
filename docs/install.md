# Install

VOCO currently ships through GitHub Releases first. `.deb` is the primary release channel today, AppImage remains a secondary manual-install artifact, and the Snap and Flatpak paths are still under validation.

## GitHub Release

```bash
bash <(curl -s https://raw.githubusercontent.com/sergiopesch/voco/master/install)
```

Manual install:

```bash
wget https://github.com/sergiopesch/voco/releases/download/voco.<version>/voco_<version>_amd64.deb
sudo dpkg -i voco_<version>_amd64.deb
```

Current stable release naming:
- tag: `voco.<version>`
- Debian package: `voco_<version>_amd64.deb`
- AppImage: `VOCO-<version>-x86_64.AppImage`

## Build From Source

```bash
git clone https://github.com/sergiopesch/voco.git
cd voco
./scripts/setup.sh --install
```

On first launch, VOCO opens its setup flow so you can:
- confirm microphone access
- choose an input device
- confirm the default hotkey
- decide whether the listening HUD should stay visible

## Flatpak / Flathub Preparation

VOCO now includes an initial Flatpak packaging baseline under `packaging/flatpak/`.

When testing locally with `flatpak-builder`, start from:

```bash
flatpak-builder --user --install --force-clean build-flatpak packaging/flatpak/com.sergiopesch.voco.yml
```

This path is still packaging work in progress. Treat it as a local validation path before Flathub submission, not a finished public channel.

## Snap / Ubuntu App Center Status

VOCO now includes a tracked Snap draft under `snap/`.

Current note:
- local packaging work now lives in `snap/snapcraft.yaml`
- the Ubuntu App Center path still needs local install validation, runtime smoke tests, and store review
- classic confinement is the honest current fit because VOCO depends on host-level hotkeys, text insertion, notifications, and URL opening
- treat this as packaging work in progress, not an available install path yet

Local build entry point:

```bash
cd snap
snapcraft --destructive-mode
```

This currently assumes either:
- a root-capable `snapcraft --destructive-mode` environment, or
- an LXD-backed Snapcraft setup

## AppImage Fallback Packaging

Local `npm run build` now falls back to `scripts/package-appimage.sh` automatically when Tauri stops at the final `linuxdeploy` step.

If you still need to finish AppImage packaging manually from an existing `VOCO.AppDir` in `apps/desktop/src-tauri/target/release/bundle/appimage/`, run:

```bash
bash ./scripts/package-appimage.sh
```

This path is intended for local packaging validation and CI recovery when the AppDir exists but the final AppImage artifact was not written.

## Release Rehearsal

Before cutting a release, run:

```bash
npm run rehearse:release
```

This validates version alignment, shell helper syntax, and the generated GitHub release notes against the current repo version and asset naming.

## Runtime Paths

- Config: `~/.config/voco/config.json`
- Models: `~/.local/share/voco/models/`
- Socket: `$XDG_RUNTIME_DIR/voco.sock`

Legacy `voice` config and model paths are migrated automatically on startup when possible.

## Uninstall

### `.deb`

```bash
sudo apt remove voco
```

If you also want to remove local state:

```bash
rm -rf ~/.config/voco ~/.local/share/voco ~/.cache/voco
```

### Snap draft cleanup

If you built the draft snap locally, remove the installed snap with:

```bash
sudo snap remove voco
```

### Source install

Remove the built binary or bundle you installed, then remove local state if desired:

```bash
rm -rf ~/.config/voco ~/.local/share/voco ~/.cache/voco
```
