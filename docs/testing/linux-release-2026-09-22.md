# .51 public release — 22 September 2026

The Ubuntu/Debian **2026.0.51** release combines the .48–.50 fixes, measured tray
bars, microphone setup in one canvas and the removal of the alternate recognizer.
Fedora, openSUSE and Arch/Omarchy channels remain at .43.

## Source and artifacts

- Signed tag: `voco.2026.0.51`.
- Merged source: `cbe3b21c5094721616cb663cbc830caba7f74d29` (PR #44, including #43).
- Application build: `83337329454cd9f8b4ed78b48e159c19153e0ac1`.
- Package assembly and protected PR head: `5c2ea1e376ecbf87c263eec35b2b63868d0995cc`.
- Package SHA-256: `58457abd0c6f8d1b2e3ec5c21777f9a136c66eb3dceb67cd783445af52ef9b40`.
- Source archive SHA-256: `4cd55b0ab28c025b5f00f40374cdc898fa1db16440e0c263e577a1f864b14266`.

All four CI gates passed on both the PR head (run `35664414518`) and merged
master (run `35664866021`). Their source trees match. The later Rust change only
reorders the test module; the release follow-up changes documentation and notes.

The final package's application, browser host, runtime, model and desktop
integrations match the frozen .51+local1 candidate byte for byte. Only bundled
documentation and the package-version manifest differ. The source archive records
the merged commit. Bundled docs retain their pre-publication assembly snapshot;
the repository's download pointers were updated after publication.

## Final archive checks

Complete package metadata, AppStream URLs, dependency floors, pinned payloads and
licenses passed verification. A fresh Ubuntu 24.04 Crabbox local-container
(`cbx_8bd17ec355a7`) passed APT installation, package integrity, version/CLI and
panel-payload checks, then removal. The lease was stopped and deleted. This is
userspace/package evidence, not a default installed desktop.

The guide passed nine unit tests and browser checks for navigation, quizzes,
simulations, source reading, search, glossary and narrow layout. Its historical
source catalog remains pinned. The [combined qualification record](tray-setup-2026-09-21.md)
retains the earlier renderer, packaged-worker and isolated GNOME/audio results,
including attempted failures and their limits.

## Publication

The publisher signed the release tag and five checksum manifests with fingerprint
`B33C7C6AAEC8C20433A7A837540796453D8E3865`. All 18 uploaded assets were downloaded
from the draft and matched the recorded local bytes. Signature verification passed.
After publication, anonymous downloads of all 18 assets also matched. The latest
aliases resolve to .51 and the tagged guided installer matches its release asset.

[Release assets, signed manifests, provenance and validation](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.51)
provide the public identities. Private logs, desktop images and failed attempts
remain outside the repository. Earlier releases and candidates are preserved.

Physical microphones, perceived motion on every panel and wider compositor/app
compatibility remain unqualified. No new general accuracy or performance claim is
made. Publication did not upgrade the owner's installed .50 or reset its profile.
