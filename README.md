<!-- markdownlint-disable MD033 MD041 -->
<p align="center"><img src="assets/voco-readme-banner.svg" alt="VOCO" width="560"></p>

# VOCO

Local Linux dictation: focus a text field, press the recording shortcut, and speak.
The current candidate uses NVIDIA Nemotron Speech Streaming English 0.6B, running
locally on the CPU, to append words while you speak. The tray shows recording state;
Stop flushes the remaining text without opening an automatic preview window.

**Testing candidate: 2026.0.35.** The application and Debian package use the same
version. Source is prepared for GitHub review; this is not a published release. Automated checks and
private desktop fixtures do not qualify every app or a physical Wayland session.
The owner will test this candidate before authorizing a release cut. See
[the candidate and release gates](docs/release-candidate.md).

## Everyday use

1. Launch VOCO, finish microphone setup, and focus the intended editable field.
2. Use the configured dictation shortcut (default `Alt+D`), then speak.
3. Keep the same field focused. Words appear after recognition and delivery latency.
4. Press the shortcut again to Stop. Review the final text before sending it.
5. If delivery is interrupted, open VOCO and review recovery before copying anything:
   the destination may already contain part of the transcript.

Desktop delivery uses the clipboard and a paste gesture. It replaces clipboard
text, leaves it there, and never presses Enter. Recognized terminals use their
terminal paste chord without editing application keybindings. Focus checks reduce
misdelivery but do not prove an exact widget or successful recipient paint. Protected,
read-only, custom, remote and rich editors need separate testing. Whole-message
rewriting after Stop is not supported by the generic paste route.

The Crystal Sidebar, rounded controls and glass surfaces are the current interface.
OS reduced motion, contrast and transparency preferences remain respected.
[Everyday use](docs/everyday-use.md) explains controls, recovery and optional modes.

## Install

For this candidate, use the verified complete local `.deb` and its SHA-256 receipt
provided with the candidate. A plain Tauri bundle does **not** contain the NVIDIA
runtime/model. Follow [candidate installation](docs/install.md#local-candidate).
Ubuntu x86_64 is the reference platform; other Debian-derived systems are best-effort.

The following guided installer is a **publication template**. It applies only after
that exact tag and its verified assets have been published; it does not fetch this
unpublished candidate:

```bash
wget https://raw.githubusercontent.com/sergiopesch/voco/voco.2026.0.35/install -O voco-install
chmod +x voco-install
less ./voco-install
./voco-install
```

The published-channel manual fallback likewise retrieves the published release,
which may differ from this candidate:

```bash
wget -O voco_latest_amd64.deb https://github.com/sergiopesch/voco/releases/latest/download/voco_latest_amd64.deb
wget https://github.com/sergiopesch/voco/releases/latest/download/voco_latest_checksums.txt
sha256sum --check voco_latest_checksums.txt
sudo apt install ./voco_latest_amd64.deb
```

AppImage, Flatpak, Snap and app-store scaffolding are not qualified release channels.
See [installation](docs/install.md) and [packaging](docs/linux-packaging.md).

## Privacy and diagnostics

Core dictation needs no account, subscription or remote transcription service.
The complete candidate bundles its English model. Legacy Whisper functionality,
optional localhost processing, OpenClaw and OpenAI Realtime remain separate paths.
Realtime sends microphone audio to OpenAI only when started; OpenClaw behavior
also depends on the user's configured provider. Automatic update checks contact
GitHub for release metadata.

`VOCO_PERFORMANCE_LOG=1` enables local application and speech-worker metrics.
They record stages, timing, counts and resource use, not dictated text, audio,
clipboard values, window titles or URLs. Explicit debug audio capture is separate
and persists sensitive recordings; do not enable it for routine diagnostics.
See [diagnostics](docs/testing/laptop-performance.md) and [security](docs/security/README.md).

## Development and evidence

Read [AGENTS.md](AGENTS.md), then [architecture](docs/architecture/README.md),
[testing](docs/testing/README.md), and [release candidate](docs/release-candidate.md).
The source snapshot and package have separate identities; do not equate a version
label with a verified build. Dependencies and full packaging steps are in the
installation and packaging guides. GitHub source excludes model weights and compiled
native runtime artifacts. The local candidate has the tested payload; a fresh clone
needs separately provisioned, pinned assets before NVIDIA tests or complete packaging.
See [runtime provisioning](docs/linux-packaging.md#runtime-provisioning).

```bash
npm ci
npm run verify:versions
npm run check
npm run lint
npm test
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
```

The [local model comparison](docs/testing/model-comparison-2026-09-14.md) records
seven configurations on the same three consented recordings. Nemotron is the live
candidate for this laptop. Research adapters are not installed model choices,
and callback timings are not measurements of words appearing at the cursor.

## License

Application source: [MIT](LICENSE). Bundled models and native libraries have their
own licenses and notices under [runtime/notices](runtime/notices/NOTICE); inspect
those terms before redistribution. No public release is authorized by this candidate.
