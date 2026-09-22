# Release status

The [latest published GitHub release](https://github.com/sergiopesch/voco/releases/latest)
is authoritative for downloads. Source metadata does not establish what is installed.

The **2026.0.55 source candidate** fixes Brave address-bar suggestion focus,
WebKit focused containers and empty HTML editor readback, and keeps the installer
inside one terminal canvas. Its [application qualification](testing/application-delivery-2026-09-22.md)
and [candidate notes](releases/2026.0.55.md) are separate from publication.
The installed owner application and public downloads remain .54.

The recorded public Ubuntu/Debian release is **2026.0.54**. It integrates the
remaining dependency PRs #61–#63, including Vite 8, React plugin 6, Node 24 LTS
build tooling and Tauri's matching patched tray library. The Signal + Silver sweep
installer, microphone setup, shortcut protection and Nemotron recognizer are retained.

- [.54 changes and installation](releases/2026.0.54.md)
- [Signed assets and provenance](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.54)
- [Exact-package qualification](testing/vite8-release-2026-09-22.md)
- [Installer performance method and .52 measurements](testing/installer-performance-2026-09-22.md)

All four protected checks passed on the final PR and merged source. The package
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
