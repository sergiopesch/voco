# Install

VOCO currently ships through GitHub Releases first, with additional Linux channels planned after packaging quality is stable.

## GitHub Release

```bash
bash <(curl -s https://raw.githubusercontent.com/sergiopesch/voco/master/install)
```

Manual install:

```bash
wget https://github.com/sergiopesch/voco/releases/latest/download/voco_0.1.0_amd64.deb
sudo dpkg -i voco_0.1.0_amd64.deb
```

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

### Source install

Remove the built binary or bundle you installed, then remove local state if desired:

```bash
rm -rf ~/.config/voco ~/.local/share/voco ~/.cache/voco
```
