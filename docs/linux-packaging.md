# Linux Packaging

Current cut: the owner accepted installed +local7 and authorized the private
2026.0.37 release cut. See [status and remaining public gates](releases/2026.0.37.md).
Earlier candidate preparation/deferral statements below are historical. The owner's
installed application remains +local7 until a separately requested update.

Current follow-up: private **+local7** contains the [bounded legacy keyboard optimization](testing/keyboard-delivery-2026-09-15.md). +local6 was installed and successfully owner-tested. Older revision results below remain historical; use exact artifact receipts for the new candidate.

Candidate packaging and distribution qualification are separate stages. The private
candidate is `2026.0.37+local7`; `+local6` remains installed, and `+local4`/`+local5`
remain historical evidence. See [the current review](testing/stop-delivery-review-2026-09-15.md)
for validation C results and remaining scope. Final Debian/RPM/Arch qualification
is supplied outside each package in exact-SHA, payload-parity and install/remove
receipts. Source documents do not self-attest to their containing package hash.

## Complete NVIDIA candidate

The application version is `2026.0.37`; Debian candidate revisions may append
`+localN` without changing the application UI version. This testing candidate
is not published. Tauri builds a **base** Debian bundle;
it must be assembled with the pinned NVIDIA runtime/model before installation:

Use the repository build wrapper: it supplies the production protocol feature and
bundles the browser host. A direct Tauri bundle omits that host and fails verification.

```bash
npm run build
python3 scripts/package-nvidia.py /path/to/tauri-base.deb /path/to/voco_2026.0.37_amd64.deb --debian-version 2026.0.37
```

The assembler validates the base version and matching regular app/browser-host
executables before copying the large model payload. It validates the runtime, verifies the pinned
model digest, includes native libraries and notices, and produces a payload manifest
and package receipt. Inspect its actual successful output and run package/runtime
checks before delivery; the command alone is not a pass. Keep base and complete
artifacts distinct. Record the complete package SHA-256 and installed version.

The model/runtime files under `runtime/speech` are separate from the MIT application:
retain `runtime/notices` and model provenance, including the NVIDIA model terms.
The complete package needs Python, NumPy, psutil and the declared native dependencies.
Debian metadata explicitly includes `at-spi2-core` as well as `gir1.2-atspi-2.0`:
GI bindings alone do not provide the accessibility bus/registry service needed by
the sampled-field helper in a minimal userspace.
A source snapshot with absent model/native artifacts cannot build this complete
package merely by running npm install. Verify artifacts rather than silently fetching
an unpinned replacement. Never package personal benchmark recordings or test logs.

See [candidate gates](release-candidate.md) for owner acceptance and release sequencing.
The GitHub release workflow now explicitly assembles the NVIDIA payload, and the
package verifier requires the complete runtime. Portable, pinned provisioning of
the model/native artifacts remains unresolved before public release: host-native
binaries and this laptop's successful package check do not establish a reproducible
portable build. Do not upload a base bundle as this candidate.

## Runtime provisioning

GitHub source intentionally excludes model weights and compiled native runtime
artifacts. The local candidate workspace contains the tested payload, but `git clone`
and `npm ci` alone do not provide it. Before running NVIDIA protocol tests or
assembling the complete Debian package, provision these paths separately:

- `runtime/speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf`
- `runtime/speech/libbench_nemo_pool.so`
- `runtime/speech/lib/`, including its relative native-library links

Use the verified candidate payload and its SHA-256 inventory. Preserve relative
links, required notices, and `runtime/speech/MODEL-IDENTITY.json`; the assembler
checks the model against that identity and rejects escaping or broken payload links.
Retain the complete package manifest and build receipt so the native-library hashes
remain traceable. The NVIDIA model is pinned to revision
`ebe59e5a817142986528bbbee5dba8db7b38ed50`; the converted GGUF digest is
`d9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d`.
Downloading a similarly named upstream model is not equivalent to this converted
artifact or to the modified native runtime.

An independently reproducible, portable native build and immutable artifact
provisioning remain release gates. Do not silently fetch mutable replacements or
commit binaries, model weights, private recordings or benchmark transcripts to Git.

## Published-channel structure

- GitHub Releases
- `.deb`
- release checksums
- update checks against GitHub Releases inside the app

AppImage remains a local packaging experiment and is not published until the full linuxdeploy and
appimagetool chain can be supplied from immutable, checksum-verified sources.

## Next

- Ubuntu App Center review path after local snap install and runtime validation
- Flatpak sandbox validation to determine whether Flathub is a real fit
- release workflow polish for the channels that already build cleanly

## Later

- strict-confinement investigation only if VOCO stops depending on host-level desktop automation
- Native RPM and Arch candidates require per-artifact external build, dependency, payload and install/remove receipts; private verification does not establish a published or signed release channel

## Asset Naming

Branding note:
- package and listing assets should use VOCO's graphite microphone branding rather than the older purple treatment

- `voco_<version>_amd64.deb`
- `voco_checksums.txt`

## Packaging Principles

- use Linux-native desktop metadata
- keep uninstall paths clean
- avoid hidden system modification
- document permissions and runtime expectations
- keep the first-run setup clear about microphone access and feature availability

## Support Matrix

Current primary validation target:

- Ubuntu
- x86_64 / amd64
- Wayland and X11, with documented insertion caveats

Debian-derived distributions are best-effort. The `.deb` format and dependency metadata target
Debian-family package managers, but that compatibility is not a substitute for a recorded desktop
runtime test. The current baseline passed actual application/GTK/X11 virtual-microphone
checks in Ubuntu 26, Debian 13, Fedora 44, Linux Mint 22.3 and genuine Omarchy 4.0.3
official ISO-derived installer userspace after dependency provisioning. It does not
include an installed Hyprland compositor in this test. These checks share the host kernel and do not run each distribution's
default compositor, installed desktop or physical microphone. Native RPM/Arch
packaging and broader stress-case acceptance require their own receipts; see
[the evidence matrix](testing/cross-linux-review-2026-09-15.md#baseline-userspace-results).

The optional consuming-shortcut IBus component remains package-owned at
`/usr/share/ibus/component/voco.xml` and `/usr/libexec/voco-ibus-engine`. Protocol 5
rejects text mutation. The package does not select an input source or restart IBus.

The Chromium integration packages `/usr/libexec/voco-browser-host`, native host
manifests in `/etc/opt/chrome/native-messaging-hosts` and
`/etc/chromium/native-messaging-hosts`, and `/usr/share/voco/chromium`.
Its fixed extension origin is the only allowed origin. The build script obtains
the host executable from Cargo's machine-readable output before bundling, including
custom target directories. Package verification checks the executable, manifests,
extension public-key identity, permissions and origin rejection.

The extension is activated by the user; package installation does not modify a
browser profile. The host connects only to the same user's private Unix socket.
Experimental AppImage/Flatpak/Snap packaging has not validated this host boundary.

## Listing Assets

Store copy, release-note structure, and screenshot requirements live in [docs/store-listing.md](store-listing.md).
Submission status and release gating live in [docs/submission-readiness.md](submission-readiness.md).
Release rehearsal steps live in [docs/release-process.md](release-process.md).

## Flatpak Baseline

The repo now includes an initial Flatpak packaging baseline:

- `packaging/flatpak/com.sergiopesch.voco.yml`
- `packaging/flatpak/com.sergiopesch.voco.desktop`
- `packaging/flatpak/com.sergiopesch.voco.metainfo.xml`

This is a starting point for Flathub submission work, not a claimed production-ready Flathub package yet. The next packaging pass should validate sandbox permissions, runtime dependencies, and release build behavior inside `flatpak-builder` before Flathub is treated as an active release target.

## Snap Status

The repo now includes a tracked Snap draft:

- `snap/snapcraft.yaml`
- `snap/gui/com.sergiopesch.voco.desktop`

Ubuntu App Center work is still a draft path, not a publish-ready channel.

The likely first store submission still uses `classic` confinement on purpose.

Why not strict yet:

- VOCO registers global hotkeys
- on Wayland it can rely on direct `evdev` keyboard access
- text insertion shells out to `ydotool`, `xdotool`, `wl-copy`, `wl-paste`, and `xclip`
- it opens external URLs with `xdg-open`
- it uses `notify-send` for desktop notifications
- its core user promise is typing into arbitrary host applications, which is exactly where strict confinement becomes unnatural

So the honest first Snap is a classic-confinement review candidate, not a pretend-strict package that quietly breaks VOCO's core workflow.

The next packaging pass should install the built snap locally, verify tray, microphone, hotkey, and insertion behavior in a real desktop session, and then decide whether any future product changes could make stricter confinement realistic.

## Experimental AppImage Packaging

This path is for local packaging research only. It is not part of the release workflow because the
upstream Tauri/linuxdeploy stages are not yet fully pinned, even though the final `appimagetool`
fallback itself is checksum-verified.

The repo now includes:

- `scripts/package-appimage.sh`

This helper:

- normalizes the expected lowercase icon name inside `VOCO.AppDir`
- requires `VOCO_APPIMAGETOOL_PATH` and `VOCO_APPIMAGETOOL_SHA256` for a pre-fetched immutable
  `appimagetool` binary, and verifies it before execution
- runs `appimagetool` in extract-and-run mode so it does not require host FUSE 2

Default `npm run build` builds only the locked Debian bundle. After an explicit experimental
AppImage attempt, this helper can finish an existing AppDir only when both pinned-tool environment
variables are set. That does not make the earlier linuxdeploy stages release-safe.

Use it manually only after an explicit experimental
`cargo tauri build --features custom-protocol --bundles appimage` run created the AppDir.

```bash
VOCO_APPIMAGETOOL_PATH=/path/to/pinned/appimagetool \
VOCO_APPIMAGETOOL_SHA256=<verified-sha256> \
bash ./scripts/package-appimage.sh
```

## GNOME desktop clipboard dependency

The 2026.0.28 Debian candidate depends on `xclip`. On GNOME Wayland with `DISPLAY`,
native desktop paste uses its XWayland clipboard bridge, then `ydotool` for the
Wayland keyboard gesture. This avoids the locally reproduced `wl-copy` temporary
focus-surface timeout. Other Wayland desktops retain `wl-copy`. No fallback is
attempted after a clipboard mutation or uncertain dispatch. See
[desktop paste verification](testing/desktop-paste.md).


The current package depends on `gir1.2-atspi-2.0` and `at-spi2-core`. The bounded
Python helper is embedded in the Rust executable and uses Python/GI plus the AT-SPI
service. Focus discovery returns opaque identity and paste-gesture metadata. Eligible
fields also permit bounded transient local-region text readback during delivery
observation; that text is not logged or returned to the frontend. The helper does
not change accessibility settings. Unsupported controls retain best-effort delivery,
without a universal acceptance claim. See [observation](testing/delivery-observation.md).

## NVIDIA local testing candidate (2026.0.37)

The local candidate bundles Nemotron Speech Streaming English 0.6B Q8_0, its
modified CPU runtime, Python worker and model notices under `/usr/lib/voco/speech`
and `/usr/share/doc/voco/nvidia`. Ubuntu supplies `python3`, `python3-numpy`,
`python3-psutil` and `libsentencepiece0`. No Homebrew, virtual environment, network
access or checkout path is needed at runtime. This is a host-native CPU build for
the tested laptop, not a portability-qualified public release.

Run the normal Tauri Debian build, then `python3 scripts/package-nvidia.py BASE_DEB
OUTPUT_DEB` to assemble the complete package with zstd compression. The script
verifies the fixed model hash, adds a runtime SHA-256 manifest and regenerates the
Debian file inventory. Install the resulting complete package with apt so declared
dependencies are resolved. A base Tauri package alone is incomplete for NVIDIA.

Desktop paste and streaming are enabled by default for this authorized candidate;
`VOCO_DESKTOP_PASTE=0` or `VOCO_DESKTOP_STREAM=0` can disable the corresponding
path. Existing target checks, enhancement behavior and Whisper recovery remain.
The English NVIDIA model is used for normal enhancement-off desktop streaming.
Startup prepares that selected runtime through the serialized worker and waits for
actual warmup success before readiness. It does not implicitly download Whisper
for the default path. Legacy-selected startup and explicit legacy transcription
retain the separate Whisper model check/download.

`VOCO_PERFORMANCE_LOG=1` enables private, rotating local metrics. Worker records
include model/runtime identity, monotonic and wall clocks, hashed stream identity,
recording/request numbers, queue age, recognition time, CPU/RSS, first hypothesis,
startup/protocol failures and dropped-event counts. Audio, transcript contents,
app names and window titles are excluded. The app records matching IPC boundaries,
slow calls and bounded failure reasons. A bounded background writer isolates disk
stalls/failures from recognition; loss of coverage produces a content-free warning.

Run `python3 /usr/share/doc/voco/report-speech-performance.py
~/.local/state/voco` for recognizer/IPC diagnostics, and the adjacent
`report-performance.py` against `~/.local/state/voco/performance` for capture,
paste and stop stages. Neither report proves that text appeared in a target field;
that needs independent field readback. Missing recordings remain unavailable.

## Native Fedora and Arch candidate recipes

`scripts/stage-native-packages.py` stages an RPM spec and Arch PKGBUILD from a
complete, hash-verified Debian candidate. These are native package-manager wrappers
around the same prebuilt application/model bytes, not a portable source rebuild.
They preserve file hashes and relative loader links, disable strip/debug rewriting,
and declare distro-specific runtime dependencies. Unknown Debian dependency
constraints or maintainer actions require review rather than silent translation.

```bash
python3 scripts/stage-native-packages.py COMPLETE.deb FRESH_DIRECTORY \
  --sha256 EXPECTED_SHA256 \
  --verifier /absolute/path/to/voco/scripts/verify-deb-package.sh
```

Build the generated `voco.spec` with `rpmbuild` in a disposable Fedora builder, or
`PKGBUILD` with `makepkg` in a disposable Arch builder. Never run package install or
removal tests on the owner desktop. `scripts/verify-native-install.py` compares the
installed payload's bytes, links, application-owned modes, ownership and ELF closure
against `payload-inventory.json`; `--removed` checks removal of all files/links.
It requires a disposable Docker environment. Shared system directory modes remain
owned by the distribution. Run `npm run test:native-package` for staging-boundary
regressions.

Fedora explicitly requires the base/good GStreamer plugins; upstream WebKit's weak
recommendations do not ensure capture works in a minimal installation. Arch needs
`gst-plugins-good` and a separately verified SentencePiece package. The cross-Linux
evidence includes a locally built SentencePiece 0.2.1 support package from pinned
upstream source with 141 upstream tests passing. It is not an official Arch
repository or signed public VOCO package. Retain its source, Apache notice and hash
receipt; do not silently run an arbitrary AUR recipe.

The NVIDIA assembler normalizes staged runtime/docs to 0755 directories and
0644/0755 files, preserves symlinks without following them and rejects special
objects. Neither native recipe installs scripts that alter input sources, shortcuts,
browser profiles or input permissions. Standard distro package-manager hooks still
apply. Public signing, repositories, source provisioning and default desktop
acceptance remain separate release work.

For a deliberately network-disabled verification job, set
`VOCO_PACKAGE_VERIFY_OFFLINE=1` when invoking `scripts/verify-deb-package.sh`. This
runs local AppStream validation with `--no-net`; it does not validate external URLs.
Omit the variable for the release job's normal online URL checks.
