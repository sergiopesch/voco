# 2026.0.57 release qualification

The complete Debian package was built and assembled from clean commit
`ee71778`, incorporating `ec67c7a` (onboarding/recovery) and `9c1a28a`
(installer branding). Subsequent changes update qualification documentation and
make the private browser recovery fixture explicitly open the saved transcript;
they do not change the packaged product sources.

## Exact artifact

- Debian package: 685,719,774 bytes; SHA-256
  `1df7d1f6ea186db10af309bfdbb133e63aedc7444264d5e6ef6268e36f37fe3c`.
- Packaged application: SHA-256
  `9cfd14cb4aee5c563b75397d6dd8f717ab88e59b916ca912f44104154ef9aa2a`.
- The pinned model, recognition libraries and private input helper match .56.
  Source and package identities are retained in the release provenance.

## Verification

- Local DevOps preflight, type checking, lint, full test chain (including 393
  desktop tests), production build and complete Debian payload checks passed.
- Fresh Ubuntu 24.04 local-container installation used the guided installer's
  APT function. All 410 installed inventory entries and ten ELF dependencies
  checked; `dpkg --verify` was empty. All 13 installed-worker checks passed.
  Removal left none of the 332 package-owned files/links. The owned Crabbox
  lease `cbx_cfd8186399d2` was stopped and removed.
- Ten private GNOME X11/Ghostty application cases passed against the packaged
  executable, including fresh onboarding directly to the tray, repeated Start
  and Stop, held-key handling, and tab departure with recovery and no replay.
- Ten private Chromium application cases passed, including full-reference long
  speech, focus-loss recovery opened only on request, subsequent fresh sessions,
  navigation, tab closure and native-host disconnect.
- Native GNOME Wayland onboarding passed with synthetic PulseAudio, complete
  captured audio and unchanged private clipboard. This audio fixture stops at
  completion of the voice test; Done-to-tray is independently checked in the
  packaged X11 journey and renderer regressions.
- The actual installer launch helper opened the exact packaged app on private
  X11 and native Wayland sessions without recording or touching owner input.
- Required protected CI, including pinned Nemotron accuracy/continuity and Rust
  auditing, remains a publication gate. The signed validation asset records its
  final protected and merged commit receipts.

## Retained failures and limits

The first browser run passed delivery and long speech, then correctly found no
visible recovery controls. Its fixture still expected automatic presentation.
The updated fixture first requires recovery to remain hidden, explicitly opens
the existing private app, then activates the real recovery control. The final
complete run passed. Both attempts are retained.

The first launch fixture retained .56's expected executable hash and refused the
new binary. It was updated to the exact .57 hash and rerun; a later final run also
corrected its historical scope label. No failed receipt was overwritten.

See the separate [installer benchmark](installer-brand-2026-09-23.md) and
[onboarding/recovery report](onboarding-recovery-2026-09-23.md) for implementation
measurements, the five-minute recognition fixtures and their limits. The original
owner-reported interruption's exact trigger remains unconfirmed; no crash was
observed in that incident. The ten-minute session bound remains.

Private virtual audio and local-container checks do not establish physical
microphone, default PipeWire, owner-perceived motion, kernel input or universal
desktop compatibility. The private browser desktop has no notification daemon;
notification presentation there is covered by renderer request checks, not a
claim of a painted notification. The existing low-severity Rand advisory remains
visible and assessed separately. Frozen earlier releases and evidence are kept.
