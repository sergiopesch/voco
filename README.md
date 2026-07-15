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
Realtime is voice-only in 2026.0.21: VOCO does not expose browser navigation, tabs, page content, or
browser mutations to the model.

## Install

Recommended:

```bash
wget https://raw.githubusercontent.com/sergiopesch/voco/voco.2026.0.21/install -O voco-install
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

Ubuntu is the primary reference and release-test environment. Debian-derived distributions are
best-effort: the `.deb` may work there, but they are not part of the regular desktop test matrix.

The published binary release channel is the GitHub Release `.deb`. AppImage publication is paused
until its complete Linux packaging toolchain can be pinned and verified; local experimental
AppImages do not install the host IBus component needed for live words at the cursor. Flatpak,
Flathub, Snap, and Ubuntu App Center are not published VOCO release channels.

## Try It

1. Launch `VOCO` from your app menu or run `voco`.
2. Finish the short setup.
3. In your desktop Input Sources settings, add and select `VOCO Dictation`.
4. Focus a normal, non-sensitive text field and press `Alt+D`.
5. Speak.
6. Press `Alt+D` again.
7. Confirm the text is inserted at your cursor.

To use OpenClaw mode, open Settings -> Output, choose `Ask OpenClaw and type answer` or `Ask OpenClaw and speak answer`, and keep the OpenClaw gateway/agent available from your shell environment. Spoken answers also require OpenClaw TTS and `ffplay`.

To use realtime conversation, store `OPENAI_API_KEY=...` in `~/.openclaw/realtime.env` and run
`chmod 600 ~/.openclaw/realtime.env`. VOCO accepts only a regular file owned by the current user
with no group or world access. Then press `Alt+Shift+R` or open the VOCO popover and press
`Start realtime`. Press `Alt+Shift+R` again or press `Stop realtime` to end the session. While
realtime is active, the VOCO mic visual appears in the popover or hidden overlay and follows both
your microphone level and the assistant's spoken response level.

Detailed realtime behavior, first-toggle guarantees, diagnostics, and QA criteria are defined in [`docs/realtime-conversation-spec.md`](docs/realtime-conversation-spec.md).

## Requirements

- Ubuntu; Debian-derived Linux is best-effort
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
- Live words at the cursor is the default for the Debian package when transcript enhancement is
  off. After the user explicitly enables and selects the persistent `VOCO Dictation` input source,
  rolling Whisper previews remain revisable inside a VOCO-owned IBus preedit. Separate authoritative
  30-second ASR chunks overlap by one second and checkpoint their exact append-only results at 30,
  59, 88 seconds, and so on. Those cached canonical chunks are the final truth; stopping catches up
  any deferred range, processes the remaining partial chunk, and commits the exact suffix.
- Live cursor eligibility is deliberately bound to the current focus. The exact real input context
  must freshly report established, non-sensitive content metadata and preedit support after every
  focus entry. Focus loss discards that proof; returning to the same context, or passing through a
  synthetic global-engine proxy, cannot reuse or renew it.
- IBus 1.5 global-engine mode does not resend an unchanged content tuple. Consecutive focuses that
  report the same tuple therefore stay preview-only until the current focus emits a changed,
  explicit safe tuple. Generic `FREE_FORM`/no-hint fields are ambiguous and always preview-only.
- Terminals, password/PIN fields, private or hidden-text inputs, and contexts with missing or
  ambiguous metadata are never eligible for live cursor streaming. Stable mode keeps those sessions
  in VOCO's visible preview and retains an unverified final for `Copy transcript`; `Live transcript
  panel` and `Final text only` remain explicit alternatives for the next dictation.
- Preview hypotheses never become normal target text merely because they look stable. Protocol v3
  verifies the previously acknowledged canonical prefix before every checkpoint. If a mutating IPC
  result is uncertain, VOCO closes the private channel and never retries that checkpoint or falls
  back to global keyboard insertion.
- Transcript enhancement modes keep live preview in VOCO's overlay and perform a one-shot final
  insertion after enhancement. They do not mix an enhanced final with unenhanced canonical cursor
  checkpoints.
- A live transcript panel and final-text-only mode remain available in Settings as fallbacks.
- Local model transcript enhancement and local assistant mode are opt-in and require a localhost model server.
- The realtime VOCO mic animation is driven by live input and output audio levels.
- VOCO never enables, selects, switches, or restores a desktop input source. The packaged engine is
  passive outside an active dictation and communicates with the app over a private same-user runtime
  socket using private protocol v3. If the component is absent, not selected, incompatible, or
  disconnected, stable mode visibly moves that session into VOCO's overlay instead of silently
  suppressing feedback or falling back to global keyboard injection. After stop, an unverified
  final remains recoverable in VOCO: the tray reports that the transcript needs attention and the
  popover offers `Copy transcript`. AppImage and uninstalled source builds do not provide the
  system IBus component.
- After an engine protocol upgrade, quit VOCO and run `ibus restart`, or sign out and back in,
  before reopening VOCO. Switching input sources alone does not reload the resident IBus engine.
- The tray derives its icon, tooltip, and actions from microphone, dictation, live-cursor, and
  realtime state together. Dictation and realtime voice are mutually exclusive. The popover does
  not start dictation because opening it takes focus from the target field; focus the target and use
  the configured dictation hotkey instead. `Escape` or focus loss dismisses the popover.
- Settings are saved as serialized field updates. The Rust backend reloads the latest config,
  persists the patch atomically, and returns and broadcasts the authoritative result, including
  hotkey changes made from the native tray menu. VOCO permits only one app process per user so a
  second launch cannot steal sockets, shortcuts, or configuration state. If settings cannot be
  loaded safely, a recovery panel can retry, open the local directory, or reset to defaults while
  preserving the previous entry as a timestamped backup.
- Custom dictation hotkeys must include Alt, Control, or Super plus a main key. Bare and Shift-only
  shortcuts are rejected so ordinary typing cannot accidentally start dictation.
- OpenClaw mode is opt-in and requires the `openclaw` CLI to be available in `PATH`.
- Realtime conversation is opt-in and is the only VOCO mode that streams microphone audio to
  OpenAI. It requires `OPENAI_API_KEY` in the environment or a private
  `~/.openclaw/realtime.env` file. The 2026.0.21 Realtime schema is voice-only and sends no browser
  URL, tab metadata, page content, or snapshot.
- VOCO automatically checks GitHub Releases for update metadata after startup and when the update
  channel changes, reusing successful results for up to six hours. These requests do not include
  audio or transcripts.
- Dictation audio and transcripts normally remain in memory. The developer-only
  `VOCO_DEBUG_CAPTURE_AUDIO=1` mode is an explicit exception: the first completed dictation in that
  app process is persisted as a WAV plus a JSON timeline containing transcript data under
  `${XDG_STATE_HOME:-$HOME/.local/state}/voco/debug-captures/`. The directory is `0700`, files are
  `0600`, and VOCO does not delete completed captures automatically.
- VOCO has no account or credentials in its core dictation flow. OpenAI and OpenClaw credentials are
  optional third-party secrets. `~/.openclaw/realtime.env` is outside VOCO's XDG state and may be
  shared with other tools, so VOCO never creates, changes, or removes it during uninstall.
- Config lives at `~/.config/voco/config.json`.

## License

MIT
