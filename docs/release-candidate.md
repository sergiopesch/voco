# Release status

**2026.0.39 is the current public release.** It backports the upstream glib
iterator safety fix while retaining VOCO's dictation-only UI, NVIDIA English
model and streaming cursor delivery.

- [GitHub release](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.39)
- Source tag: `voco.2026.0.39` (`fb957ff052547c24be92265b6b5343a4c29aff4b`)
- [Release record](releases/2026.0.39.md)

The Debian package is amd64. The tag is unsigned. Checksums verify file
integrity; they are not a publisher signature. Isolated delivery tests do not
prove every Linux desktop, compositor or application.

## Hosted builds

The GitHub Actions Release workflow must not assemble or publish NVIDIA
installers. Public 2026.0.39 used verified local artifacts. Do not re-enable
hosted installer publication until portable pinned NVIDIA provisioning is
verified from a fresh clone. See [release process](release-process.md).

## Later work

Further product-code changes require a new version. Frozen 2026.0.38 and
2026.0.37 cuts remain historical. Open dependency PRs stay separate when they
cannot compile with the current GTK/WebKit stack.
