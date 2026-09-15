# Install

Current cut: the owner accepted installed +local7 and authorized the private
2026.0.37 release cut. See [status and remaining public gates](releases/2026.0.37.md).
Earlier candidate preparation/deferral statements below are historical. The owner's
installed application remains +local7 until a separately requested update.

Current follow-up: private **+local7** contains the [bounded legacy keyboard optimization](testing/keyboard-delivery-2026-09-15.md). +local6 was installed and successfully owner-tested. Older revision results below remain historical; use exact artifact receipts for the new candidate.

The current source is an unpublished `2026.0.37` local candidate. Published-channel
commands below do not install it. Read [candidate gates](release-candidate.md) first.
The owner now runs verified `+local6`; `+local4` was an earlier isolated baseline. The private `+local6` candidate preserves `+local5` as the
historical failed Stop baseline. Validation C passed 34 selected Stop cases from
35 attempts, five userspace continuation cases from eight attempts, and all 65
model-protocol cases. See [the current review](testing/stop-delivery-review-2026-09-15.md)
for scope and remaining gaps. Each supplied package requires its external exact-SHA
and install/parity/remove receipts. These instructions do not resume installation
on the owner's laptop.

## Local candidate

Verify the complete local package against its supplied SHA-256 receipt, inspect
`dpkg-deb -f /path/to/candidate.deb Version`, then install the verified file with
`sudo apt install /path/to/candidate.deb`. Use an absolute real artifact path; no
release tag exists merely because a candidate version is documented. Quit VOCO
normally first; in-memory recovery is lost on exit, so copy needed text beforehand.
An upgrade preserves user configuration and avoids a destructive purge. Reopen VOCO
and verify executable/package identity and worker readiness before testing.

The complete package bundles the NVIDIA Nemotron English Q8 model and its CPU
runtime under `/usr/lib/voco/speech`; no NVIDIA GPU or cloud account is required.
A base Tauri `.deb` alone omits that payload. The assembler and verification steps
are in [Linux packaging](linux-packaging.md#complete-nvidia-candidate).

Desktop paste and streaming default on (launcher overrides `VOCO_DESKTOP_PASTE=0`
and `VOCO_DESKTOP_STREAM=0` disable their respective paths). Inspect old per-user
launchers when diagnosing mismatched runtime or logging behavior. Installation does
not qualify each destination, change application keybindings, or authorize release.

For Cursor output with enhancement Off and both desktop paths enabled, the backend
warms the bundled NVIDIA runtime and marks readiness only after a successful worker
response. The default startup does not prepare or download Whisper. A configured
legacy path or later explicit legacy transcription still ensures that separate model.
A failed NVIDIA warmup reports a model problem instead of silently downloading Whisper.

The [current userspace tests](testing/stop-delivery-review-2026-09-15.md) distinguish application
userspace checks from native package installation and physical desktop qualification.
RPM/Arch candidates need their own external native verification receipts; do not
use the Debian installer on those systems or infer a published support channel.


VOCO ships through GitHub Releases first. Ubuntu is the primary reference and release-test
environment; Debian-derived distributions are best-effort. The published binary artifact is the
`.deb`. AppImage publication is paused until every packaging helper is supplied from an immutable,
checksum-pinned source; local experimental AppImages do not install the host IBus component.
Flatpak, Flathub, Snap, and Ubuntu App Center are not published VOCO release channels.

## Recommended: guided installer

1. Pick the release tag you want:

```bash
TAG="voco.<version>"
```

2. Download the installer:

```bash
wget "https://raw.githubusercontent.com/sergiopesch/voco/${TAG}/install" -O voco-install
chmod +x voco-install
```

3. Optional: inspect it first:

```bash
less ./voco-install
```

4. Run it:

```bash
./voco-install
```

The installer checks Linux requirements, downloads the exact package, verifies checksums, installs VOCO, and lets you pick the first hotkey.

On Wayland, the installer keeps the first-run choice conservative: `Alt+D` stays the default and `Alt+Shift+D` is the supported alternate because those are currently VOCO's most reliable hotkeys there.

## Manual `.deb` install

1. Download the package and checksums:

```bash
VERSION="<published-version>"
TAG="voco.${VERSION}"
wget -O "voco_${VERSION}_amd64.deb" \
  "https://github.com/sergiopesch/voco/releases/download/${TAG}/voco_${VERSION}_amd64.deb"
wget "https://github.com/sergiopesch/voco/releases/download/${TAG}/voco_checksums.txt"
```

2. Verify the package:

```bash
grep " voco_${VERSION}_amd64.deb$" voco_checksums.txt | sha256sum --check -
```

3. Install it:

```bash
sudo apt install "./voco_${VERSION}_amd64.deb"
```

## Recording and optional direct browser delivery

The foundations build transcribes locally and remains in the tray during recording
and processing, without an automatic transcript preview. Without native paste enabled,
use the explicitly opened transcript/recovery controls for Copy. Installing this build
does not change your selected input source, browser profile, or desktop services.

For the current default native streaming route, recognized words replace the clipboard
and are pasted progressively into the currently focused field. Stop flushes the tail.
Set `VOCO_DESKTOP_STREAM=0` for the separate final-only path.
Keep that field focused until completion. It sends no Enter key and makes no uncertain
retry. See [desktop paste](testing/desktop-paste.md) for compatibility and policy details.
GNOME Wayland uses the XWayland clipboard bridge (`xclip`, packaged dependency) and
`ydotool` with its running daemon. Other Wayland desktops use `wl-copy`; X11 needs
`xclip` and `xdotool`. Helper availability does not prove editor acceptance.

The package includes the optional `VOCO Dictation` IBus component. Selecting it in
Input Sources can consume the native recording shortcut before the application sees
it. IBus protocol 5 deliberately rejects all text mutation: its context cannot prove
which application widget would receive an edit. Without the separately enabled desktop-paste route, native shortcuts produce
manual-copy transcripts. Restart IBus or sign out after an engine upgrade to load
its new protocol; the installer does not do that for you.

For direct delivery in Chromium, follow the [extension setup](../integrations/chromium/README.md).
The `.deb` provides `/usr/libexec/voco-browser-host`, the fixed native messaging
registrations for Chrome/Chromium, and `/usr/share/voco/chromium`. Load that
extension directory through the browser's developer-mode **Load unpacked** control.
This is a development integration; no browser-store listing has been published.
Click its toolbar button to enable the current tab, then focus a supported plain
text field and press `Alt+Shift+V` to start/stop. The ordinary `Alt+D` shortcut uses the configured native route; it is separate
from browser exact-field delivery and can conflict with application shortcuts. Browser packaging that cannot access the host binary (for
example a confined browser) is not verified by this integration.

Only top-frame textareas and text/search/url/tel inputs with a collapsed caret are
supported. Passwords, rich editors, iframes and private-marked fields are rejected.
Focus loss, field replacement, editing, expired tokens and uncertain receipts stop
automatic delivery. Copy recovery retains the transcript and warns if the original
field may already contain part. Native browser undo history is not guaranteed by
this exact-element edit API. See the contract before enabling it on a page.

## Run from source

1. Clone the repo:

```bash
git clone https://github.com/sergiopesch/voco.git
cd voco
```

2. Install dependencies:

```bash
npm install
./scripts/setup.sh --install
```

3. For NVIDIA streaming, separately provision the pinned model and native runtime
   described in [runtime provisioning](linux-packaging.md#runtime-provisioning).
   GitHub source excludes these large/compiled artifacts; the tested local candidate
   already includes them. Missing assets are not a working NVIDIA installation.

4. Start the app:

```bash
npm run dev
```

5. Test it:

- allow microphone access
- finish setup
- build the `.deb` with `bash scripts/build-desktop.sh`
- press `Alt+D`
- speak
- press `Alt+D` again
- verify progressive delivery, final tail and recovery in a disposable test field
- keep single dictation recordings under 10 minutes

## Wayland Hotkey and Permission Notes

- The most reliable Wayland hotkeys right now are `Alt+D` and `Alt+Shift+D`.
- Custom hotkeys may fall back to a less reliable backend on Wayland.
- For the evdev hotkey path, many Linux setups also require your user to be in the `input` group.

## Release asset names

- tag: `voco.<version>`
- Debian package: `voco_<version>_amd64.deb`
- Experimental local AppImage: `VOCO-<version>-x86_64.AppImage` (not currently published)

## Flatpak / Flathub Preparation

VOCO now includes an initial Flatpak packaging baseline under `packaging/flatpak/`.

When testing locally with `flatpak-builder`, start from:

```bash
flatpak-builder --user --install --force-clean build-flatpak packaging/flatpak/com.sergiopesch.voco.yml
```

This path is still packaging work in progress. Treat it as a local validation path before Flathub submission, not a finished public channel.

## Snap / Ubuntu App Center Status

VOCO now includes a tracked Snap draft under `snap/`.

Current note:

- local packaging work now lives in `snap/snapcraft.yaml`
- the Ubuntu App Center path still needs local install validation, runtime smoke tests, and store review
- classic confinement is the honest current fit because VOCO depends on host-level hotkeys, text insertion, notifications, and URL opening
- treat this as packaging work in progress, not an available install path yet

Local build entry point:

```bash
cd snap
snapcraft --destructive-mode
```

This currently assumes either:

- a root-capable `snapcraft --destructive-mode` environment, or
- an LXD-backed Snapcraft setup

## AppImage Fallback Packaging

Default `npm run build` produces only the locked Debian bundle and does not enter Tauri's AppImage
toolchain. AppImage work is an explicit local experiment until the full linuxdeploy chain is pinned.
The final fallback completes only when `VOCO_APPIMAGETOOL_PATH` and
`VOCO_APPIMAGETOOL_SHA256` identify an independently verified local `appimagetool`; it never
downloads a replacement implicitly.

If an explicit experimental Tauri AppImage run already produced `VOCO.AppDir` under
`apps/desktop/src-tauri/target/release/bundle/appimage/`, finish it manually with:

```bash
VOCO_APPIMAGETOOL_PATH=/path/to/pinned/appimagetool \
VOCO_APPIMAGETOOL_SHA256=<verified-sha256> \
bash ./scripts/package-appimage.sh
```

This path is intended for packaging validation when the AppDir exists but the final AppImage
artifact was not written. The helper does not download or execute a mutable tool; provide an
independently verified binary and digest explicitly.

## Release Rehearsal

Before cutting a release:

```bash
npm run rehearse:release
```

This checks version alignment, install-script safety, and generated release notes.

## Runtime Paths

- Config: `~/.config/voco/config.json`
- Update result cache: `~/.config/voco/update-cache.json`
- Legacy Whisper models: `~/.local/share/voco/models/`
- Packaged NVIDIA model/runtime: `/usr/lib/voco/speech/`
- Privacy-safe timing trace: `${XDG_STATE_HOME:-$HOME/.local/state}/voco/hotkey-trace.jsonl`
- Optional debug captures: `${XDG_STATE_HOME:-$HOME/.local/state}/voco/debug-captures/`
- Trigger socket: `$XDG_RUNTIME_DIR/voco.sock` when `XDG_RUNTIME_DIR` is set, otherwise `${TMPDIR:-/tmp}/voco-$(id -u)/voco.sock`; runtime/fallback directories must pass ownership, privacy and real-directory checks. Invalid existing paths are rejected without chmod or unlink. The legacy `voice.sock` alias uses the same protections.
- Persistent IBus control socket: `$XDG_RUNTIME_DIR/voco/ibus-engine.sock` (owner-only; no `/tmp` fallback)

OpenClaw voice-bridge settings are stored in the same config file. That mode is opt-in and requires the `openclaw` CLI to resolve from the app's runtime `PATH`. The spoken-answer OpenClaw mode also requires OpenClaw TTS to be configured and `ffplay` from FFmpeg to resolve from `PATH`.

Local transcript enhancement and the local assistant output target are also opt-in. They require an OpenAI-compatible local model server, such as `llama-server`, listening on a localhost endpoint like `http://127.0.0.1:8080/v1/chat/completions`. VOCO does not bundle or download Gemma/llama models for this path.
Expected behavior and acceptance criteria are documented in [`local-intelligence-spec.md`](local-intelligence-spec.md).

Realtime conversation is separate from the OpenClaw text/TTS bridge and is toggled with
`Alt+Shift+R` or the popover's `Start realtime` button. It requires `OPENAI_API_KEY` in the app
environment or in `~/.openclaw/realtime.env`; VOCO reads that key only in the Tauri backend, mints a
short-lived Realtime token, and streams microphone audio over `wss://api.openai.com`. On Unix, VOCO
accepts the key file only when it is a regular file owned by the current user with no group or world
access:

```bash
install -d -m 700 "$HOME/.openclaw"
(
  umask 077
  ${EDITOR:-nano} "$HOME/.openclaw/realtime.env"
)
chmod 600 "$HOME/.openclaw/realtime.env"
```

Add one line in the editor: `OPENAI_API_KEY=...`. While realtime is active, the VOCO mic visual
appears in the hidden overlay or popover and follows both microphone input and assistant playback
levels. Core dictation does not use this key or send microphone audio to OpenAI.

Detailed realtime behavior, diagnostics, and acceptance criteria are documented in [`realtime-conversation-spec.md`](realtime-conversation-spec.md).

VOCO automatically requests GitHub Releases metadata after startup and when the selected update
channel changes. A successful result is cached for up to six hours. The request contains no audio
or transcript data; Settings also provides a manual check.

Developer audio capture is off by default. Starting VOCO with `VOCO_DEBUG_CAPTURE_AUDIO=1` saves
only the first completed dictation in that app process as a 16 kHz mono WAV and a JSON timeline
containing transcript and cursor diagnostics. The files persist under the debug-capture runtime path
above until explicitly deleted. The directory is `0700` and files are created at `0600`.

Legacy `voice` config and model paths are migrated automatically on startup when possible.

## Uninstall

### `.deb`

Disable or switch away from `VOCO Dictation` in Input Sources first, then remove the package. VOCO
does not alter per-user input-source settings during uninstall.

```bash
sudo apt remove voco
```

If you also want to remove local state:

```bash
rm -rf -- \
  "${XDG_CONFIG_HOME:-$HOME/.config}/voco" \
  "${XDG_DATA_HOME:-$HOME/.local/share}/voco" \
  "${XDG_CACHE_HOME:-$HOME/.cache}/voco" \
  "${XDG_STATE_HOME:-$HOME/.local/state}/voco"
```

This removes settings, update cache, downloaded models, timing traces, and any opt-in debug WAV and
transcript-timeline captures. Review or back up anything you need first.

VOCO does not own or remove `~/.openclaw/realtime.env` or other OpenClaw-managed files. That path is
outside VOCO's XDG state and may be shared with other tools. If you created the key file only for
VOCO, remove it separately after confirming nothing else uses it; do not delete the entire
`~/.openclaw` directory as part of a routine VOCO uninstall.

### Snap draft cleanup

If you built the draft snap locally, remove the installed snap with:

```bash
sudo snap remove voco
```

### Source install

Remove the built binary or bundle you installed, then remove local state if desired:

```bash
rm -rf -- \
  "${XDG_CONFIG_HOME:-$HOME/.config}/voco" \
  "${XDG_DATA_HOME:-$HOME/.local/share}/voco" \
  "${XDG_CACHE_HOME:-$HOME/.cache}/voco" \
  "${XDG_STATE_HOME:-$HOME/.local/state}/voco"
```

The same `~/.openclaw` ownership warning above applies to source installs.


## Candidate identity and launch environment

Application version `2026.0.37` can accompany successive Debian revisions such as
`2026.0.37+local3`. Compare the package hash, installed files and running executable
with the delivery receipt. A process started before an upgrade may still execute
the old binary until restarted. Preserve recovery text before quitting.

Performance logging is opt-in; a previously running process cannot gain the setting
from a second launch. Quit it normally, then launch with `VOCO_PERFORMANCE_LOG=1`
when testing. The model and worker should report ready before recording.

The current progressive path is enabled by default. Legacy instructions to set
`VOCO_DESKTOP_STREAM=1` explicitly applied to earlier candidates. On Wayland, keep
the supported ydotool service available; no recipient keybinding changes are needed.
See [delivery](testing/desktop-paste.md) and [review status](testing/pre-release-review-2026-09-15.md).
