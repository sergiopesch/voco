# Release status

The recorded public Ubuntu/Debian release is **2026.0.59**. The
[latest GitHub release](https://github.com/sergiopesch/voco/releases/latest) is
authoritative for downloads; installed versions must be checked separately.

This cut includes Brave text preservation, immediate release of rejected GNOME
Stop reservations, capture-bound Stop through status changes, and isolation from older replies. Installer cleanup belongs to
its original process, protecting parent files/jobs when progress tasks stop early.
Follow setup's sign-out/sign-in guidance so GNOME loads companion version 4.

- [.59 changes](releases/2026.0.59.md)
- [Signed assets](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.59)
- [Exact-package qualification and limits](testing/stop-reservation-release-2026-09-23.md)

Private Brave Wayland/X11, Ghostty, GNOME upgrade/lifecycle, onboarding, five-minute
browser dictation/recovery and installer-launch checks pass. Fresh Ubuntu install,
installed worker and removal checks pass. Protected and merged-source CI, the signed
tag, five signed manifests and all 18 anonymous public assets are verified.

Model/runtime and input permissions are unchanged. The ten-minute session bound
remains; recovery stays in memory until copied, discarded or VOCO closes. Physical
devices, passive evdev/compositor concurrency, Snap confinement and untested desktop
combinations remain separate acceptance checks. Desktop key gestures are not atomic
with focus changes. The low Rand advisory remains visible with absent exploit
preconditions in the current graph; no security or speech gate was waived.

Fedora, openSUSE and Arch/Omarchy remain at **2026.0.43**. Published earlier releases
remain available and immutable. Bundled documentation retains its assembly snapshot.
Weekly dependency maintenance and protected checks remain enabled; the hosted
release assembler stays disabled.
