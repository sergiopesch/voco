# Release status

The [latest published GitHub release](https://github.com/sergiopesch/voco/releases/latest)
is authoritative for current downloads. Source metadata does not establish what
is installed on a particular computer.

The recorded public Ubuntu/Debian release is **2026.0.52**. It adds measured
Signal + Silver sweep installer progress, overlapping checksum retrieval and
lower download overhead. Native prompts and reduced-motion/plain fallbacks are
retained. The rebuilt app keeps .51 dictation behavior, live tray bars, microphone
setup in one canvas and the same pinned Nemotron model/runtime.

- [.52 changes and installation](releases/2026.0.52.md)
- [Signed assets, source, provenance and validation](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.52)
- [Exact-package checks and publication verification](testing/installer-release-2026-09-22.md)
- [Exact-installer download measurements](testing/installer-performance-2026-09-22.md)

All four protected CI checks passed before the normal merge; the merged source
also passed CI. Publisher signatures and every draft/public asset hash were
verified. The complete package passed payload/metadata verification, Ubuntu
container install/removal, 13 packaged worker checks and 12 isolated GNOME X11
desktop checks. Bundled docs retain their assembly snapshot, as recorded in
provenance; final source and public docs include the exact-installer benchmark rerun.

Virtual audio and nested desktop checks do not qualify physical microphones,
owner-perceived smoothness or every compositor/application. The .52 checks do
not requalify native Wayland cursor delivery. Local download measurements are
not whole-install or Internet speed claims.

Fedora, openSUSE and Arch/Omarchy remain at **2026.0.43**; use the matching
[native guide](install-native.md) and [support matrix](linux-support.md).
The [.51 release](releases/2026.0.51.md) remains available for rollback. Earlier
frozen candidates and desktop evidence retain their original identities.
