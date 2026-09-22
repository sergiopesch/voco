# Release status

The [latest published GitHub release](https://github.com/sergiopesch/voco/releases/latest)
is authoritative for current downloads. A source version or local receipt does
not establish installation on a particular computer.

**Unreleased source work:** the [installer performance candidate](testing/installer-performance-2026-09-22.md)
adds measured Signal + Silver sweep progress and removes avoidable download waits.
It has local fixture and Ubuntu APT evidence, not a new signed release. Public .51
assets and installed applications retain their original bytes.

The recorded public Ubuntu/Debian release is **2026.0.51**. It combines live tray
volume bars, microphone setup in one canvas, packaged GNOME panel activation,
rich-editor delivery fixes and one bundled Nemotron recognizer. The retired
recognizer, downloader, vendor code and dependencies are removed.

- [.51 changes and upgrade instructions](releases/2026.0.51.md)
- [Signed release assets, provenance and validation](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.51)
- [Final archive checks and publication verification](testing/linux-release-2026-09-22.md)
- [Combined package and desktop qualification](testing/tray-setup-2026-09-21.md)
- [Recognition-engine retirement](testing/nemotron-only-2026-09-21.md)

All four protected source CI checks passed. The final Debian archive passed
payload verification and clean Ubuntu installation/removal. Its product payload
matches the qualified .51 local candidate; documentation and package metadata
were refreshed. Publisher signatures and uploaded/downloaded artifact hashes
were verified. The source archive identifies the merged release commit; bundled
documentation retains its pre-publication assembly snapshot.

Virtual audio, nested GNOME and container checks retain their recorded scope.
Physical microphones, perceived motion on every panel and wider compositor/app
compatibility remain unqualified. This release makes no broader accuracy or
performance claim.

Fedora, openSUSE and Arch/Omarchy downloads remain at **2026.0.43**. Use the matching
[native installation guide](install-native.md) and [support matrix](linux-support.md).
Their historical results do not qualify .51 on those desktops.

The earlier [.47 public release](releases/2026.0.47.md) remains available for
rollback. The frozen .48–.50 local candidates and .51+local1 qualification package
retain their original hashes and records; publication does not replace them or
change an existing user's installed version.
