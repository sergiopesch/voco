# VOCO 2026.0.52 release qualification · 22 September 2026

Published Ubuntu/Debian x86_64 release: [voco.2026.0.52](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.52).
The guided installer now follows measured work without waiting for animations.
The app is rebuilt for .52; dictation code, model and native speech runtime are
unchanged from .51. Other native distribution channels remain at .43.

## Artifact identity

- Release commit: `8d9cb8a6c16c1c1a23aa8393ab822db76d8ba1e2`.
- Application build and package assembly: `36c105960efd63615f8f15fff6a62f81a779fe4b`.
- Final protected CI head: `653f9376eb55c08b07f65698528bcee1fd379606`.
- Debian archive SHA-256: `81d300904fb45e309e033b3ad4c03962fe12294422f24e871e7cfd2dfedefb13`.
- Packaged application SHA-256: `2ed0ac6da90c0abafabba88fabb022fe1f1edbe25056a80d0f8120decdf5a72c`.
- Exact installer SHA-256: `0d9d34b8b2defe6c95fc65c960284310883e4f67c0cb20e051cf621cb94ad097`.
- Publisher: `B33C7C6AAEC8C20433A7A837540796453D8E3865`.

The merged tree equals the checked PR tree. After assembly, only documentation
and numeric benchmark records changed. Bundled docs keep their assembly snapshot;
the source archive and final public docs include the post-version-bump benchmark.
Provenance distinguishes the pre-bundle executable from the packaged executable.

## Checks

All four protected checks passed on the [final PR head](https://github.com/sergiopesch/voco/actions/runs/35715215770)
and [merged source](https://github.com/sergiopesch/voco/actions/runs/35715855491).
Local validation passed type/lint/devops gates, 449 frontend tests, 16 dictation,
31 microphone and 42 native-capture renderer cases, exact-field and rich-editor
delivery fixtures, pinned-model accuracy/continuity and 13 packaged worker checks.
The small public speech corpus retained aggregate WER 0.025; this is not a general
accuracy claim.

The complete archive passed payload, notices, dependency, metadata and AppStream
URL verification. Dedicated Ubuntu 24.04 local-container lease `cbx_f0f8b83048a1`
passed real APT maintainer/conffile prompts, exact-script installation and removal.
The script used a transport-only loopback redirect to exact .52 assets. Package
integrity was clean, onboarding defaulted false, microphone selection was null
and the shortcut was Alt+D. Exit 2 correctly reported missing container uinput;
package success did not become a desktop-readiness claim. The lease was stopped.

The exact packaged application passed 12/12 private GNOME 46 X11 cases with
virtual public audio and Chromium: fresh onboarding, visible Done handoff,
launcher behavior, repeated rich-editor dictation, voice/silence tray feedback,
repeated Stop, companion reconnection and focus-departure recovery. The fallback
meter produced 19 distinct frames. No test audio was injected into the owner session.

All 56 download trials were rerun against the exact .52 script and verified their
payload hashes. Their [complete numeric record](installer-performance-2026-09-22.md)
retains scope, denominators and the separate earlier pre-version run.

The signed tag, five checksum manifests and all 18 uploaded assets were verified
after draft download and again through anonymous public downloads. Versioned and
latest package aliases match; the raw tagged installer matches the signed asset.
The hosted release assembler remains disabled.

## Preserved attempts and limits

Initial attempts encountered missing build/Xvfb headers, an unsupported audit
flag, container documentation exclusions and an overlong AT-SPI socket path.
These fixture/setup failures were retained and corrected before passing reruns.
An old full-app harness expected retired manual-copy behavior and failed when the
app delivered to the bound field; the current cursor-contract harness passed
separately. The interrupted long-path desktop run is not counted as a completed
trial. The release validation asset lists these attempts and hashes their receipts.

Cargo audit passed with no vulnerability-class findings; existing informational
warnings remain recorded. The low rand advisory remains assessed in the
[dependency record](../security/dependency-assessment-2026-09-04.md), with the
affected log feature disabled. No advisory waiver or dependency upgrade was added.

The final container install reused system dependencies after the initial fixture
failure; it is not a cold-OS speed benchmark. Physical microphones, owner-perceived
motion, native Wayland cursor delivery and wider desktop/application compatibility
remain separate checks. Public download verification establishes bytes and signatures,
not completion of the owner's hands-on installation.
