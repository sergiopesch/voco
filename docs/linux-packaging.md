# Linux packaging

VOCO 2026.0.42 is distributed as a complete Debian amd64 package. Model weights,
native libraries and their notices are included; no recognition download or GPU
is required for normal English dictation and explicit recovery. Other packaging
formats below remain experimental.

## Build and assemble

Use a clean tagged checkout and the repository build wrapper. It builds both the
application and native browser host, and forces the Whisper AVX2/FMA/F16C CPU
baseline while disabling host-native and AVX-512/AMX flags. The separately pinned
NVIDIA payload has its own identity and qualification requirements.

```bash
npm ci
npm run build
python3 scripts/package-nvidia.py /path/to/tauri-base.deb /path/to/voco_2026.0.42_amd64.deb --debian-version 2026.0.42
bash scripts/verify-deb-package.sh /path/to/voco_2026.0.42_amd64.deb
```

A base Tauri bundle is incomplete and must never be published as VOCO. The assembler
checks versions, app/browser-host executables, model identity, native libraries,
relative symlinks and notices, and emits a payload manifest and receipt. Verify the
complete artifact, dependency resolution, install/upgrade/remove behavior and
isolated runtime before publication. Record source and package SHA-256 identities.
Do not include personal recordings, transcripts, API credentials or private receipts.

The package requires Python 3, NumPy, psutil and the declared native dependencies.
The worker defaults to at most four CPU threads, capped to its CPU affinity. This
avoids oversubscribing one- or two-core machines. Explicit research overrides stay
explicit; diagnostics record the effective thread count. CPU quotas imposed without
matching affinity remain a separate performance constraint.
Its ABI floor includes glibc 2.39 and libstdc++ 13.2.0. X11 helpers are required;
ydotool and the separately packaged Ubuntu ydotoold are recommended for Wayland;
the input service must also be configured and running. Debian 13
repositories may not provide it, so the recommendation must not block X11 installs. `at-spi2-core` and
`gir1.2-atspi-2.0` provide the accessibility bus and bindings. Package installation
does not change the selected input source or restart IBus.

The .43 Debian package repairs inherited `0775` permissions on its own root-owned
directories to `0755` during configuration. The reviewed migration uses directory
descriptors, rejects symlink traversal and leaves user files, custom modes and
`dpkg-statoverride` entries unchanged. Missing documentation directories are allowed
when the system uses `path-exclude`. The verifier checks the exact generated hook;
native RPM and Arch packages omit it because their managers apply archive modes.
Upgrade qualification includes legacy installations, not only fresh extraction.

The .43 candidate additionally links libpulse (`libpulse-dev` on Debian build
hosts, `libpulse0` at runtime). Fedora, openSUSE and Arch profiles map that library
to their native package names. Native Wayland capture requires PipeWire's Pulse
compatibility server and explicit microphone selection/session permission;
installing the client library alone does not establish that capture works.

## Runtime provisioning

Git excludes model weights and compiled native libraries. `git clone` and `npm ci`
are enough for source-only checks, but not a complete NVIDIA package. Provision:

- `runtime/speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf`
- `runtime/speech/libbench_nemo_pool.so`
- `runtime/speech/lib/`, preserving relative native-library links

The .42 release keeps the verified .39 model and rebuilds the native runtime with
an explicit AVX2/FMA/F16C baseline, relative library paths and neutral source paths.
Extract the model from a checksum-verified versioned release package. Either use
that same package's complete native payload and `NATIVE-BUILD.json`, or follow the
[pinned native build recipe](../runtime/native/README.md) and qualify the new bytes.
Keep Python worker code from the matching source checkout. Preserve model terms,
native-library licenses, source provenance and the payload manifest.

The NVIDIA model revision is `ebe59e5a817142986528bbbee5dba8db7b38ed50`.
Converted model SHA-256:
`d9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d`.
Native source commits, patches, compiler options and output hashes are recorded in
`runtime/speech/NATIVE-BUILD.json`. The package verifier rejects mixed native
receipts and binaries, broken links and model hash mismatches. A similarly named
upstream download is not an equivalent artifact.

The native build recipe is public; independent model conversion to these exact
GGUF bytes remains a reproducibility gap. Retain the exact payload inventory with
releases. Hosted installer publication remains disabled; never silently replace
pinned artifacts with mutable downloads.

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
runtime test. Historical baselines passed actual application/GTK/X11 virtual-microphone
checks in Ubuntu 26, Debian 13, Fedora 44, Linux Mint 22.3 and genuine Omarchy 4.0.3
official ISO-derived installer userspace after dependency provisioning. It does not
include an installed Hyprland compositor in this test. These checks share the host kernel and do not run each distribution's
default compositor, installed desktop or physical microphone. Native RPM/Arch
packaging and broader stress-case acceptance require their own receipts; see
[the evidence matrix](testing/cross-linux-review-2026-09-15.md#baseline-userspace-results).

The optional consuming-shortcut IBus component remains package-owned at
`/usr/share/ibus/component/voco.xml` and `/usr/libexec/voco-ibus-engine`. Protocol 6
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
complete, hash-verified Debian release or local candidate. These are native package-manager wrappers
around the same prebuilt application/model bytes, not a portable source rebuild.
They preserve file hashes and relative loader links, disable strip/debug rewriting,
and declare distro-specific runtime dependencies. Unknown Debian dependency
constraints or maintainer actions require review rather than silent translation.

```bash
python3 scripts/stage-native-packages.py COMPLETE.deb FRESH_DIRECTORY \
  --sha256 EXPECTED_SHA256 \
  --verifier /absolute/path/to/voco/scripts/verify-deb-package.sh
```

Final versions such as `2026.0.42` use native package revision `1`. Use
`--native-release 2` for a packaging-only revision of the same final payload.
This does not authorize changing application/model bytes under the same version.
Legacy `+localN` candidates retain their previous native revision mapping; do not
assume a final revision `1` upgrades a previously installed local revision `N`.
Unknown versions, dependency constraints and revision overrides are rejected.
The reviewed Debian ABI floors map to Arch `glibc>=2.39`, `gcc-libs>=13.2.0`
and RPM `glibc >= 2.39`, `libstdc++ >= 13.2.0` requirements.

Native package signatures are separate from Debian release signatures. Public
Arch delivery needs a documented trusted signing key and a maintained dependency
source. Isolated tests may use an explicitly disposable signing key trusted only
inside the test guest; never ask end users to disable signature verification.

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

The [2026-09-19 Omarchy qualification](testing/omarchy-native-2026-09-19.md)
records native Arch package checks and booted Hyprland trials, including the
permission and hidden-window issues that still block public Omarchy support.

## Distribution-specific RPM profiles

`stage-native-packages.py --rpm-distribution fedora` is the default. Use
`--rpm-distribution opensuse` for the Tumbleweed dependency profile. Each output
records its profile in provenance; qualify and sign each native artifact separately.
Do not rename a Fedora RPM and call it an openSUSE build.

The [SentencePiece companion recipes](../packaging/dependencies/sentencepiece/README.md)
provide reviewed source builds where no system library package is available.
RPM recipes mark bundled licenses with `%license`, preserving them on minimal
`nodocs` installations. Full payload parity requires documents enabled.
See [the current scope and gates](linux-support.md).
