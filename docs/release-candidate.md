# Release status

The [latest published GitHub release](https://github.com/sergiopesch/voco/releases/latest)
is authoritative for downloads. Source metadata does not establish what is installed.

The recorded public Ubuntu/Debian release is **2026.0.55**. It integrates the
security, delivery, installation, performance and code cleanup review, including
the native Pulse latency fix and private legacy input daemon. The helper fixes
descriptor exhaustion without replacing the system daemon or changing input
permissions. Migration is limited to VOCO's unmodified service at an idle application
boundary. The pinned Nemotron recognizer and recovery contract are unchanged.

- [.55 changes and upgrade instructions](releases/2026.0.55.md)
- [Signed assets and provenance](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.55)
- [Exact-package qualification and publication record](testing/release-qualification-2026-09-23.md)
- [Earlier review and retained failed attempts](testing/release-readiness-2026-09-22.md)
- [Installer performance method and .52 measurements](testing/installer-performance-2026-09-22.md)

The exact package passes Ubuntu installation/removal, 13 installed worker checks,
16 GNOME X11 application cases, nine browser lifecycle cases, native Wayland
onboarding, and real VM helper protocol and migration checks. The publication
record binds final protected and merged CI, the signed tag, five signed manifests,
and verification of all 18 draft/public assets, latest aliases and tagged installer.
Bundled docs retain their assembly snapshot; the source archive retains its cut-time
record. Subsequent publication documentation does not replace those frozen artifacts.

Physical microphones, default PipeWire capture, owner-perceived motion, global
shortcut configuration and untested desktop/application combinations remain
separate acceptance checks. Containers and download fixtures do not establish
default-desktop behavior or Internet installation speed.

Fedora, openSUSE and Arch/Omarchy remain at **2026.0.43**; use the matching
[native guide](install-native.md) and [support matrix](linux-support.md).
[2026.0.54](releases/2026.0.54.md) remains available for rollback. Published tags
and assets remain immutable; new shipped application bytes require another
qualified release. Weekly maintenance, protected checks and the separate security
update queue remain enabled. The hosted release assembler stays disabled.
