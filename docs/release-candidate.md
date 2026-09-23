# Release status

Source **2026.0.58** is under qualification for the Brave Stop correction.
See [.58 changes](releases/2026.0.58.md). Public downloads remain as recorded below.

The recorded public Ubuntu/Debian release is **2026.0.57**. The
[latest GitHub release](https://github.com/sergiopesch/voco/releases/latest) is
authoritative for available downloads; source metadata does not establish what
is installed on a particular computer.

This release adds a prominent silver installer wordmark and branded progress
accents, returns directly to the tray after onboarding, and preserves healthy
local transcription when delivery is interrupted. Recovery sends a notification;
saved text opens only when requested. It never retries uncertain insertion.

- [.57 changes](releases/2026.0.57.md)
- [Signed assets and provenance](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.57)
- [Exact-package qualification and publication](testing/tray-brand-release-2026-09-23.md)
- [Previous Ghostty and input qualification](testing/installer-ghostty-2026-09-23.md)

The exact application passes ten private Ghostty cases, ten browser cases and
native Wayland onboarding. The final package passes fresh Ubuntu installation,
13 installed-worker checks and removal; the guided launch helper passes on private
X11 and Wayland. Four protected CI jobs, merged-source CI, the signed tag, five
signed manifests and all 18 anonymous public assets are verified, including
latest aliases and the tagged installer.

The ten-minute session bound remains. Saved recovery is held in memory until
copied, discarded or VOCO closes. Physical microphones, default PipeWire,
owner-perceived motion and untested desktop/application combinations remain
separate acceptance checks. Terminal dispatch does not establish caret, writable
mode, password state or text readback. The existing low-severity Rand advisory
remains visible and assessed separately.

Fedora, openSUSE and Arch/Omarchy remain at **2026.0.43**; use their matching
[native guide](install-native.md) and [support matrix](linux-support.md).
[2026.0.56](releases/2026.0.56.md) remains available for rollback. Published tags
and artifacts are immutable. Bundled docs retain the package-assembly snapshot;
publication documentation does not replace the signed source or package.
Protected checks and weekly dependency maintenance remain enabled. The hosted
release assembler stays disabled; publisher signing stays local.
