<!-- markdownlint-disable MD033 MD041 -->
<p align="center"><img src="assets/voco-readme-banner.svg" alt="VOCO" width="560"></p>

# VOCO

Local Linux dictation: focus a text field, press the recording shortcut, and speak.
The current candidate uses NVIDIA Nemotron Speech Streaming English 0.6B, running
locally on the CPU, to append words while you speak. The tray shows recording state;
Stop flushes the remaining text without opening an automatic preview window.

**2026.0.37 release cut: owner-approved English dictation, private draft.**
The owner tested and accepted +local7, then authorized the cut on 15 September 2026.
The cut preserves its application, model and helper bytes; Debian release metadata
and documentation are finalized separately. Public availability follows final
artifact benchmarks, remaining release gates and owner publication approval.
Read [the release-cut record](docs/releases/2026.0.37.md) and
[the keyboard optimization](docs/testing/keyboard-delivery-2026-09-15.md).

The frozen `+local5` passed normal dictation in five distribution userspaces but
failed delayed-reader Stop tests on X11. The private `+local6` candidate changes the scope of
the existing X11 shortcut during a recording, preserving focus and delivery checks.
The actor now waits for X11 events and commands instead of waking every 50 ms;
renderer-reload cleanup prevents an abandoned shortcut session from blocking the next start.
A subsequent correction keeps consuming X11 shortcut callbacks from being discarded
during an IBus poll; passive evdev retains its duplicate guard. Validation B's
startup failure remains recorded separately. C's strict isolated Stop matrix passed
34 selected cases from 35 attempts; the excluded attempt lacked required suffix
coverage. Normal dictation/shortcut continuation passed in five userspaces, selected
from eight attempts, with 65 model-protocol passes. Exact native package verification
is supplied through each artifact's external receipts; full-app renderer reload is
unqualified. No release or universal compatibility
claim follows. See [candidate status](docs/release-candidate.md),
[the current Stop-delivery review](docs/testing/stop-delivery-review-2026-09-15.md)
and [the frozen cross-Linux baseline](docs/testing/cross-linux-review-2026-09-15.md).

## Everyday use

1. Launch VOCO, finish microphone setup, and focus the intended editable field.
2. Use the configured dictation shortcut (default `Alt+D`), then speak.
3. Keep the same field focused. Words appear after recognition and delivery latency.
4. Press the shortcut again to Stop. Review the final text before sending it.
5. If delivery is interrupted, open VOCO and review recovery before copying anything:
   the destination may already contain part of the transcript.

Desktop delivery uses the clipboard and a paste gesture. It replaces clipboard
text, leaves it there, and never presses Enter. Recognized terminals use their
terminal paste chord without editing application keybindings. Eligible accessible text fields are sampled after each paste before another chunk can replace the clipboard. Unsupported targets retain best-effort dispatch. This is not atomic field ownership or compositor paint evidence. Protected,
read-only, custom, remote and rich editors need separate testing. Whole-message
rewriting after Stop is not supported by the generic paste route.

The Crystal Sidebar, rounded controls and glass surfaces are the current interface.
OS reduced motion, contrast and transparency preferences remain respected.
[Everyday use](docs/everyday-use.md) explains controls, recovery and optional modes.

## Install

For this candidate, use the verified complete local `.deb` and its SHA-256 receipt
provided with the candidate. A plain Tauri bundle does **not** contain the NVIDIA
runtime/model. Follow [candidate installation](docs/install.md#local-candidate).
Ubuntu x86_64 remains the reference platform. The frozen `+local5` application passed
normal tests in five distribution userspaces. Validation C also passed five userspace
cases from eight attempts, with each actual shortcut route checked. These
checks do not qualify default desktops or every target application. RPM and Arch packaging are private candidate work, not published
channels. See the [current test scope](docs/testing/cross-linux-review-2026-09-15.md#baseline-userspace-results).

The following guided installer is a **publication template**. It applies only after
that exact tag and its verified assets have been published; it does not fetch this
unpublished candidate:

```bash
wget https://raw.githubusercontent.com/sergiopesch/voco/voco.2026.0.37/install -O voco-install
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
The complete candidate bundles its English model. Normal cursor dictation with
enhancement off warms NVIDIA at startup; it does not implicitly download Whisper.
Readiness follows a successful worker warmup. Legacy Whisper functionality,
optional localhost processing, OpenClaw and OpenAI Realtime remain separate paths.
Realtime sends microphone audio to OpenAI only when started; OpenClaw behavior
also depends on the user's configured provider. Automatic update checks contact
GitHub for release metadata.

`VOCO_PERFORMANCE_LOG=1` enables local application and speech-worker metrics.
Worker metrics reject unsafe directory/file targets, including symlinks and
non-regular files; logging failure disables those metrics without stopping recognition.
They record stages, timing, counts and resource use, not dictated text, audio,
clipboard values, window titles or URLs. Explicit debug audio capture is separate
and persists sensitive recordings; do not enable it for routine diagnostics.
See [quality attribution](docs/testing/dictation-quality.md), [diagnostics](docs/testing/laptop-performance.md) and [security](docs/security/README.md).
Fresh dependency audits found no vulnerability-class advisories; seven upstream
maintenance and two unsoundness notices remain documented, without waivers.

## Development and evidence

Read [AGENTS.md](AGENTS.md), the [code map](docs/architecture/code-map.md), then [architecture](docs/architecture/README.md),
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
