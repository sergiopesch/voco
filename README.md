<!-- markdownlint-disable MD031 MD033 MD041 -->
<p align="center">
  <img src="assets/voco-readme-banner.svg" alt="VOCO" width="560">
</p>
<!-- markdownlint-enable MD041 -->

<p align="center">
  <a href="#install"><img src="https://img.shields.io/badge/platform-Linux-black?style=flat-square&logo=linux&logoColor=white" alt="Linux"></a>
  <a href="https://github.com/sergiopesch/voco/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/sergiopesch/voco/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-5E6570?style=flat-square" alt="MIT License"></a>
</p>

VOCO is a local-first Linux dictation app. Press a hotkey, speak, press it again, and VOCO types at your cursor.

## Install

Recommended:

```bash
wget https://raw.githubusercontent.com/sergiopesch/voco/voco.2026.0.16/install -O voco-install
chmod +x voco-install
./voco-install
```

Optional:

```bash
less ./voco-install
```

Manual `.deb` fallback:

```bash
wget -O voco_latest_amd64.deb https://github.com/sergiopesch/voco/releases/latest/download/voco_latest_amd64.deb
sudo dpkg -i voco_latest_amd64.deb
```

Primary tested path: Ubuntu and Debian.

## Try It

1. Launch `VOCO` from your app menu or run `voco`.
2. Finish the short setup.
3. Press `Alt+D`.
4. Speak.
5. Press `Alt+D` again.
6. Confirm the text is inserted at your cursor.

## Requirements

- Ubuntu or Debian
- PulseAudio or PipeWire
- Wayland: `ydotool`, `wl-clipboard`, and access to the `input` group for the most reliable hotkey path
- X11: `xdotool` and `xclip`

## Run From Source

```bash
git clone https://github.com/sergiopesch/voco.git
cd voco
npm install
./scripts/setup.sh --install
npm run dev
```

## Useful Checks

```bash
npm run check
npm run lint
npm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run rehearse:release
npm run report:linux-runtime
```

## More Help

- [Install details](docs/install.md)
- [Testing](docs/testing/README.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Release process](docs/release-process.md)

## Notes

- First launch downloads the speech model once.
- Single dictation recordings are currently capped at 60 seconds.
- On Wayland, `Alt+D` and `Alt+Shift+D` are the most reliable hotkeys right now.
- Wayland text insertion depends on `ydotool`, compositor support, and often `input` group access.
- Config lives at `~/.config/voco/config.json`.

## License

MIT
