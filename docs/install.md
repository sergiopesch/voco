# Install

VOCO ships through GitHub Releases first. The `.deb` is the main install path. The AppImage is a secondary manual option.

## Recommended: guided installer

1. Pick the release tag you want:

```bash
TAG="voco.<version>"
```

2. Download the installer:

```bash
wget "https://raw.githubusercontent.com/sergiopesch/voco/${TAG}/install" -O voco-install
chmod +x voco-install
```

3. Optional: inspect it first:

```bash
less ./voco-install
```

4. Run it:

```bash
./voco-install
```

The installer checks Linux requirements, downloads the exact package, verifies checksums, installs VOCO, and lets you pick the first hotkey.

## Manual `.deb` install

1. Download the package and checksums:

```bash
wget -O voco_<version>_amd64.deb https://github.com/sergiopesch/voco/releases/download/voco.<version>/voco_<version>_amd64.deb
wget https://github.com/sergiopesch/voco/releases/download/voco.<version>/voco_checksums.txt
```

2. Verify the package:

```bash
grep ' voco_<version>_amd64.deb$' voco_checksums.txt | sha256sum --check
```

3. Install it:

```bash
sudo dpkg -i voco_<version>_amd64.deb
```

## Run from source

1. Clone the repo:

```bash
git clone https://github.com/sergiopesch/voco.git
cd voco
```

2. Install dependencies:

```bash
npm install
./scripts/setup.sh --install
```

3. Start the app:

```bash
npm run dev
```

4. Test it:
- allow microphone access
- finish setup
- press `Alt+D`
- speak
- press `Alt+D` again
- confirm text is inserted at the cursor

## Release asset names

- tag: `voco.<version>`
- Debian package: `voco_<version>_amd64.deb`
- AppImage: `VOCO-<version>-x86_64.AppImage`

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

Before cutting a release:

```bash
npm run rehearse:release
```

This checks version alignment, install-script safety, and generated release notes.

## Runtime Paths

- Config: `~/.config/voco/config.json`
- Models: `~/.local/share/voco/models/`
- Socket: `$XDG_RUNTIME_DIR/voco.sock` when `XDG_RUNTIME_DIR` is set, otherwise `${TMPDIR:-/tmp}/voco-$(id -u)/voco.sock`

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
