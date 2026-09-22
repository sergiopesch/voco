# Vite 8 and dependency release qualification — 22 September 2026

This record qualifies the published **2026.0.54 release**, integrating dependency
PRs #61–#63. All 18 draft/public assets, five publisher signatures, latest aliases
and the tagged installer passed verification. Existing releases remain immutable.

## Changes and exact identities

Tauri 2.11.5 needs tray-icon 0.24.2. The previous vendor patch was no longer
selected, so the registry copy lacked VOCO's immutable icon-path API. The new
vendor baseline retains the exact additive Linux patch, records the upstream
archive/file hashes, and ships its licenses and provenance. The dependency gate
rejects a duplicate or unpatched tray resolution.

The approved Vite 8.3.0 / React plugin 6.1.1 migration uses Rolldown/Oxc and
Lightning CSS. Explicit JS/CSS output targets preserve the previous compiler
targets; this does not establish universal browser compatibility. Root fixtures,
Vitest, Tailwind and the app share Vite 8. Node 24 LTS is declared in `.nvmrc`
and used by CI/setup. Future Vite/plugin updates share a dedicated group.
Geist, React types, Playwright, env_logger and pkg-config updates are included.

- Application build source: `558383beae93aca2f82cbabe42e82d3ac831f58e`.
- Final package assembly source: `fb17c393b55ae4fc12f8df2d7947be7e015103e1`.
- Debian package: `voco_2026.0.54_amd64.deb`, 685,512,494 bytes.
- Package SHA-256: `dd88b4b946f13620a40ed6c544b51e2a448c09a92f441e3cf6cf2e34fc083736`.
- Packaged application SHA-256: `049b74133a7e7035ec3626c23e59423d3d494f9c160eb224361f27b86dbf504c`.
- Browser-host SHA-256: `06743eff9775a428cc5f8098da9d935553709861af4fcb9b1799a3505b443945`.

The base Tauri bundle was completed with the unchanged, pinned Nemotron model
and native runtime. Package verification checked manifests, native ELF identity,
relative links, metadata URLs, browser-host integration and notices. The packaged
app identity is authoritative: Tauri's bundling changes executable metadata.
Bundled documentation retains its assembly snapshot. Review corrected the .54
AppStream release description before the final assembly. A complete extracted-file
comparison found changes only in that metadata and five documentation files;
application, browser-host and speech-runtime bytes match the tested build. The
initial candidate and its evidence are retained separately.

## Completed checks

All four protected checks passed on the application build source in
[CI run 35732906382](https://github.com/sergiopesch/voco/actions/runs/35732906382).
The final PR and merged source also passed all four protected checks.

| Layer | Result |
| --- | --- |
| Source | Type checking, lint, version/DevOps gates, clean npm install and production build passed |
| Frontend | 449 tests in 54 files passed |
| Rust | 258 application, 19 browser-host and 7 GLib tests passed; one existing fixture-export test remains ignored |
| Native build | Locked release-mode build, custom-protocol tests and Clippy passed |
| Renderer | 16 dictation, 31 microphone, 42 native-capture and 7 branded-interface cases passed |
| Package tests | 22 focused payload, notice and staging tests passed |
| Packaged worker | 13 real-model lifecycle/protocol checks passed |
| Pinned speech corpus | Aggregate WER 0.025; original accuracy, silence, Stop-tail and continuity gates passed |
| Private desktop | All 12 GNOME 46 X11 cases passed with the exact packaged binary |
| Ubuntu package | APT installation and all installed-file integrity checks passed in a disposable Ubuntu 24.04 container |
| Guided installation | Final package installed from a fresh profile using the exact installer and independently verified publisher-signed package checksum |
| Installer prompts | Both real APT maintainer/conffile prompt cases passed; the owner setting was retained |
| Download handling | All 56 .53/.54 local transfer trials verified their payloads |

The desktop fixture used fresh profiles, private D-Bus and virtual PulseAudio,
with no physical audio/input devices. It exercised onboarding, launcher/status
handoff, rich-editor dictation, panel and fallback Stop, reconnect and focus-loss
recovery. Real audio drove 19 distinct fallback frames; silence selected the
idle meter, and Stop restored Ready. Focus departure retained recovery and left
the new field untouched. Renderer fixtures use mocked native/media boundaries
and repository Playwright. Screenshots were inspected for the microphone canvas,
selector, packaged setup and tray; their evidence remains separate from the
real packaged WebKit/GTK journey.

The final guided installer ran in disposable Ubuntu 24.04 lease
`cbx_34fb99269149` with the versioned download URLs redirected to loopback assets.
Installed-file integrity passed, Alt+D was set, and onboarding remained incomplete
with no microphone selected. Both Wayland helpers installed. Missing container
`uinput` correctly returned exit 2 after package installation; this is not desktop
readiness. After publication, a second fresh Ubuntu 24.04 environment,
`cbx_4a475c5b60ba`, ran the anonymously downloaded tagged installer against the
real GitHub HTTPS release URLs, with no transport substitution. Package integrity,
first-run defaults and both Wayland helpers passed again; missing `uinput` still
correctly reported incomplete desktop setup. This completes the public download
and installation path without claiming a physical-desktop test.

npm reports zero vulnerabilities. Cargo reports no vulnerability-class findings,
with seven unmaintained and one unsound warnings still visible. The existing
low rand advisory remains open: its old dependency is build-only and has the log
feature disabled. No advisory was dismissed, suppressed or waived.

## Preserved attempts and limits

- The first npm resolution left Vite 6 under root scripts while the app used
  Vite 8. Declaring the fixture dependency and deduplicating fixed this; the new
  DevOps gate rejects divergent app/fixture resolution.
- The first desktop fixture exceeded D-Bus's Unix socket-path limit before
  VOCO launched. A fresh profile at a shorter path passed all 12 cases.
- Ubuntu's minimal container initially excluded installed documentation. Its
  policy and missing-file output were preserved. Repeating installation with
  documentation enabled verified every installed file, including notices.
- Signing dialogs timed out before the owner unlocked the key; the final package
  checksum manifest now has a verified publisher signature. Failed attempts remain
  recorded and no signature from them is accepted.
- The first local installer transport fixture omitted the requested checksum alias.
  Installation correctly stopped before any package mutation. The corrected fixture
  serves the signed package checksum under the installer-requested filename.

Installer source changes only its version and artifact URLs; local transfer
fixtures do not measure Internet or whole-installation speed. Physical microphones,
owner-perceived motion, native Wayland cursor delivery and other desktops/apps
retain separate acceptance requirements. Local containers are not remote VMs or
proof of a distribution's default desktop. Other native channels stay at .43.

The signed tag, all five signed manifests and all 18 downloaded draft/public
assets passed verification. The source archive retains its cut-time record; this
repository records the subsequent publication verification.

Release commit: `fedcf0f666bb73a5e740fd524d5c9a817670332c`. Protected PR head: `d910a6534a2540ba05f266eca3e9d7326ec54ffb`.


## Repository and DevOps cleanup

PRs #61–#63 closed as merged through #65; their exact original tips are retained
in master. Their remote branches and the integration branch were removed. The
merge passed all four protected checks, and the resulting Dependabot update jobs
completed successfully without creating another PR. Branch protection, security
updates and the weekly grouped schedule remain enabled.

Task containers were removed after installation/removal receipts were retained.
The temporary build cache was removed (2.56 GB of regular files); immutable release
assets, candidate evidence and owner recovery remain available. The local guide
passed nine source/security tests and 25 browser checks after publication updates,
including all chapters, source search, its .43 source pin and the 390px layout.
The owner's exact public installer is staged separately; no host installation was
started by this release work.
