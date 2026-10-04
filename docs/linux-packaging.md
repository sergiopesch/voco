# Linux packaging

VOCO ships as one Debian package, `voco`, for Ubuntu and Debian on amd64. It
holds the app, the speech worker, the Nemotron model, the native CPU runtime,
the optional desktop integrations and their license notices, so dictation needs
no download at run time. The CPU needs AVX2, FMA and F16C, and the system needs
glibc 2.39 or later. [Install](install.md) covers installing the package; this
page covers how it is built and what it contains.

## How the package is built

Three scripts turn a checkout into a package:

1. `scripts/build-desktop.sh`, which `npm run build` runs, builds the interface
   and `voco-browser-host`, then runs `cargo tauri build --bundles deb`. The
   result is a base package in `apps/desktop/src-tauri/target/release/bundle/deb/`.
   It holds the app and the integration files but no speech runtime, so it can't
   dictate and is never installed on its own.
2. `python3 scripts/package-nvidia.py BASE.deb OUTPUT.deb` adds the speech
   runtime, the documentation and the licenses, and writes the complete package.
3. `bash scripts/verify-deb-package.sh OUTPUT.deb [VERSION]` checks the result.

`bash scripts/setup.sh --install` runs all three and installs the package with
APT. `scripts/assemble-release.sh` runs them for a release, as the
[release process](release-process.md) describes. Both need the
[provisioned runtime](#runtime-provisioning).

`package-nvidia.py` stops unless the base package's version equals the one in
`package.json`. `--debian-version` may only extend that version with a `+suffix`,
and the output file must not exist yet. The script checks that the base package
holds the `voco` and `voco-browser-host` executables, runs
`scripts/verify-glib-backport.py`, and refuses a model whose SHA-256 differs from
`runtime/speech/MODEL-IDENTITY.json`. It then writes `MANIFEST.json`, an
inventory of every speech file and link with its SHA-256, sets directories to
0755 and files to 0644 or 0755, generates the maintainer script and rewrites the
control file's version, installed size and checksums. It builds the package with
Zstandard at level 9 and prints its path, version, size and SHA-256.

## Contents

| Path | Contents |
| --- | --- |
| `/usr/bin/voco` | The app |
| `/usr/lib/voco/speech/` | The worker (`stream_worker.py` and its modules), the model in `models/`, the native libraries in `lib/`, `libbench_nemo_pool.so`, the two identity receipts and `MANIFEST.json` |
| `/usr/lib/udev/rules.d/70-voco-uinput.rules` | The [`/dev/uinput` rule](#wayland-paste-keys) for the active local session |
| `/usr/lib/modules-load.d/voco-uinput.conf` | Loads the `uinput` module at boot |
| `/usr/libexec/voco-browser-host` | The native messaging host for the [Chromium extension](../integrations/chromium/README.md) |
| `/usr/share/voco/chromium/` | The extension's `manifest.json`, `background.js` and `content.js` |
| `/etc/opt/chrome/native-messaging-hosts/`, `/etc/chromium/native-messaging-hosts/` | `com.voco.exact_field.json`, which lets the extension start the host |
| `/usr/share/gnome-shell/extensions/voco-panel@voco.local/` | The [GNOME companion](../integrations/gnome/README.md) |
| `/usr/libexec/voco-ibus-engine`, `/usr/lib/voco/ibus/`, `/usr/share/ibus/component/voco.xml` | The optional IBus shortcut engine |
| `/usr/share/applications/VOCO.desktop` | The desktop entry |
| `/usr/share/metainfo/com.sergiopesch.voco.metainfo.xml` | AppStream metadata, including the release notes |
| `/usr/share/icons/hicolor/*/apps/voco.png` | Icons at 32, 128 and 256 pixels |
| `/usr/share/doc/voco/` | [Documentation and licenses](#documentation-and-licenses) |

Installing the package applies its `/dev/uinput` rule and turns nothing else on.
The GNOME companion stays off until the guided installer or you enable it, and
the IBus input source and the Chromium extension stay off until you add them.

## Documentation and licenses

`/usr/share/doc/voco/` holds:

- `copyright`: a short preface followed by VOCO's MIT License. The preface says
  that the speech runtime, the model and the patched libraries keep their own
  licenses, and points to the files below.
- `THIRD-PARTY-NOTICES.txt`: a summary of the vendored glib, tray-icon and
  global-hotkey sources, their licenses and VOCO's changes, from
  `vendor/THIRD-PARTY-NOTICES.txt`.
- `nvidia/`: the model license and card and the runtime notices, from
  `runtime/notices/`.
- `vendor/`: the license, patch and upstream record of each vendored crate.
- `README.md`, `AGENTS.md` and `docs/`, without `docs/guide/` and `docs/testing/`.
- `report-performance.py` and `report-speech-performance.py`, which summarize
  the opt-in [performance logs](troubleshooting.md#performance-logs).

## Dependencies

| Used by | Packages |
| --- | --- |
| The app | `libpulse0` for Wayland capture, `libnotify-bin` for the startup failure notice, `libc6 (>= 2.39)`, `libstdc++6 (>= 13.2.0)` |
| Speech worker | `python3`, `python3-numpy`, `python3-psutil`, `libsentencepiece0` |
| Paste | `xdotool`, `xclip`, `wl-clipboard` |
| IBus engine | `ibus`, `gir1.2-ibus-1.0`, `python3-gi` |

The package recommends nothing. VOCO presses the Wayland paste keys through its
own virtual keyboard, so the helpers that either session needs are all
dependencies. The guided installer and `setup.sh --install` give APT only the
VOCO package.

## Wayland paste keys

On Wayland, VOCO presses the paste keys through its own virtual keyboard on
`/dev/uinput`, so the package ships no input daemon or service. It installs two
files instead:

- `/usr/lib/udev/rules.d/70-voco-uinput.rules` tags `/dev/uinput` with
  `uaccess`, so logind gives the user of the active local session read and write
  access through an ACL. No group is involved. Other accounts, users signed in
  only remotely and system services get no access.
- `/usr/lib/modules-load.d/voco-uinput.conf` loads the `uinput` module at boot,
  so the device exists before the first login.

The [maintainer script](#maintainer-script) asks udev to apply the rule at once,
so the active local session usually has access straight away; otherwise signing
out and back in once applies it.
[Access to /dev/uinput](platform/README.md#access-to-devuinput) covers checking
the access and replacing the rule.

The guided installer and `setup.sh --install` share `voco_verify_desktop_input`
in `scripts/lib/install-common.sh`, which runs
`/usr/bin/voco --check-desktop-input`; when it fails, both exit with status 2.
Package hooks never start, stop or restart user services.

## Maintainer script

The package has one maintainer script, `postinst`. `scripts/debian_maintainer.py`
generates it from `packaging/debian/postinst.py.in` with the list of every
directory the package owns under `/usr/lib/voco`, `/usr/share/voco` and
`/usr/share/doc/voco`.

On `configure`, the script changes a listed directory's mode only when it is
0775, to 0755. It opens each path component without following links and fails
if one isn't owned by root. It skips directories that `dpkg-statoverride` lists
and directories that a dpkg `path-exclude` rule left out.

Then it applies the `/dev/uinput` rule. It runs `modprobe uinput`,
`udevadm control --reload-rules` and
`udevadm trigger --action=change --subsystem-match=misc --sysname-match=uinput`,
each with a 10-second limit, and ignores their failures, because containers and
chroots have no udev to ask. It doesn't touch user files, services, sessions,
input sources or GNOME extensions.

## Upgrade and removal

An upgrade replaces the package's files. The package declares no configuration
files and has no removal scripts, so `apt remove voco` deletes every file it
installed, including the host manifests in `/etc` and the udev rule. Nothing
re-applies udev rules on removal, so the `/dev/uinput` access the rule gave
lasts until the computer restarts. Package operations change nothing in your
home folder: settings and Review stay, as
[What VOCO keeps](everyday-use.md#what-voco-keeps) lists.

Quit VOCO before you upgrade ([Upgrade](install.md#upgrade)). When a release
changes the GNOME companion, run `voco --setup-panel` again, then sign out and
back in.

After an upgrade from a version that pasted through `voco-ydotoold.service`,
the app's first start in a Wayland session retires that unit for the login. It
removes the enablement link
`$XDG_CONFIG_HOME/systemd/user/graphical-session.target.wants/voco-ydotoold.service`,
then stops the unit and reloads the user's service manager. It acts only when
the link points at `/usr/lib/systemd/user/voco-ydotoold.service` and that file
is gone, so it never touches a unit that someone else installed.

## Runtime provisioning

Git doesn't hold the model or the compiled runtime, and `.gitignore` excludes
them. A complete package needs these in `runtime/speech/`:

- `models/nemotron-speech-streaming-en-0.6b.q8_0.gguf`
- `libbench_nemo_pool.so`
- `lib/`, the native libraries with their relative version links

`setup.sh --install` and `assemble-release.sh` stop when one is missing. The
worker's Python files, `MODEL-IDENTITY.json` and `NATIVE-BUILD.json` are tracked,
so the worker code always comes from your checkout. To fetch the pinned runtime:

```bash
bash scripts/provision-ci-speech.sh
```

The script downloads a published VOCO package from GitHub Releases, checks it
against the SHA-256 written in the script and extracts it with `dpkg-deb`. It
verifies the speech payload with `scripts/verify-speech-payload.py`, checks that
the package's `MODEL-IDENTITY.json` and `NATIVE-BUILD.json` equal the checkout's
copies, and copies `models/`, `lib/` and `libbench_nemo_pool.so` into
`runtime/speech/`. Any mismatch stops it; it never falls back to another
download. It needs curl, dpkg-deb, python3 and network access. CI runs it in the
Rust Check & Test and Application jobs.

To rebuild the native libraries instead, follow
[Native runtime](../runtime/native/README.md). A rebuild replaces `lib/`,
`libbench_nemo_pool.so` and `NATIVE-BUILD.json` together. The recipe doesn't
convert the model, so the model always comes from a published package.

## Package checks

`verify-deb-package.sh` needs dpkg-deb, desktop-file-validate, appstreamcli,
python3 and readelf. It checks:

- the control fields: the name `voco`, the expected version, `amd64`, every
  dependency with both ABI floors, and no Recommends;
- one root-owned entry with the expected mode for each fixed path, and no Python
  caches or test files;
- the control area, which may hold only `control`, `md5sums` and a `postinst`
  identical to a fresh render;
- that `libpulse0` is declared when either executable links libpulse;
- that the notices, the license text in `copyright`, the udev rule, the
  `modules-load.d` file, the IBus files, the Chromium files and host manifests,
  the desktop entry, the metainfo and the icons equal their sources byte for
  byte, and that neither `/usr/libexec/voco/` nor `voco-ydotoold.service` is
  shipped;
- the speech payload, with `verify-speech-payload.py`, which compares every file
  and link with `MANIFEST.json` and the two identity receipts;
- that the host manifest allows only the extension ID derived from the
  extension's key, and that the host refuses any other origin;
- the AppStream ID, the launchable and the first release entry's version, then
  `desktop-file-validate`, `appstreamcli validate` and `appstreamcli validate-tree`.

`VOCO_PACKAGE_VERIFY_OFFLINE=1` runs the AppStream checks with `--no-net`, for a
job without network access. Release assembly keeps the online checks.
