# 2026.0.57 release qualification

The complete Debian package was built and assembled from clean commit
`ecca9b7`, incorporating `ec67c7a` (onboarding/recovery) and `9c1a28a`
(installer branding). This includes the deterministic animation interruption regression and the private
browser recovery fixture that explicitly opens saved text. Later documentation
changes do not change packaged product sources.

## Exact artifact

- Debian package: 685,721,046 bytes; SHA-256
  `1f5f62559f53d034584705c135a6be66a54f8a266e5596b4768a095aeafcb111`.
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
  lease `cbx_f105bcdd5374` was stopped and removed.
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

The first package is retained as superseded. Reassembly corrected AppStream's
release description; the application, helpers and speech payload are byte-identical
to the completed desktop/browser checks. Final installation/removal and installer
launch checks were rerun against the rebuilt package.

The final installer passes 56/56 alternating benchmark trials with verified
payload hashes and the new deterministic mid-redraw interruption test. In the
paced animated fixture, median baseline/candidate wall time was 0.7911/0.7914 s
and CPU time 0.0478/0.0515 s. These local transfer fixtures do not measure real
network, APT or owner-perceived motion.

## Retained failures and limits

Automated review caught a redraw race despite passing CI. Terminating a sweep
between row writes could corrupt earlier terminal output. The deterministic
regression first failed, then passed after buffering the complete canvas and
emitting it with one builtin. Both AppStream entries now describe .57 while
retaining .56 as history. Both review threads were resolved after verification.

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

## Verified publication

Public release [voco.2026.0.57](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.57)
is verified. All four required protected jobs and merged-source CI passed before
the signed cut. The signed validation asset binds their exact heads and job URLs.

- Release commit: `1da787aaafd025ad2b1b6b311d0c23dc6a83a38a`.
- Signed tag object: `3067395e324f40f0db20ebe927eb1ca357af2747`.
- Anonymous verification: `2026-09-23T16:03:29.440521+00:00`; all 18 assets and five signatures passed, including latest aliases and the raw tagged installer.
- Verification receipt SHA-256: `c4dc7e1db4c10e2de5b29e3ce4681dc6c0174843d02a44335214b0adc480d7f8`.

Publication documentation does not change the frozen package or source archive.
