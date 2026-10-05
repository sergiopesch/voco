# VOCO branding

VOCO's lead message is **Your voice, typed. Built for Linux.** VOCO is local
English dictation: speech becomes text where you are typing, without an account,
a subscription or cloud transcription.

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
launcher icon drawn at 152 px, "BUILT FOR LINUX" in `#aeb5bf`, "VOCO" in
`#f1f3f6` and "Your voice, typed." in `#c7ccd4`. Its font falls back from Geist to
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

On GNOME 46, 48 and 50 the [companion](../integrations/gnome/README.md)
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

`scripts/lib/install-brand.json` defines the installer's four-glyph, five-row
wordmark and its palette: silver `199,204,212`, shine `241,243,246`, muted
`122,128,138`, complete `165,217,178` and active `239,206,131`. After editing it,
run `python3 scripts/sync-installer-ui.py`; `npm run verify:devops` fails if the
installer is out of sync.

| Terminal | Output |
| --- | --- |
| A terminal with colour, Bash 5 or later, at least 64 × 12 | A progress canvas: 14 lines with the block wordmark from 16 rows, otherwise 10 lines with "V O C O" |
| Anything else, `NO_COLOR`, `TERM=dumb` or `VOCO_INSTALL_PLAIN=1` | Plain lines under "VOCO · v<version>" and "Your voice, typed." |

The canvas marks stages with ✓ in green when done, › in amber while active and
○ in grey while waiting: Check, Download, Verify and Install. When a stage
begins, a brighter silver passes across the block letters, one every 125 ms. Downloads
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
