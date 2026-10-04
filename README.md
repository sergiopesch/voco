<!-- markdownlint-disable MD033 MD041 -->
<p align="center"><img src="assets/voco-readme-banner.svg" alt="VOCO" width="560"></p>

# VOCO

[![CI](https://github.com/sergiopesch/voco/actions/workflows/ci.yml/badge.svg)](https://github.com/sergiopesch/voco/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Private dictation for Linux. Press a shortcut, speak, and your words appear
where you are typing.

- **Speech stays on your computer.** An English speech model runs on your
  processor. You don't need a GPU, an account or a cloud service.
- **Types into the app you are using.** VOCO pastes into whichever app has
  keyboard focus, including browsers and terminals.
- **Words appear while you speak,** with punctuation and capital letters.
- **One shortcut.** Press `Alt+D` to start and again to finish. VOCO never
  presses Enter.
- **Stays out of the way** in the system tray, or in the GNOME top bar with live
  microphone bars.
- **Keeps your words.** If a paste fails, VOCO copies the rest of your words to
  the clipboard. If VOCO closes unexpectedly, Review gives your text back.

## Get started

Install the current release, 2026.0.59, from a terminal in your desktop session:

```bash
wget -qO voco-install https://raw.githubusercontent.com/sergiopesch/voco/voco.2026.0.59/install && bash voco-install
```

The installer checks the release signature against its built-in VOCO key and
verifies the package checksum, then installs VOCO with APT, checks desktop input
and opens VOCO. To verify by hand, upgrade or remove VOCO, see
[Install VOCO](docs/install.md).

## Your first dictation

VOCO opens with a short voice test.

1. Choose **Start test** and say a sentence. Your words appear in the window.
2. Choose **Finish test**.
3. Choose **Done**. If the button says **Check desktop setup**, choose it first
   and follow any instructions VOCO shows.
4. Click where you want the text in another app, press `Alt+D` and speak. Press
   `Alt+D` again to finish.

VOCO pastes through the clipboard, so dictation replaces what you copied last.
Text goes to whichever window has keyboard focus. See
[Everyday use](docs/everyday-use.md) for the tray, shortcuts and Review.

## Requirements

- A 64-bit Intel or AMD processor with AVX2, FMA and F16C
- Ubuntu 24.04 or later, or another Debian-based system with glibc 2.39 or later
- An X11 or Wayland desktop session and a microphone
- On Wayland, access to `/dev/uinput`, which the package gives the user of the
  active local session
- On Wayland desktops other than GNOME 46, a desktop keyboard shortcut that runs
  `voco --toggle`

The reference desktop is Ubuntu 24.04 with GNOME 46.

## Privacy

- Recognition runs on your computer. Audio never leaves it, and VOCO doesn't
  save audio in normal use.
- VOCO has no account and no telemetry. Its only network request checks GitHub
  for new releases. It never downloads or installs updates.
- Each phrase passes through the clipboard, and the last one stays there.
  Clipboard managers may keep a copy.
- While you dictate, VOCO keeps a private copy of the text so it can recover it
  after a crash. It deletes that copy when the dictation ends normally.
- Diagnostic logs are off unless you turn them on.

See [What VOCO keeps](docs/everyday-use.md#what-voco-keeps) and the
[security model](docs/security/README.md).

## Documentation

- [Documentation index](docs/README.md)
- [Install VOCO](docs/install.md)
- [Everyday use](docs/everyday-use.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Platform support](docs/platform/README.md)
- [Inside VOCO: a visual tour](docs/guide/README.md)

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), then
read [AGENTS.md](AGENTS.md) and the [code map](docs/architecture/code-map.md).
Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

Report security problems privately, as described in [SECURITY.md](SECURITY.md).

VOCO is released under the [MIT License](LICENSE). The bundled speech runtime
and model come with their own notices and license terms, starting with
[runtime/notices/NOTICE](runtime/notices/NOTICE).
