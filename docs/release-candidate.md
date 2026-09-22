# Release status

The [latest published GitHub release](https://github.com/sergiopesch/voco/releases/latest)
is authoritative for downloads. Source metadata does not establish what is installed.

The recorded public Ubuntu/Debian release is **2026.0.53**. It integrates the
12 dependency updates queued at the start of the maintenance pass, preserving
VOCO's X11 shortcut protection and the pinned Nemotron model/runtime. The
Signal + Silver sweep installer, live tray bars and compact microphone setup are retained.

- [.53 changes and installation](releases/2026.0.53.md)
- [Signed assets and provenance](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.53)
- [Exact-package qualification and cleanup audit](testing/dependency-release-2026-09-22.md)
- [Installer performance method and .52 measurements](testing/installer-performance-2026-09-22.md)

All four protected checks passed on the final PR and merged source. The complete
package passed payload/metadata verification, Ubuntu container installation/removal,
13 packaged worker checks and 12 isolated GNOME X11 desktop cases. Publisher
signatures and every draft/public asset were downloaded and verified. The source
archive retains the qualification snapshot from the release cut. Publication
verification was added afterward to the repository's qualification record;
bundled docs retain their earlier assembly snapshot.

The new grouped dependency queue is the next review batch, separate from this
frozen release. New application bytes require another qualified version.

Physical microphones, owner-perceived motion, native Wayland cursor delivery and
other desktop/application combinations remain separate checks. Local download
fixtures do not establish Internet or whole-installation speed.

Fedora, openSUSE and Arch/Omarchy remain at **2026.0.43**; use their matching
[native guide](install-native.md) and [support matrix](linux-support.md).
[2026.0.52](releases/2026.0.52.md) remains available for rollback. Published tags
and release assets are immutable. The hosted release assembler stays disabled.

## Next candidate

**2026.0.54** reviews the remaining dependency queue and carries VOCO's immutable
tray icon patch onto Tauri's updated tray library. The [candidate notes](releases/2026.0.54.md)
record its scope and pending qualification. Continue using the verified public
.53 installer until the new cut is published and its downloaded assets verify.
