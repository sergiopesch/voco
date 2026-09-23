# Release status

The [latest published GitHub release](https://github.com/sergiopesch/voco/releases/latest)
is authoritative for downloads. Source metadata does not establish what is installed.

The **2026.0.55 candidate** integrates the security, delivery, installation,
performance and code cleanup review, including the native Pulse latency fix and
the approved private legacy input daemon. The helper fixes descriptor exhaustion
without replacing the system daemon or changing input permissions. Migration is
limited to VOCO's unmodified service at an idle application boundary.

The [candidate notes](releases/2026.0.55.md) describe the changes;
[23 September qualification](testing/release-qualification-2026-09-23.md) tracks
exact artifacts and release gates. The [22 September assessment](testing/release-readiness-2026-09-22.md)
retains earlier artifacts and failed attempts. Final protected CI, signing,
package/desktop qualification and downloaded-asset verification are required
before publication. The source version alone is not a published release.

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
