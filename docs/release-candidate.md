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

**2026.0.41 is the next private reliability candidate.** It prevents automatic
NVIDIA delivery after AudioWorklet fallback and uses the bundled NVIDIA model for
explicit recovery of normal dictation. Recovery does not insert text or download
Whisper. A private, bounded worker prevents late recovery requests from disturbing
live dictation; its temporary memory cost is separate from normal dictation.

The candidate includes the prior unreleased lifecycle extraction and dependency
updates. Public 0.39 remains frozen and unsigned; do not retag it or install 0.40.
This source version is not evidence of package acceptance or publication.
See [the recovery decision](decisions/2026-09-19-local-recovery.md) for scope and gates.

## Hosted builds

The GitHub Actions Release workflow must not assemble or publish NVIDIA
installers. Public 2026.0.39 used verified local artifacts. Do not re-enable
hosted installer publication until portable pinned NVIDIA provisioning is
verified from a fresh clone. See [release process](release-process.md).

## Later work

GTK 0.18, WebKit2GTK 2.0 and the single patched glib 0.18.5 copy stay in place.
Frozen 2026.0.39, 2026.0.38 and 2026.0.37 cuts remain historical.
