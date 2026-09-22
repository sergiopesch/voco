# End-to-end release-readiness review — 22 September 2026

The .55 candidate combines the first-run delivery corrections with the subsequent
security review, cleanup and native Pulse latency fix. Source, renderer and native
runtime and isolated package checks pass on the identities recorded below. The
four protected CI verdicts for the current source are recorded on
[PR #67](https://github.com/sergiopesch/voco/pull/67). **Release remains held for the legacy
Wayland daemon decision and final release gates.** The public and installed app
remain .54; the tested .55 package is unsigned and unpublished.

## Findings and disposition

| ID | Priority | Finding and resulting behavior | Verification |
| --- | --- | --- | --- |
| R1 | Release blocker | Ubuntu's ydotoold 0.1.8 leaks every accepted client descriptor, then spins on failed `accept`. The installed service reached 1,024 descriptors with a full connection queue and roughly two CPUs busy. An idle-only restart restored readiness but does not fix the leak. A minimal same-protocol patch is prepared; integration needs a dependency decision. | Exact Ubuntu source authenticated through its signed archive index; baseline/patched connection stress described below |
| R2 | Fixed | IBus shutdown could unlink a replacement server's socket. Cleanup now requires the exact device/inode created by that instance; failed startup cannot delete another owner. | Ownership, replacement and failed-start regressions; private IBus integration |
| R3 | Fixed | A delayed browser-enable reply could restore authorization after navigation or native disconnect. Pending attempts now require their original generation and native connection. The whole-document observer exists only during active delivery and is released on revoke, finish or disable. | Deterministic lifecycle races and 204 exact-field cases |
| R4 | Fixed | Installer configuration ignored absolute `XDG_CONFIG_HOME` and could overwrite settings created concurrently. Configuration paths now match the app, publication is no-clobber, and obsolete mutation branches are removed. Inline Python uses isolated imports. | Existing-file/symlink sentinels, XDG, concurrency and hostile-import fixtures |
| R5 | Fixed | Independent payload verification accepted extra special files and unsafe write modes. It now rejects special objects before reads, linked roots/manifests, and group/world-writable or set-ID speech payloads. | FIFO, symlink and mode regressions; complete package verification |
| R6 | Fixed | Frequent microphone levels rerendered the whole control panel. Only the recording meter now subscribes to that value. Optional executable hashing now uses a 64 KiB buffer rather than reading the whole binary into memory. | Five meter changes left the panel render count unchanged; digest-equivalence/error tests |
| R7 | Cleaned | Nine frontend modules were unreachable from the application graph. Removed those, eight exclusive retired tests, one unused image, and unreachable IBus mutation bodies. Compatibility signatures and actively referenced types remain. | AST import/re-export/dynamic-import graph, repository references, typecheck and full tests |
| R8 | Corrected | Current security and browser documentation still described retired Whisper paths. Current guidance now follows the selected Nemotron stream; historical snapshots remain explicitly historical. | Source/command/storage review and guide tests |
| R9 | Fixed; rebuilt package qualified in private capture | Native Pulse capture requested 10 ms fragments without requesting the matching source latency. The earlier onboarding trial retained only 0.81 seconds from a 2.09-second phrase and returned a healthy Stop. `PA_STREAM_ADJUST_LATENCY` now requests the matching latency; format, buffer, source ownership and Stop limits remain unchanged. | Same-input source regression: 2.13 seconds buffered without the flag versus 10.2 ms with it. The rebuilt package retains the complete original waveform and displays the expected full phrase in native Wayland onboarding |

The earlier security fixes were reviewed together: authenticated checksum
manifests before APT, isolated focus-helper imports, retained exact browser Stop
receipts, removal of unguarded insertion IPC, and opt-in private bounded hotkey
traces. See the [original source-hardening record](security-hardening-2026-09-22.md).
It retains its original sandbox limitations; this record provides new evidence.

## Scope and second review

The review mapped installation/authentication, configuration migration, startup
and readiness, WebKit/native audio capture, worker IPC and recovery, destination
ownership, shortcut routing, browser/native messaging, GNOME/AppIndicator
presentation, diagnostics, dependency provenance, packaging and CI. Independent
second passes reviewed the combined browser/frontend and installer/security diffs.
No further actionable regression was identified within those passes.

This is a bounded engineering review, not a certification or an assertion that
every third-party function, model weight or Linux distribution was independently
audited. Retained research adapters, frozen release evidence and compatibility
types are not automatically unused just because the normal UI does not select them.

The removed frontend content totals 154,392 repository bytes, including an
82,909-byte unused image. It was already outside the production import graph;
this is a maintenance reduction, not a measured bundle or inference improvement.
The recognizer, model, CPU policy, input permissions and delivery safety boundaries
are unchanged by this cleanup.

## Verification

| Gate | Result |
| --- | --- |
| Versions, TypeScript, lint, frontend and optimized desktop build | Passed |
| Root test chain | Passed; current frontend suite is 390 tests in 46 files; retired-only tests were removed deliberately |
| Rust all-target tests | 274 library tests, 25 browser-host tests, 7 dependency regressions and 25 browser replay tests pass; one offline audit export requiring a dedicated `XDG_STATE_HOME` remains ignored |
| Native-capture development feature, all-target/all-feature Clippy, formatting | Passed; development library suite also 274 pass, one ignored |
| IBus Python and real private IBus | 107 tests; three consuming shortcut events, 21 rejected mutations, zero target commits/deletions |
| Native C callback lifecycle | 66 ASan/UBSan cases pass without an audio server |
| Native Pulse source latency | Fixed source passes complete-waveform capture at 10,233 µs buffer latency; the same-input negative control without the flag fails at 2,128,822 µs despite passing lifecycle checks |
| Pinned-model regression | Eight corpus fixtures pass; aggregate WER 2.5%; repeated-speech continuity, silence and input variants pass |
| Dictation, microphone and native-capture renderer flows | Passed with explicit native/capture doubles |
| Dedicated onboarding renderer suite | 19 cases pass with capture/recognition doubles, including denial, retry, silence, missing setup, Stop and explicit completion |
| Presentation and accessibility | Seven Chromium flow groups pass, including reduced motion, forced colors, keyboard use and minimum desktop size; exact packaged WebKit exercised below |
| Exact-field browser | 204 recipient cases pass |
| Native browser/toolkit delivery | 17 Chromium cases and native application matrix pass in private displays |
| glib source and optimized regression | Provenance passes; seven optimized iterator cases pass |
| Installer/DevOps preflight | Passed, including signed-manifest negative paths, presentation, prefetch, performance and configuration fixtures |
| Local code guide | Nine tests pass against its explicitly pinned historical source |
| Complete Debian package | Metadata, ELF/payload identity, model, native libraries, links, modes and notices pass |
| Ubuntu 24.04 local container, latest package | Fresh app installation with APT in reused disposable userspace passes complete installed inventory and `dpkg --verify`; removal leaves none of the 287 non-directory payload paths. The unchanged worker/model previously passed 13 installed-worker protocol checks |
| Exact package in private GNOME 46 X11 | 16 checks pass: fresh onboarding, visible handoff, launcher, real fixture recognition, panel/fallback meters and Stop, Brave address bar, Bash/nano, controlled pre-dispatch focus-change recovery |
| Exact package and Chromium capture lifetime | Nine cases pass, including navigation, tab closure and native-host loss, with private Pulse capture release and successful fresh recording after each departure |
| Exact package in private GNOME 46 Wayland | Two independent Open/Quit processes pass; actual onboarding Start/Finish passes native Pulse capture, complete-waveform continuity, full expected transcription, session-bound Stop, independent capture release and unchanged clipboard |

The current native Wayland trial uses actual app-owned, visible, enabled Start test
and Finish test controls, with window and accessibility ownership checked against
the application PID. Native and renderer audit receipts carry the same positive
session ID as the Stop trace; every renderer sample matches the native downmix.
The 2.09-second original phrase is fully retained: whole-reference correlation is
0.9999897 and the minimum active-quarter correlation is 0.9999829, above the
unchanged 0.90 gates. The displayed transcript is “Go do you hear?” The private
Pulse application source disappears after Stop, the clipboard sentinel remains
unchanged, and onboarding remains incomplete until the user explicitly completes it.

The synthetic null source uses fixed 250 ms digital silence before and after the
unchanged public audio fixture to establish its clock. Scoring still uses the
complete original waveform. The same input fails the source regression without
the latency flag and passes with it. This run uses private PulseAudio 17.0 and
synthetic audio, not a physical microphone or the default PipeWire session.

Earlier failed attempts remain evidence: fixture setup and legacy manual-Copy
assumptions were corrected, then strict native onboarding exposed actual truncated
audio in the first package. Healthy lifecycle/Stop receipts alone did not establish
complete capture. The source fix was rebuilt and the strict gate rerun against the
new application identity below; the earlier failures are not counted as passes.

The browser fixture checks session-bound teardown, terminal recovery/success,
private Pulse capture release and a fresh recording after navigation, tab closure
and native-host loss. It terminates only its staged native host in a private PID
namespace. The latest exact-package trial passes all nine cases; Stop-to-teardown
observations are 58, 59 and 61 ms for those three departures. Earlier failed
fixture assumptions remain preserved separately.

The first hosted native-Pulse regression failed before capture: the runner
exported `XDG_CONFIG_HOME` outside the fixture's writable HOME. PulseAudio refused
to create its configuration directory on the read-only host mount. The fixture
now gives both the server and native client private XDG and Pulse settings. A
reproduction with inherited external paths passes after this correction; the
negative control without the production latency flag still fails. Namespace,
waveform and latency requirements are unchanged.

In the latest X11 fixture sample, a second launcher process reached accessible
controls in 56 ms. Done-to-visible-status was 993 ms, including an explicit 600 ms
observation wait. The Wayland onboarding Stop-to-idle trace measured 364 ms.
These are individual synthetic-fixture observations, not pixel-paint latency,
model-only inference timings or performance guarantees. Container installation
does not measure Internet download speed.

## Candidate identity

The package was assembled from the combined working source based on `1fe2522`,
including the native Pulse latency fix. The audit preserves the starting diff,
recovery archive, executable identities and subsequent review records. The latest
package inventory is `candidate-pulse-fixed/inventory.json` in the external audit
bundle. A final source inventory is recorded separately and is not an assembly-time
snapshot. Bundled documents retain their assembly-time snapshot and must be
refreshed for the final release.

| Artifact | SHA-256 |
| --- | --- |
| `voco_2026.0.55_amd64.deb` (685,562,846 bytes) | `652c50e97f41836f87891b813fc2173a891ea6622a01b97b3fd9b7ac743c5ac2` |
| Packaged `/usr/bin/voco` | `404de19c9eb12b44aa5e288f0ef22d7619a78503be39d21bc49aaa2a179ecf95` |
| Packaged `/usr/libexec/voco-browser-host` | `1e8522c51023dc933db37f7c89660fb8648be1083a1e29eb5c9c1aa3bd1c35b3` |

The earlier package `8e960069…` with application `029d810c…` passed its other
recorded source, X11, browser and container checks, but failed complete native
speech capture. It is superseded. `final-build-equivalence.json` compares rebuilds
of that earlier application; it does not establish equivalence to the latest
application above. The latest X11, browser and native Wayland results each record
the new `404de19c…` application identity. Complete package-inventory comparison
finds `/usr/bin/voco` is the only changed runtime path; the other ten changes are
documents. Worker, model and browser-host bytes are unchanged.

The Ubuntu local-container qualification uses `cbx_d7d141a45efa`. Its initial
minimal-image documentation exclusion was corrected before the earlier inventory
pass; the failed attempt remains recorded. The latest package now passes a fresh
APT app installation, complete installed inventory and `dpkg --verify` in that
reused disposable userspace. Removal passes checks for all 287 installed
non-directory payload paths, and the owned lease has been stopped and deleted.
`dpkg --verify` exit status alone does not establish payload completeness. No
owner's profile or installed application was replaced by these tests.

## External dependency finding and remaining gates

The legacy daemon's EOF path omits `close(fd)`, and its accept loop treats `-1`
as a valid descriptor. An exact-source fixture with a 64-descriptor limit exhausted
the baseline after 77 admitted empty connections and consumed 20 CPU ticks in a
100 ms sample. A minimal patch closed clients, handled interrupted calls and
failed promptly on accept/thread errors. It passed 2,000 empty plus 2,000 synthetic
event connections, returned to four descriptors and used no sampled idle ticks.
The fixture stubs uinput: it is source lifecycle proof, not real keyboard delivery.
Increasing descriptor limits, caching help probes or timed restarts does not cure
the leak. A privately scoped compatible daemon requires its own source, license,
build, protocol, service migration and package qualification before inclusion.
The installed daemon exhausted its descriptors again approximately 24 minutes
after the first restart. A second verified-idle restart restored seven descriptors
and desktop-input readiness. It subsequently reached 1,024 descriptors again;
a third verified-idle restart at 22:10:46 UTC restored six descriptors and
readiness. All observations are retained; temporary recovery does not fix the
daemon or satisfy the release gate.

A separate production-build feasibility proof produced identical 31,024-byte
daemon-only executables from two clean directories on the recorded toolchain.
The ELF uses the normal system C/C++ runtimes, with required symbol versions below
VOCO's existing Ubuntu package floors, PIE, full RELRO and a non-executable stack.
Exact inputs, patches, licenses and ELF receipts are retained outside the repo.
That executable has not been run against a real input device or integrated into
VOCO. Repeatability on one toolchain is not cross-host build reproducibility.

Fresh npm and Rust audits report no blocking vulnerability-class findings.
Seven Rust maintenance warnings and RUSTSEC-2026-0097 remain visible. The affected
rand 0.7.3 `log` feature is absent in both default and all-features graphs; its PHF
consumer uses a seeded small RNG. Reassess on dependency/feature changes. These
audits do not cover distro daemons or all native shared libraries—the daemon
finding illustrates why installed-host inspection remains necessary.

Before a release cut:

1. Decide and qualify the permanent Wayland helper fix; temporary local recovery
   does not satisfy this gate.
2. Require the four protected CI checks on the final review commit and merge it
   through the normal PR process.
3. Complete physical-microphone and owner-session acceptance for the intended
   support claim. Synthetic capture and nested compositors are distinct evidence.
4. Reassemble if shipped bytes change, then sign the immutable tag/manifests and
   verify uploaded/downloaded assets after explicit publication approval.

Desktop key gestures still cannot make changing application focus atomic with
delivery. Stop before changing fields; uncertain text remains recoverable and is
never blindly replayed. Other distribution packages remain at their recorded
versions. Playwright's separate WebKit binary was unavailable for its motion run;
the actual packaged WebKit/GNOME run above is a different, completed check.
