<!-- markdownlint-disable MD033 MD041 -->
<p align="center"><img src="assets/voco-readme-banner.svg" alt="VOCO" width="560"></p>

# VOCO

Speak. Your words appear at the cursor.

VOCO makes dictation on Linux simple and private. Speech
recognition runs on your computer. No account, subscription or cloud transcription.

- **Live dictation:** words and punctuation appear as you speak.
- **One shortcut:** press `Alt+D` to start, then again to stop.
- **Local English model:** NVIDIA Nemotron runs on the CPU; no GPU needed.
- **Live tray feedback:** volume bars follow your voice; Stop returns to Ready.

## Get started

Install the current public Ubuntu/Debian x86_64 release with one command:

```bash
wget -qO voco-install https://raw.githubusercontent.com/sergiopesch/voco/voco.2026.0.53/install && bash voco-install
```

The guided installer downloads **2026.0.53**, verifies the package checksum and
installs the package and required Wayland input helpers. Desktop readiness is
checked before onboarding finishes. If setup is incomplete, follow the
[desktop input setup](docs/platform/README.md#ydotoold-ydotool-daemon) instructions.
[Manual installation and signature verification](docs/install.md#published-release).

Ubuntu x86_64 is the reference platform. See the [installation guide](docs/install.md)
for setup, upgrades, source builds and Linux compatibility.
The [latest published release](https://github.com/sergiopesch/voco/releases/latest)
is authoritative for available downloads. [Release status](docs/release-candidate.md)
separates published assets from source and qualification work.

## Dictate anywhere you type

1. Open VOCO, choose **Start test**, speak, then **Finish test**. Choose **Done** to check desktop setup and finish.
2. Focus a text field, press `Alt+D`, and speak.
3. Press `Alt+D` again to finish. Review your text before sending it.

VOCO delivers text through clipboard paste and never presses Enter. Keep the same
field focused. Some protected or custom editors may not accept delivery; interrupted
transcripts stay available in VOCO for recovery. [Usage and recovery](docs/everyday-use.md).

## Privacy

Audio stays on your device. Optional local performance logs contain timings and
counts, not recordings or dictated text. Update checks contact GitHub.
[Diagnostics](docs/testing/laptop-performance.md) · [Security](docs/security/README.md).

Curious how it works? Explore the [visual code guide](docs/guide/README.md).
Compare the tested models in the [benchmark gallery](docs/release-assets/2026.0.43/README.md),
with full-resolution release graphics, exact values and methods.

## Native Linux packages

**2026.0.53** refreshes application dependencies while retaining the Signal +
Silver sweep installer, live tray bars, microphone setup in one canvas and the
same bundled recognizer.
Fedora, openSUSE and Arch/Omarchy packages remain at **2026.0.43**; download those
from their matching release. Install only assets attached to a published release.
Wayland uses native microphone capture so dictation can start with its panel
hidden; X11 keeps browser capture.
See the [support matrix](docs/linux-support.md),
[native package installation](docs/install-native.md) and
[.53 changes and qualification](docs/releases/2026.0.53.md).

## Contribute

Start with [development setup](docs/contributing.md), [the code map](docs/architecture/code-map.md)
and [AGENTS.md](AGENTS.md). Please follow the [code of conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities via the [security policy](SECURITY.md), not a public issue.
Tests and benchmark methods are indexed in [testing](docs/testing/README.md).

## License

VOCO is [MIT licensed](LICENSE). Bundled models and native libraries have
[their own licenses](runtime/notices/NOTICE).
