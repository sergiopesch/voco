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

VOCO can also run as an optional voice bridge for OpenClaw: speak locally, let VOCO transcribe on-device, then send the transcript to a configured OpenClaw CLI agent and type the agent's answer at your cursor.

VOCO can optionally polish transcripts or ask a local model through an OpenAI-compatible localhost endpoint, such as `llama-server`. This is bring-your-own-model; the default dictation path remains local Whisper transcription and direct insertion.

For low-latency back-and-forth voice, VOCO also has an opt-in realtime conversation toggle. It keeps the OpenAI API key in the local Tauri backend, mints a short-lived Realtime token, and streams 24 kHz PCM audio over a WebSocket so the Linux WebView does not depend on WebRTC support.

## Install

Recommended:

```bash
wget https://raw.githubusercontent.com/sergiopesch/voco/voco.2026.0.19/install -O voco-install
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
wget https://github.com/sergiopesch/voco/releases/latest/download/voco_latest_checksums.txt
sha256sum --check voco_latest_checksums.txt
sudo apt install ./voco_latest_amd64.deb
```

Primary tested path: Ubuntu and Debian.

## Try It

1. Launch `VOCO` from your app menu or run `voco`.
2. Finish the short setup.
3. In your desktop Input Sources settings, add and select `VOCO Dictation`.
4. Focus the target text field and press `Alt+D`.
5. Speak.
6. Press `Alt+D` again.
7. Confirm the text is inserted at your cursor.

To use OpenClaw mode, open Settings -> Output, choose `Ask OpenClaw and type answer` or `Ask OpenClaw and speak answer`, and keep the OpenClaw gateway/agent available from your shell environment. Spoken answers also require OpenClaw TTS and `ffplay`.

To use realtime conversation, store `OPENAI_API_KEY=...` in `~/.openclaw/realtime.env`, then press `Alt+Shift+R` or open the VOCO popover and press `Start realtime`. Press `Alt+Shift+R` again or press `Stop realtime` to end the session. While realtime is active, the VOCO mic visual appears in the popover or hidden overlay and follows both your microphone level and the assistant's spoken response level.

Detailed realtime behavior, first-toggle guarantees, diagnostics, and QA criteria are defined in [`docs/realtime-conversation-spec.md`](docs/realtime-conversation-spec.md).

## Requirements

- Ubuntu or Debian
- PulseAudio or PipeWire
- IBus, `python3-gi`, and `gir1.2-ibus-1.0` for live words at the cursor
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
- Single dictation recordings are currently capped at 10 minutes.
- On Wayland, `Alt+D` and `Alt+Shift+D` are the most reliable hotkeys right now.
- Realtime conversation uses `Alt+Shift+R`.
- Live words at the cursor is the default for the Debian package: after the user explicitly enables
  and selects the persistent `VOCO Dictation` input source, VOCO keeps only the changing
  tail in an owned IBus preedit range and progressively commits stable phrases as normal target-app
  text so the field can wrap and lay them out natively. Generic IBus surrounding text is cached and
  cannot prove a fresh editor revision, so VOCO never deletes or rewrites progressively committed
  text. If the authoritative final differs from those normal target-app commits, VOCO preserves the
  target and keeps the final transcript in VOCO. Timestamped Whisper segments keep the bounded
  preview window anchored so long dictations cannot skip audio.
- A live transcript panel and final-text-only mode remain available in Settings as fallbacks.
- Local model transcript enhancement and local assistant mode are opt-in and require a localhost model server.
- The realtime VOCO mic animation is driven by live input and output audio levels.
- VOCO never enables, selects, switches, or restores a desktop input source. The packaged engine is
  passive outside an active dictation and communicates with the app over a private same-user runtime
  socket. If the component is absent, not selected, incompatible, or disconnected, stable mode
  remains preview-only for the session and does not fall back to global keyboard injection. AppImage
  and uninstalled source builds do not provide the system IBus component.
- OpenClaw mode is opt-in and requires the `openclaw` CLI to be available in `PATH`.
- Realtime conversation is opt-in and requires `OPENAI_API_KEY` in the environment or `~/.openclaw/realtime.env`.
- Config lives at `~/.config/voco/config.json`.

## License

MIT
