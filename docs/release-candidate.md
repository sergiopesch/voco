# Release status

The [latest published GitHub release](https://github.com/sergiopesch/voco/releases/latest)
is authoritative for downloads. Source metadata does not establish what is installed.

The **2026.0.55 candidate has been built, packaged and tested**, including the
delivery/installer corrections, security hardening, code cleanup and native Pulse
latency fix. The latest Debian package with SHA-256
`652c50e97f41836f87891b813fc2173a891ea6622a01b97b3fd9b7ac743c5ac2` passed 16
private GNOME 46 X11 application checks, nine packaged browser cases and strict
native Wayland onboarding with complete audio, expected transcription and capture
release after Stop. A fresh APT app installation in reused disposable Ubuntu 24.04
userspace passes complete inventory and `dpkg --verify`; removal leaves none of
its 287 non-directory payload paths. The earlier candidate is superseded after
failing complete native speech.
Read the [candidate notes](releases/2026.0.55.md) and
[release-readiness review](testing/release-readiness-2026-09-22.md) for exact
identities, source snapshot, failed attempts and limits. These are private synthetic
fixtures and local-container evidence, not physical-microphone, default PipeWire
or owner-session Wayland acceptance. Bundled documentation retains its assembly-time
snapshot.

**Release is held for the permanent legacy `ydotoold` dependency decision and its
qualification.** The prepared leak fix is not integrated; the user's dependency
choice remains pending. Final protected CI, applicable owner and
physical acceptance, signing and downloaded-asset verification also remain release
gates; current CI verdicts are on [PR #67](https://github.com/sergiopesch/voco/pull/67).
This package is unsigned and unpublished; the owner's installed application
and recorded public downloads remain .54. Stop before switching fields: desktop
paste cannot make focus changes atomic with key delivery.

The recorded public Ubuntu/Debian release is **2026.0.54**. It integrates the
remaining dependency PRs #61–#63, including Vite 8, React plugin 6, Node 24 LTS
build tooling and Tauri's matching patched tray library. The Signal + Silver sweep
installer, microphone setup, shortcut protection and Nemotron recognizer are retained.

- [.54 changes and installation](releases/2026.0.54.md)
- [Signed assets and provenance](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.54)
- [Exact-package qualification](testing/vite8-release-2026-09-22.md)
- [Installer performance method and .52 measurements](testing/installer-performance-2026-09-22.md)

For .54, all four protected checks passed on the final PR and merged source. The package
passed verification, fresh Ubuntu installation/removal, 13 real-model worker checks
and 12 private GNOME X11 cases. Five publisher signatures and all 18 draft/public
assets were downloaded and verified, including latest aliases and the tagged installer.
The source archive retains its cut-time qualification record. This repository
records subsequent publication verification; bundled docs retain the assembly snapshot.

Future Vite and React plugin updates share one Dependabot group. Weekly maintenance
and required checks remain enabled, with merged branches removed automatically.
New shipped application bytes require another qualified release.

Physical microphones, owner-perceived motion, native Wayland cursor delivery and
other desktop/application combinations remain separate acceptance checks. Local
containers and download fixtures do not establish default-desktop or Internet speed.

Fedora, openSUSE and Arch/Omarchy remain at **2026.0.43**; use the matching
[native guide](install-native.md) and [support matrix](linux-support.md).
[2026.0.53](releases/2026.0.53.md) remains available for rollback. Published tags
and assets remain immutable; the hosted release assembler stays disabled.
