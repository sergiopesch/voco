# Install

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
VERSION="2026.0.21"
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

## Enable live words at the cursor

The `.deb` package installs the persistent `VOCO Dictation` IBus component, but deliberately does
not enable or select it for you.

1. Sign out and back in if the input source is not visible immediately after installation.
2. Open the desktop Keyboard or Region & Language settings.
3. Under Input Sources, add `VOCO Dictation` (normally listed under English).
4. Select `VOCO Dictation`, focus the target text field, and then press `Alt+D`.

VOCO passes ordinary keyboard input through while idle. It never edits GNOME settings, changes the
global IBus engine, or restarts desktop services. Settings -> Advanced -> Automatic live cursor
shows whether the private engine connection is ready. If it is not ready, stable cursor mode stays
visibly preview-only for that session. VOCO retains an unreconciled final in its popover for copying
instead of redirecting it through global keyboard insertion.

After installing an upgrade that changes the private engine protocol, quit VOCO and run
`ibus restart`, or sign out and back in, before reopening VOCO. Switching input sources alone does
not reload the resident IBus engine.

The AppImage does not install a host IBus component. Use the `.deb` for live cursor words; an
AppImage or uninstalled source build remains preview-only unless the matching `.deb` component is
already installed.

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

3. Start the app:

```bash
npm run dev
```

4. Test it:

- allow microphone access
- finish setup
- install the generated `.deb` and manually select `VOCO Dictation` for live cursor words
- press `Alt+D`
- speak
- press `Alt+D` again
- confirm text is inserted at the cursor
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
- Models: `~/.local/share/voco/models/`
- Privacy-safe timing trace: `${XDG_STATE_HOME:-$HOME/.local/state}/voco/hotkey-trace.jsonl`
- Optional debug captures: `${XDG_STATE_HOME:-$HOME/.local/state}/voco/debug-captures/`
- Socket: `$XDG_RUNTIME_DIR/voco.sock` when `XDG_RUNTIME_DIR` is set, otherwise `${TMPDIR:-/tmp}/voco-$(id -u)/voco.sock`
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
