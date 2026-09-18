# Release status

**2026.0.39 is the current public release.** It backports the upstream glib
iterator safety fix while retaining VOCO's dictation-only UI, NVIDIA English
model and streaming cursor delivery.

- [GitHub release](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.39)
- Source tag: `voco.2026.0.39` (`fb957ff052547c24be92265b6b5343a4c29aff4b`)
- [Release record](releases/2026.0.39.md)

The Debian package is amd64. The tag is unsigned and must stay that way.
Checksums verify file integrity; they are not a publisher signature. Isolated delivery tests do not
prove every Linux desktop, compositor or application.

**2026.0.40 is the next private candidate.** This tree versions the live-preview
and Stop-tail extract already on master, refreshes leaf npm/cargo dependencies,
and updates Tauri 2.11.1 / wry 0.55.1 / serde_with 3.23.0 on the vendored glib
0.18.5 patch. It is not a public download.
Sign only this cut (`git tag -s` and checksum `.asc`); never retag 0.39.

## Hosted builds

The GitHub Actions Release workflow must not assemble or publish NVIDIA
installers. Public 2026.0.39 used verified local artifacts. Do not re-enable
hosted installer publication until portable pinned NVIDIA provisioning is
verified from a fresh clone. See [release process](release-process.md).

## Later work

GTK 0.18, WebKit2GTK 2.0 and the single patched glib 0.18.5 copy stay in place.
The failed React bump stays off this candidate. Frozen 2026.0.39, 2026.0.38 and
2026.0.37 cuts remain historical.
