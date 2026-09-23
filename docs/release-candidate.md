# Release status

The recorded public Ubuntu/Debian release is **2026.0.58**. The
[latest GitHub release](https://github.com/sergiopesch/voco/releases/latest) is
authoritative for downloads; installed versions must be checked separately.

This cut preserves Brave address-bar text when stopping with Alt+D. The GNOME
companion consumes supported Stop chords, waits for modifier release and binds
held intent to the current recording. Native continuations reject selections and
revalidate the prepared caret before paste. An upgraded but still-loaded older
companion correctly requests a desktop session restart.

- [.58 changes](releases/2026.0.58.md)
- [Signed assets](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.58)
- [Exact-package qualification](testing/brave-release-2026-09-23.md)

The final package passes private native Brave Wayland/X11 Stop, GNOME companion
upgrade/lifecycle, Ghostty, onboarding and five-minute browser dictation/recovery
checks. Fresh Ubuntu installation, installed worker checks and removal pass.
Protected and merged-source CI, the signed tag, five signed manifests and all
18 anonymous public assets are verified, including latest aliases and the installer.

The ten-minute session bound remains. Recovery stays in memory until copied,
discarded or VOCO closes. Physical devices, passive evdev/compositor concurrency,
Snap confinement and untested desktop combinations remain separate acceptance
checks. Native key gestures cannot be atomic with recipient focus changes. The
existing low Rand advisory remains visible with absent exploit preconditions in
the current graph; no security or speech gate was waived.

Fedora, openSUSE and Arch/Omarchy remain at **2026.0.43**. Public .57 remains
available for rollback. Published tags and artifacts are immutable. Bundled docs
retain their assembly snapshot. Weekly dependency maintenance and protected checks
remain enabled; the hosted release assembler stays disabled.
