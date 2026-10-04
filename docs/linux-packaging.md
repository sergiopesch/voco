# Linux packaging

VOCO ships as two packages named `voco`, built from one staged tree: a Debian
package, `voco_<version>_amd64.deb`, for Ubuntu and Debian, and an RPM,
`voco-<version>-1.x86_64.rpm`, for Fedora. Both hold the same files: the app,
the speech worker, the Nemotron model, the native CPU runtime, the optional
desktop integrations and their license notices, so dictation needs no download
at run time. The CPU needs AVX2, FMA and F16C, and the system needs glibc 2.39
or later. [Install](install.md) covers installing the packages; this page covers
how they are built and what they contain.

## How the packages are built

Three steps turn a checkout into packages:

1. `scripts/build-desktop.sh`, which `npm run build` runs, builds the interface
   and `voco-browser-host`, then runs `cargo tauri build --bundles deb`. The
   result is a base package in `apps/desktop/src-tauri/target/release/bundle/deb/`.
   It holds the app and the integration files but no speech runtime, so it can't
   dictate and is never installed on its own.
2. `python3 scripts/package-nvidia.py BASE.deb OUTPUT.deb [--rpm OUTPUT.rpm]`
   stages the complete tree once: the base package plus the speech runtime, the
   documentation and the licenses. It builds the Debian package from that tree
   and, with `--rpm`, [the RPM](#the-rpm) from a copy of it.
3. `bash scripts/verify-deb-package.sh OUTPUT.deb [VERSION]` and
   `bash scripts/verify-rpm-package.sh OUTPUT.rpm [VERSION] [OUTPUT.deb]` check
   the results. Given the Debian package, the RPM check also proves that both
   carry the same files and dependencies.

`bash scripts/setup.sh --install` runs the Debian steps and installs the package
with APT. `scripts/assemble-release.sh` builds and checks both packages for a
release, as the [release process](release-process.md) describes. Both need the
[provisioned runtime](#runtime-provisioning). The packages are built on an APT
system: `package-nvidia.py` unpacks the base package with `dpkg-deb`, and the
RPM needs `rpmbuild`, which Ubuntu's `rpm` package provides.

`package-nvidia.py` stops unless the base package's version equals the one in
`package.json`. `--debian-version` may only extend that version with a `+suffix`,
which must also be a valid RPM version when `--rpm` is given, and neither output
file may exist yet. The script checks that the base package holds the `voco` and
`voco-browser-host` executables, runs `scripts/verify-glib-backport.py`, and
refuses a model whose SHA-256 differs from `runtime/speech/MODEL-IDENTITY.json`.
It then writes `MANIFEST.json`, an inventory of every speech file and link with
its SHA-256, sets directories to 0755 and files to 0644 or 0755, generates the
maintainer script and rewrites the control file's version, installed size and
checksums. It builds the Debian package with Zstandard at level 9 and, if asked,
the RPM, and writes them to their outputs only when both are complete. It prints
the version and each package's path, size and SHA-256.

## Contents

Both packages install these paths:

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

Installing either package applies its `/dev/uinput` rule and turns nothing else on.
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

The RPM marks `copyright`, `THIRD-PARTY-NOTICES.txt`, `nvidia/` and `vendor/` as
licenses, so they stay installed when DNF skips documentation, and the rest of
the folder as documentation.

## Dependencies

| Used by | Debian package | RPM |
| --- | --- | --- |
| The app | `libpulse0` for Wayland capture, `libnotify-bin` for the startup failure notice, `libc6 (>= 2.39)`, `libstdc++6 (>= 13.2.0)` | `pulseaudio-libs`, `libnotify`, `glibc >= 2.39`, `libstdc++ >= 13.2` |
| WebKitGTK, GTK and the tray icon | `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1` | `webkit2gtk4.1`, `gtk3`, `libayatana-appindicator-gtk3` |
| Speech worker | `python3`, `python3-numpy`, `python3-psutil`, `libsentencepiece0` | `python3`, `python3-numpy`, `python3-psutil`, `sentencepiece-libs` |
| Paste | `xdotool`, `xclip`, `wl-clipboard` | `xdotool`, `xclip`, `wl-clipboard` |
| IBus engine | `ibus`, `gir1.2-ibus-1.0`, `python3-gi` | `ibus`, `ibus-libs`, `python3-gobject` |

`tauri.conf.json` lists the Debian dependencies, and Tauri adds the WebKitGTK,
GTK and AppIndicator libraries itself. `DEBIAN_TO_FEDORA` in
`scripts/rpm_package.py` names the Fedora 44 package that provides the same
files for each one, and `packaging/rpm/voco.spec.in` requires exactly those;
`npm run verify:devops` fails when the three disagree. CI installs both lists,
which `scripts/distro-dependencies.py` prints by Debian or Fedora names, in
Debian 13 and Fedora 44 containers, so a renamed or missing package fails there
before a release does.

Neither package recommends anything. VOCO presses the Wayland paste keys through
its own virtual keyboard, so the helpers that either session needs are all
dependencies. The guided installer gives APT or DNF only the VOCO package, and
`setup.sh --install` gives APT only the Debian package.

## The RPM

`scripts/rpm_package.py` fills in `packaging/rpm/voco.spec.in` for the staged
tree: the version, release 1, the summary and description from the staged
Debian control file, the scriptlet and the file list. Then it runs
`rpmbuild -bb` for x86_64 on a copy of the tree, with `HOME` set to its work
folder so that a personal `~/.rpmmacros` can't change the package. The spec has
no prep, build or install stage, because nothing is compiled or downloaded.

- **Payload.** The files go in exactly as staged: no stripping,
  byte-compiling, build-ID links or debug packages. The payload is Zstandard at
  level 9 with SHA-256 file digests, and the build host reads `voco-release`.
  With `SOURCE_DATE_EPOCH` set, as release assembly sets it, the build time and
  every newer file time become the commit time.
- **Requirements.** The RPM requires the [Fedora names](#dependencies) of the
  Debian dependencies. Automatic requirements and provides are off for the
  private speech runtime in `/usr/lib/voco/speech`, which offers no libraries
  to the system, and the documentation adds no requirements. The app binaries
  keep their generated library requirements.
- **Scriptlet.** The only scriptlet is `%post`, from `packaging/rpm/post.sh`,
  which applies the `/dev/uinput` rule as the Debian package does (see
  [Package scripts](#package-scripts)). There are no triggers.
- **Folders.** The RPM owns VOCO's folders: `/usr/lib/voco`, `/usr/share/voco`,
  `/usr/share/doc/voco` and the companion's folder. It also owns the shared
  folders that no VOCO dependency creates on Fedora 44, the Chrome and Chromium
  host folders under `/etc` and `/usr/share/gnome-shell` with its `extensions`
  folder, so removal leaves no empty folder. It never owns the system folders
  that `filesystem`, `systemd-udev`, `hicolor-icon-theme` or `ibus` own, and a
  folder that neither list names stops the build.
- **Signature.** The RPM carries no OpenPGP signature. The release's signed
  checksum lists authenticate it, so DNF warns that it skipped OpenPGP checks
  when it installs the file.

Like the Debian package, the RPM declares no configuration files, and no weak
dependencies, conflicts or obsoletes.

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

The [package scripts](#package-scripts) ask udev to apply the rule at once, so
the active local session usually has access straight away; otherwise signing
out and back in once applies it.
[Access to /dev/uinput](platform/README.md#access-to-devuinput) covers checking
the access and replacing the rule.

The guided installer and `setup.sh --install` share `voco_verify_desktop_input`
in `scripts/lib/install-common.sh`, which runs
`/usr/bin/voco --check-desktop-input`; when it fails, both exit with status 2.
Package hooks never start, stop or restart user services.

## Package scripts

Each package runs one script as root when it is installed or upgraded, and none
at removal.

The Debian package has one maintainer script, `postinst`.
`scripts/debian_maintainer.py` generates it from `packaging/debian/postinst.py.in`
with the list of every directory the package owns under `/usr/lib/voco`,
`/usr/share/voco` and `/usr/share/doc/voco`.

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

The RPM's `%post`, `packaging/rpm/post.sh`, runs the same three commands with
the same limit and ignores their failures. It contains no rpm macros, and the
spec runs nothing else.

## Upgrade and removal

An upgrade replaces the package's files. Neither package declares
configuration files or has removal scripts, so `apt remove voco` or
`dnf remove voco` deletes every file the package installed, including the host
manifests in `/etc` and the udev rule. Nothing re-applies udev rules on
removal, so the `/dev/uinput` access the rule gave lasts until the computer
restarts. Package operations change nothing in your home folder: settings and
Review stay, as [What VOCO keeps](everyday-use.md#what-voco-keeps) lists.

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

`verify-rpm-package.sh` runs on the Ubuntu build computer and on Fedora. It
needs rpm, rpm2cpio, cpio, desktop-file-validate, appstreamcli, python3 and
readelf, and dpkg-deb when it is given a Debian package. It checks:

- the header: the name `voco`, the expected version, release 1, no epoch,
  `x86_64`, the license expression, the build host `voco-release`, the
  Zstandard payload and the file name `voco-<version>-1.x86_64.rpm`;
- every Fedora requirement with both ABI floors, and no weak dependencies,
  conflicts, obsoletes or configuration files;
- one root-owned entry with the expected mode for each fixed path; no Python
  caches, test files, build-ID links, Debian control files or retired
  `ydotoold` files; and the license marking of the notices and the NVIDIA texts;
- with `rpm_package.py verify-package`: only the reviewed `%post` and no
  triggers, plain root-owned modes, the reviewed folder ownership and license
  and documentation flags, requirements that cover each system library the
  private runtime needs, the app binaries' generated requirements, nothing
  private provided or required, and no binary that needs a `GLIBC`, `GLIBCXX`
  or `CXXABI` symbol version newer than Ubuntu 24.04 provides;
- the same byte-for-byte comparisons with the sources, the host manifest and
  origin checks, the speech payload and the AppStream checks as the Debian
  verifier;
- given a Debian package, with `rpm_package.py same-package`: that both
  packages hold the same files and links with the same modes and SHA-256
  digests, and that every Debian dependency is required under its Fedora name.

In both verifiers, `VOCO_PACKAGE_VERIFY_OFFLINE=1` runs the AppStream checks
with `--no-net`, for a job without network access; `setup.sh --install` sets it.
Release assembly keeps the online checks.

`npm run test:speech-package` includes `scripts/test-rpm-package.py`, which
tests the file list, the spec, the header policy and both parity checks, and
builds a small RPM when `rpmbuild` is installed. `npm run verify:devops` keeps
the spec in step with the dependency map, and fails unless the spec builds
nothing, runs only `packaging/rpm/post.sh` and stays x86_64 release 1. It also
keeps the guided installer's glibc floor equal to both packages'.
