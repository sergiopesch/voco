# VOCO .55 release qualification — 23 September 2026

This record completes the [whole-codebase assessment](release-readiness-2026-09-22.md).
Earlier candidate packages and failed trials remain retained. Publication is
established by GitHub Releases and its signed validation manifest, not by source
version metadata. Bundled documentation retains its assembly snapshot.

## Exact release candidate

Application build and package assembly used clean source
`7b2cdfc725cad7ee256f6f8b2fb6b6f708e85edf`, with Node 24.21.0, Rust 1.94.0,
GCC 13.3.0 and four Cargo build jobs. Subsequent qualification-document changes
are recorded separately in release provenance; they do not rebuild the application.

| Artifact | SHA-256 |
| --- | --- |
| Complete Debian package, 685,746,914 bytes | `1db963e2db1969978484829faacb908389b3e4d6659c537d4aa97823ccfab3b0` |
| Packaged application | `a6f5a97d413f631c4f2b2cbe4bc284a0c561cfbe788f56e2b8928b28ee031299` |
| Browser host | `1e8522c51023dc933db37f7c89660fb8648be1083a1e29eb5c9c1aa3bd1c35b3` |
| Private legacy daemon, 31,024 bytes | `53766df8c681ef60ef3437c74f0bf73433601cfb0e006279c990a5338361ccbc` |
| Pinned Nemotron model | `d9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d` |

## Source, security and maintenance

All four [protected build-source checks](https://github.com/sergiopesch/voco/actions/runs/35830103532)
passed: Code Guide, Frontend Checks, Rust Check & Test and RustSec Audit. The
release also requires the same gates on the final reviewed and merged source.

The complete npm chain includes 390 frontend tests. Rust passes 276 library,
25 browser-host, seven dependency and 25 replay tests; development-feature tests,
all-feature Clippy, formatting and production build pass. One dedicated offline
audit export remains explicitly ignored. CI passes the pinned speech accuracy,
continuity and 13 worker-protocol checks, native C capture regression, toolkit
clipboard matrices and renderer/accessibility checks.

The new helper has authenticated upstream source, a minimal reviewed patch,
complete source/license notices and a checked build manifest. Two fresh builds
produce identical binary, unstripped ELF and manifest bytes. Twenty isolated
production-ELF lifecycle/failure cases pass, including 4,000 completed connections;
the unpatched daemon fails the same EOF regression. Four source-integrity negative
checks reject tampered, linked, unexpected or conflicting inputs. Twenty-five
service selection, migration and package-tamper tests pass. Vendor verification, service checks and the 20-case lifecycle regression are
now permanent CI gates.

npm reports zero advisories and Cargo no vulnerability-class findings. The seven
maintenance notices and the assessed rand `log`-feature warning remain visible;
see [security scope and limitations](../security/README.md). Distro/native
libraries and input helpers are outside npm/Cargo scanner coverage.

## Exact-package qualification

- **Ubuntu 24.04 userspace:** fresh installation through the real guided-installer
  APT function, all 404 inventory entries and ten ELF objects verified, empty
  `dpkg --verify`, exact client/private-helper selection and 13 installed real-model
  protocol checks. Removal leaves none of 326 package-owned non-directory paths
  and creates no app profile. Crabbox lease `cbx_625defbd4d93` uses local-container;
  it has no host audio/input device exposure and is not a desktop VM.
- **GNOME 46 X11 application:** 16 of 16 checks pass with the final packaged app,
  fresh private profile and synthetic Pulse audio: onboarding, visible status,
  tray listening/Stop, Chromium rich text, Brave suggestions, Bash/nano and the
  destination change after clipboard preparation. The fallback meter shows 17
  distinct frames. One launcher-to-controls observation is 60 ms; it is not a
  paint-latency or population benchmark.
- **Chromium application lifecycle:** nine of nine cases pass with the exact
  packaged app, host and extension. Delivery, focus-loss recovery and fresh
  recordings work. Navigation, tab close and native disconnection tear capture
  down in the retained trials at 59, 60 and 61 ms after Stop respectively.
- **Native GNOME Wayland onboarding:** both application cycles pass. Actual setup
  controls use native capture, preserve the full synthetic waveform and expected
  transcription, release their Pulse capture stream after Stop and leave the
  private clipboard unchanged. GTK 3/4 WebKit surfaces are native Wayland.
- **Real Ubuntu GNOME Wayland VM:** the authenticated legacy client and exact
  private daemon complete 4,003 connections. Four thousand key press/release
  pairs and final target text match exactly, with five descriptors, one idle
  thread and 4,008 KiB RSS. The client cannot directly open guest uinput; the
  daemon owns that route. QEMU uses a disposable overlay with read-only archived
  backing and no host input/audio passthrough.
- **Real installed upgrade:** the signed .54 package upgrades to the exact .55
  package while the old app and service remain running. Settings and the old
  service process are preserved during APT. Setup rejects the live app's lock;
  after it closes, CLI and normal app startup migrate the owned service to the
  private daemon. Poisoned PATH helpers are unused, repeat setup preserves the
  current daemon, custom overrides are preserved, and a genuine queued manager
  restart prevents app startup before capture. The installed service delivers
  native Wayland keys, literal space and clipboard paste with independent receipts.

## Final review and retained failed attempts

Independent source, build/license, migration and real-input reviews found no
remaining actionable defect in this change. Repeating the assessment identified
and corrected stale systemd startup metadata and pending-restart timeout handling
before the final build. No package hook controls a user session; the app's
single-instance guard covers migration before capture can begin.

The retained attempts include an initial Rust type-export compilation error,
a fixture invocation of the old setup CLI, atomic test-receipt/backlog fixture races,
artificial zero-delay input bursts, and a queued-job fixture whose initial
precondition was not established. The final production-delay input trial passes.
Two browser launches failed before qualification because the controller supplied
the wrong extension path and omitted the extracted Xvfb dependency root. One
GNOME journey used a probe missing its test-only window-activation method. Corrected
fresh runs pass with unchanged product bytes; earlier attempts remain available.

The final cleanup preserves source, package identities, failed attempts and
recovery artifacts. Temporary desktops, VM/containers and build caches are scoped
separately from the owner's installed app and profile. Release signing, draft
asset downloads, anonymous public downloads and latest/tagged aliases are recorded
in the release's final validation and publication receipts.

## Limits

Physical microphones, default PipeWire capture, owner-perceived motion, global
shortcut configuration and other desktop/application combinations remain distinct
from the evidence above. These tests are not a production security certification
or a claim of universal Linux support. Desktop paste cannot make focus ownership
atomic with keyboard delivery; uncertain output is retained without automatic
replay. Fedora, openSUSE and Arch/Omarchy remain on their separately qualified .43
artifacts. Existing user-created systemd enablement links are not removed by
package hooks; removal qualification covers package-owned paths.
