# VOCO branding

VOCO is **the voice layer for Linux**. Its manifesto says where VOCO is going and
where it starts:

> Dictation is the first step. We're building the voice layer for Linux:
> private, local, and under your control.

Today VOCO is local English dictation: speech becomes text where you are typing,
without an account, a subscription or cloud transcription.

## Message

| Line | Text | Where |
| --- | --- | --- |
| Brand line | The voice layer for Linux. | Banner, installer header, social cards, video end cards |
| Manifesto | Dictation is the first step. We're building the voice layer for Linux: private, local, and under your control. | README, release pages, launch posts |
| Summary | The voice layer for Linux, starting with dictation | Package, AppStream and desktop entry summaries, the GitHub description |
| Today | Today: private dictation for Linux. Press a shortcut, speak, and your words appear where you are typing, while you speak. | Directly after the brand line or manifesto |
| Today, short | Today: private dictation. | Where space is tight: the banner, the installer header, the release page |

Each pillar names only what is true today:

- **Private.** Speech stays on the computer. There's no account, subscription,
  telemetry or cloud transcription, and update checks only read GitHub's public
  releases.
- **Local.** The speech model runs on the processor, with no GPU, and nothing is
  downloaded after installation.
- **Under your control.** VOCO acts in your apps only when you ask. Today that
  means it listens only when you start it, shows that it's listening and never
  presses Enter. The principle stays as VOCO grows; its proof grows with each
  capability's safety rules.

VOCO's code is open source under the MIT license. Its speech model is NVIDIA
Nemotron, under the NVIDIA Open Model License, which isn't an open-source licence:
say "open source" only of the app, and name the model's licence wherever the model
is credited.

Lead with the mission, and say where VOCO is today in the same breath. The summary
does both in one line ("starting with dictation"). Everywhere else the Today line
follows the brand line or the manifesto directly, in its short form where space
is tight, so no reader mistakes the direction for what ships.

The brand line and the manifesto are VOCO's only statements of direction.
Everything else describes what VOCO does now, and a capability is named only
once it ships with evidence (see the claims rule in [AGENTS.md](../AGENTS.md)).
Never call VOCO the first, only, fastest or most accurate voice software, and
don't compare it with voice assistants.

## Voice

- Write calm, precise, brief copy in sentence case.
- Name the action: Start test, Finish test, Done, Change shortcut.
- Keep everyday controls visible and technical explanations in Help.
- Show recording, recovery and permission state when it matters. Never trade
  truthful state or safe recovery for shorter copy.
- A passed voice test never implies that desktop input is ready.

## Identity

The name is always VOCO, in capitals. The mark is an upright, front-facing
satin-silver microphone on graphite: quiet, precise desktop equipment. Don't
stretch the microphone, recolour its whole body to show status, or add details
that vanish at icon sizes.

| Asset | Use |
| --- | --- |
| `assets/voco-logo.png` | 1024 px primary master with a broad grille, for launcher icons above 64 px and promotional material |
| `assets/voco-symbol.png` | 1024 px optical master with three broad channels, for icons up to 64 px, headers and status images |
| `assets/voco-symbol-ui.png` | 128 px copy of the optical master, which the interface imports |
| `assets/voco-readme-banner.svg` | The README banner |

Both masters are square, with real alpha transparency. Keep the square canvas and
the aspect ratio, and don't add transparent padding. Check the 16, 24, 32, 48 and
128 px sizes on both light and dark backgrounds.

The banner is a 560 × 184 graphite card (`#111318`, 22 px corners) with the 256 px
launcher icon drawn at 152 px, "PRIVATE · LOCAL · UNDER YOUR CONTROL" in `#aeb5bf`,
"VOCO" in `#f1f3f6` and "The voice layer for Linux." in `#c7ccd4`. Its font falls back from Geist to
Inter, then the system sans serif.

Two third-party icon sets ship unmodified. The settings and chevron icons come
from GNOME's Adwaita theme, with `apps/desktop/public/icons/ADWAITA-LICENSE.txt`.
The settings navigation icons come from Lucide, in
`apps/desktop/public/icons/settings/` with their `LICENSE` and `SOURCE.md`.

## Colour, type and shape

`apps/desktop/src/styles.css` defines the palette:

| Token | Value | Token | Value |
| --- | --- | --- | --- |
| `--voco-bg` | `#090a0d` | `--voco-text` | `#ffffff` |
| `--voco-surface` | `#1a1d23` | `--voco-text-secondary` | `#c7ccd4` |
| `--voco-divider` | `#2b3038` | `--voco-text-muted` | `#8c929c` |
| `--voco-accent` | `#9ea4af` | `--voco-error` | `#ff5c7a` |
| `--voco-accent-active` | `#878e99` | `--voco-accent-highlight` | `#e1e5ec` |

Red is only for real errors. The interface uses Geist and Geist Mono, bundled
from `@fontsource`. Every VOCO window and control has rounded corners:
`--voco-radius-window` is 28 px and `--voco-radius-control` is 12 px.

Surfaces are smoked glass: a translucent tint, a thin silver edge and, where
WebKitGTK supports it, a backdrop blur of 18 px on the settings sidebar and 14 px
elsewhere. The blur samples VOCO's own window, not the desktop behind it. Behind
the glass, `apps/desktop/public/textures/settings-studio.webp` (1040 × 760) fills
Settings and `microphone-mesh.webp` the other windows. Their sources and prompts
are in `assets/brand-sources/`.

## Motion and accessibility

`apps/desktop/src/motion.css` uses 150 ms for feedback and 220 ms for settling,
eased with `cubic-bezier(.2, .8, .2, 1)`. Only a working indicator loops: its ring
turns every 1.1 s. Voice bars follow the measured microphone level with 75 ms
transitions; they never simulate speech.

- Reduced motion removes the animations and transitions.
- Reduced transparency or increased contrast replaces the glass and textures
  with solid surfaces.
- Forced colours switch to the system's colours.
- `StatusMark` is decorative and always sits beside readable text. Its states
  are idle, working, listening, success and attention.
- `DeviceSelect` is a labelled combobox and listbox. It supports the arrow keys,
  Home, End, typeahead, Enter, Space, Escape and Tab. Disabled devices can't be
  chosen, Escape closes it without a change, and choosing never starts capture.
- Tooltips open on hover and focus and close with Escape. Essential instructions
  stay on the page.

## Windows

The **popover** is 420 × 380 logical pixels. It shows the VOCO title with a
Settings button, the microphone, a status heading with its `StatusMark` and the
shortcut, and one cue:

| When | Cue |
| --- | --- |
| Setup needed | Open Help to finish desktop setup. |
| The shortcut works | Click where you want the text, then use your shortcut. |
| The shortcut is unavailable | Check shortcut setup in Help. |
| Otherwise | Click where you want the text, then start dictation. |

The popover never opens during a dictation. The main button is Hide to tray,
and the footer holds the microphone, which opens microphone settings, and
Help. Escape hides the popover.

**Settings** is 1040 × 760 and at least 760 × 560. Its sidebar has two groups:
Settings and Shortcut, then Updates and Help. The microphone controls are on the
Settings page. Hide to tray sits at the top right, with Back to setup beside it
until setup is complete.

**Setup** opens with "Say something. See it here." and a voice test: Start test,
then Finish test. The words appear only in that window. When desktop input needs
work, Done becomes Check desktop setup; only verified readiness shows "Your
voice, ready.", the shortcut and Done. Each phase moves keyboard focus to its
main action.

## Status

The microphone is never recoloured or animated. Status shows as a badge whose
shape and colour both change, or as live level bars, and text always says it too.

### Tray

`scripts/generate-icons.py` draws the 32 px tray icons in `apps/desktop/public/tray/`,
the microphone with a badge at its lower right: `ready.png` has a green check in a
shield, `processing.png` an amber hourglass in a diamond and `not-ready.png` an
amber exclamation mark in a triangle. While VOCO listens, the icon is five silver
level bars instead, redrawn every 90 ms from 64 frames the app draws at launch.

| Status line, after "VOCO — " | Icon | Label |
| --- | --- | --- |
| Initializing…, Checking speech model… | Processing | Starting VOCO |
| Ready to listen, Ready · microphone checks on first use | Ready | None |
| Starting microphone, Transcribing | Processing | None |
| Listening, Listening · browser field | Level bars | None |
| Desktop setup needed, Microphone setup required, Microphone needs permission, Speech model needs attention, Settings need attention, Needs attention | Not ready | Check setup |

Ready and dictating carry no label, so starting and stopping never shifts the
panel. The menu holds the status line, Open VOCO, Start dictation, Stop dictation,
Settings, Review, Change shortcut and Quit VOCO. While the microphone opens, Stop
dictation reads Stop after microphone starts.

### GNOME companion

On GNOME 46, 48, 50 and 51 the [companion](../integrations/gnome/README.md)
replaces the tray icon. It is one pill (3 px vertical margin, 11 px side
padding, fully rounded) that shares GNOME's hover, focus and open-menu
highlight, tinted `rgba(190, 198, 208, 0.14)` whenever VOCO isn't idle. The
20 px microphone comes last and never moves:

- From the moment the microphone starts until the text is ready, seven 2 × 14 px
  bars in `#dfe3e9` open on its left over 220 ms, in whole pixels, and only if
  the top bar has room beside the clock.
- Listening bars follow the measured level, rising in 45 ms and falling in
  100 ms. While VOCO processes they rest at 35% height and pulse over 700 ms.
- In the same place, the pill reads Starting VOCO while VOCO initializes and
  Check setup when something needs you.
- With GNOME's animations off, the bars and the pill change without motion.

A primary click stops dictation or opens Settings. Any other mouse button, the
Menu key or Shift+F10 opens the menu: Settings, Review and, while there is
something to stop, Stop dictation.

### Installer

`scripts/lib/install-brand.json` holds the installer's look: the card's graphite
`17,19,24`; the microphone; the four-glyph, five-row wordmark with its ten-step
satin gradient from `244,246,249` to `143,150,161`; the shine, sweep and text
colours; the progress palette (silver `199,204,212`, muted `122,128,138`,
complete `165,217,178` and active `239,206,131`); and the easing as 21 steps of
`cubic-bezier(.2, .8, .2, 1)`. `scripts/generate-installer-art.py` draws the
microphone from `assets/voco-symbol.png`: ffmpeg composites it onto the
graphite and scales it to 14 × 22 pixels, two to each half-block cell, so the
installer never reads an image. After editing either, run
`python3 scripts/sync-installer-ui.py`; `npm run verify:devops` fails if the
installer is out of sync.

| Terminal | Output |
| --- | --- |
| 24-bit colour (`COLORTERM` is `truecolor` or `24bit`), Bash 5 or later, at least 64 × 23 | The card: the microphone and the wordmark on graphite, with the version, "The voice layer for Linux." and "Today: private dictation.", above the progress lines; 21 lines in all |
| Any other colour terminal with Bash 5 or later, at least 64 × 12 | 10 lines under "V O C O" and "The voice layer for Linux. Today: private dictation." |
| Anything else, `NO_COLOR`, `TERM=dumb` or `VOCO_INSTALL_PLAIN=1` | Plain lines under "VOCO · v<version>" and "The voice layer for Linux. Today: private dictation." |

The card is graphite on every terminal background, with rounded edges. When it
first appears, a silver line crosses it and leaves the microphone behind it,
the letters glide in from the right and lock on the easing above, one shine
passes across them, and the tagline writes itself in: 1.3 s in all. The intro
only paints frames, about 30 a second, while the checks and the download go
on; an install that finishes sooner ends on the card at rest. Each later stage,
and the start of the download, passes one shine across the letters. The
microphone itself never changes colour, and once the card is at rest only the
progress lines are drawn again.

The canvas marks stages with ✓ in green when done, › in amber while active and
○ in grey while waiting: Check, Download, Verify and Install. Downloads
sample four times a second and show seven bars on a fixed log scale, the bytes
received and the average rate, without a percentage or time estimate. APT output
repaints at most every 0.1 s; DNF keeps its own output, and the canvas clears
before it starts. `VOCO_INSTALL_NO_MOTION=1`, or GNOME's animations
turned off, keeps the canvas still. The canvas gives way to plain text before any
password or package question.

## Regenerate the assets

From the repository root, with Python 3.10 or later and ffmpeg:

```bash
python3 scripts/prepare-brand-masters.py
python3 scripts/generate-icons.py
python3 scripts/generate-brand-banner.py
python3 scripts/generate-installer-art.py && python3 scripts/sync-installer-ui.py
```

The first script keys the green background out of the sources in
`assets/brand-sources/` and writes the two masters. The second writes the 32,
128 and 256 px launcher icons, a 64 px favicon, `voco-symbol-ui.png` and the tray
badges. The third embeds the 256 px icon in the banner. Inspect the transparency
afterwards.

## Check the presentation

`npm run test:brand-motion` renders the setup, popover, settings and Review
components with synthetic state in Playwright Chromium. It answers a few app
commands with fixtures and fails if the page opens a microphone or calls any
other command. `VOCO_RENDERER_EVIDENCE_DIR` must name a
directory that doesn't exist yet. Set `VOCO_MOTION_BROWSERS=chromium,webkit` to
add WebKit, and `VOCO_RENDERER_PORT` to move the test server from port 5189. In
development, `/tests/brand-motion.html` takes `surface=onboarding`, `popover`,
`settings` or `review`, and `state=starting`, `recording`, `processing`, `success`
or `error`. A browser preview doesn't show how WebKitGTK and the compositor draw
the native window, so check that on a real desktop.
