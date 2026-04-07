# Install

VOCO currently ships through GitHub Releases first, with additional Linux channels planned after packaging quality is stable. The visual system now centers on the graphite microphone mark used in the app and release assets.

## GitHub Release

```bash
bash <(curl -s https://raw.githubusercontent.com/sergiopesch/voco/master/install)
```

Manual install:

```bash
wget https://github.com/sergiopesch/voco/releases/download/voco.2026.0.3/voco_2026.0.3_amd64.deb
sudo dpkg -i voco_2026.0.3_amd64.deb
```

Current stable release:
- tag: `voco.2026.0.3`
- Debian package: `voco_2026.0.3_amd64.deb`
- AppImage: `VOCO-2026.0.3-x86_64.AppImage`

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

## Snap Preparation

VOCO now includes an initial Snap draft under `snap/`.

Start from:

```bash
snapcraft
```

Current note:
- the draft uses `classic` confinement intentionally
- this matches VOCO's current host-integration model for hotkeys, text insertion, notifications, and URL opening
- treat this as Ubuntu App Center preparation work, not a published Snap channel yet

## AppImage Fallback Packaging

If Tauri leaves `VOCO.AppDir` in `apps/desktop/src-tauri/target/release/bundle/appimage/` without creating the final `.AppImage`, run:

```bash
bash ./scripts/package-appimage.sh
```

This path is intended for local packaging validation and CI recovery when the AppDir exists but the final AppImage artifact was not written.

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
