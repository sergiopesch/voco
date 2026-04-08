<!-- markdownlint-disable MD031 MD033 MD041 -->
<p align="center">
  <img src="assets/voco-readme-banner.svg" alt="VOCO" width="560">
</p>
<!-- markdownlint-enable MD041 -->

<p align="center">
  <a href="#requirements"><img src="https://img.shields.io/badge/platform-Linux-black?style=flat-square&logo=linux&logoColor=white" alt="Linux"></a>
  <a href="https://github.com/sergiopesch/voco/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/sergiopesch/voco/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-5E6570?style=flat-square" alt="MIT License"></a>
</p>

---

VOCO is a Linux local-first voice interface for fast control and insertion at the cursor. It lives in your tray, listens on demand while keeping audio local.

## Install

### Guided VOCO Installer

```bash
wget https://raw.githubusercontent.com/sergiopesch/voco/voco.2026.0.11/install -O voco-install
chmod +x voco-install
less ./voco-install
./voco-install
```

This is the primary install path. It keeps the VOCO-branded setup flow at the center of the experience by:
- checking Linux runtime requirements up front
- downloading the exact release package and checksums
- verifying the package before install
- guiding the initial hotkey setup before first launch

Primary tested path: Ubuntu and Debian.

### Manual `.deb` Fallback

```bash
wget -O voco_latest_amd64.deb https://github.com/sergiopesch/voco/releases/latest/download/voco_latest_amd64.deb && sudo dpkg -i voco_latest_amd64.deb
```

Use this only if you explicitly want the raw package path instead of the guided installer.

### Build from source

```bash
git clone https://github.com/sergiopesch/voco.git && cd voco && ./scripts/setup.sh --install
```

Checksums, AppImage notes, packaging status, and uninstall steps live in [docs/install.md](docs/install.md).

## How It Works

1. Launch `VOCO` from your app launcher or run `voco`.
2. Press `Alt+D` to start listening.
3. Press `Alt+D` again and VOCO types the transcript at your cursor.

VOCO stays in the tray, shows a compact listening HUD, and opens with a branded first-run setup for microphone access, hotkeys, Linux insertion strategy, and tray workflow.

## Features

- Local-first transcription with `whisper.cpp`
- Tray-native workflow with clear ready, listening, and blocked states
- Default `Alt+D` hotkey with runtime configuration
- Branded onboarding for microphone, hotkey, insertion strategy, and tray workflow
- Text insertion with documented Wayland and X11 behavior
- In-app GitHub Release update checks for manual installs

## Requirements

- Ubuntu or Debian
- PulseAudio or PipeWire
- Wayland: `ydotool` and `wl-clipboard`
- X11: `xdotool` and `xclip`

Other Linux distributions may work, but VOCO is validated on Ubuntu-class environments first.

## Configuration

VOCO stores configuration at `~/.config/voco/config.json`.

```json
{ "hotkey": "Alt+D", "insertionStrategy": "auto" }
```

Existing `voice` installs are migrated automatically on startup:
- `~/.config/voice/config.json` -> `~/.config/voco/config.json`
- `~/.local/share/voice/models/` -> `~/.local/share/voco/models/`

On Wayland, `Alt+D` and `Alt+Shift+D` remain the most reliable built-in presets because they can use the evdev backend.
The first-run flow tailors setup around your Linux desktop session and install channel, while keeping all configuration local on disk.

## Development

```bash
git clone https://github.com/sergiopesch/voco.git && cd voco && ./scripts/setup.sh && npm run dev
```

Useful checks:

```bash
npm run check
npm run lint
npm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run rehearse:release
npm run report:linux-runtime
```

## Documentation

- [docs/install.md](docs/install.md)
- [docs/linux-packaging.md](docs/linux-packaging.md)
- [docs/submission-readiness.md](docs/submission-readiness.md)
- [docs/store-listing.md](docs/store-listing.md)
- [docs/release-process.md](docs/release-process.md)
- [docs/testing/README.md](docs/testing/README.md)
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [docs/contributing.md](docs/contributing.md)
- [docs/architecture/README.md](docs/architecture/README.md)

## Known Limitations

- Wayland text insertion still depends on compositor support and `ydotool`.
- Some Linux shells render tray icons monochrome, reducing the effect of accent colors.
- First launch downloads the speech model once before VOCO can run fully offline.
- The onboarding microphone meter is a setup aid, not a calibrated studio meter.

## License

MIT
