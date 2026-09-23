# Release status

The [latest published GitHub release](https://github.com/sergiopesch/voco/releases/latest)
is authoritative for downloads. Source metadata does not establish what is installed.

The recorded public Ubuntu/Debian release is **2026.0.56**. It opens VOCO after
guided installation, supports Ghostty's focused terminal pane, preserves microphone
readiness after destination rejection and fixes repeated X11 starts by waiting for
the matched shortcut release. The pinned local recognizer, model, input permissions
and recovery contract are unchanged.

- [.56 changes and installation behavior](releases/2026.0.56.md)
- [Signed assets and provenance](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.56)
- [Exact-package qualification and publication record](testing/installer-ghostty-2026-09-23.md)
- [Previous .55 security, performance and helper qualification](testing/release-qualification-2026-09-23.md)

The exact package passes fresh Ubuntu installation/removal, 13 installed worker
checks, ten private GNOME X11/Ghostty application cases, nine browser cases,
native Wayland onboarding and installer opening on private X11 and Wayland.
The final helper also passes separate 22-stage X11 and native Wayland checks.
Earlier .55 VM input and service-migration evidence remains historical; unchanged
runtime/helper bytes do not turn those checks into new runs.

The publication record binds final protected and merged CI, the signed tag,
five signed manifests and all 18 anonymous public assets, latest aliases and the
tagged installer. Bundled docs retain their assembly snapshot; publication
documentation does not replace the signed package, source archive or assets.

A focused Ghostty pane does not establish caret position, writable mode, password
state or text readback. Terminal delivery confirms dispatch and sends no Enter or
control characters. Physical microphones, default PipeWire, owner-perceived motion
and untested desktops/applications remain separate acceptance checks.

Fedora, openSUSE and Arch/Omarchy remain at **2026.0.43**; use the matching
[native guide](install-native.md) and [support matrix](linux-support.md).
[2026.0.55](releases/2026.0.55.md) remains available for rollback. Published tags
and assets remain immutable; new application bytes require another qualified
release. Weekly maintenance, protected checks and the separate security update
queue remain enabled. The hosted release assembler stays disabled.
