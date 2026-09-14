# Foundations iteration 2: implemented hardening and an open delivery blocker

> Historical candidate. The approved replacement boundary and current validation
> are recorded in [iteration 3](foundations-iteration-3-2026-09-05.md).

> **Release blocked:** corrected native tests reproduce text arriving in the wrong
> WebKit field. The general native gate fails intentionally. See the
> [required delivery decision](targeted-delivery-decision.md). Passing GTK cases
> below do not close that failure.

Development candidate on `codex/foundations`, based on
`6ab2b2c37f1fc9bdf0ad7b1a0ecbbfea65cd16ee` (2026.0.21).
This record supplements the [first implementation snapshot](foundations-2026-09-04.md).
Its earlier test counts and first-trigger limitations describe that earlier build.
The adjacent `foundations-evidence/iteration-2/` directory retains this pass's
failures, fixes, source identities and final acceptance evidence.

No stronger recognition model, cloud speech dependency, production decoder profile
change, framework migration or persistent audio history was introduced. The pinned
base English model remains SHA-256
`a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`.

## Regressions found through independent testing

1. **Real Linux IPC failed before inference.** WebKit captured real virtual-source
   audio, but the CSP blocked Tauri's native IPC fetch. Tauri fell back to JSON and
   the strict VCA1 decoder rejected the body. The CSP now explicitly permits the
   native `ipc:` and `http://ipc.localhost` endpoints. It does not permit arbitrary
   HTTP origins or relax the binary format. A configuration regression check and
   a full native application fixture cover this boundary.
2. **The global X11 shortcut intercepted the consuming IBus shortcut.** Standalone
   engine tests passed while the full application starved its own IBus handler.
   Native arbitration now relinquishes the plugin grab while consuming ownership
   is active and restores manual fallback when appropriate. Shared atomic event
   admission and an explicit expiring authority lease prevent concurrent or delayed
   duplicate events during transient polling errors.
3. **Safe GTK entries were rejected.** IBus suppresses unchanged transport-capability
   callbacks across context changes. The engine now retains the transport cache
   while still requiring fresh field metadata. Sensitive and untyped generic
   fields remain ineligible. Lost key releases, configuration refresh and renderer
   liveness use explicit state and monotonic time.
4. **Late microphone initialization could resurrect stale state.** Lifecycle and
   session generations now prevent initialization finishing after unmount or a
   replacement recording from reopening resources or resetting the new session.
5. **Chunk merging erased intentionally repeated speech.** An existing public
   two-second utterance repeated eighteen times exposed 24 missing words out of 72.
   The corrected overlap selection leaves four missing words in both full and
   sequential canonical results (33.33% to 5.56% WER). Chunk-level evidence shows
   those four were already absent from recognition. Unicode word identities also
   survive normalization. This remains text-overlap inference, not exact acoustic
   alignment or a universal repetition guarantee.
6. **A completed local polishing response could rewrite facts.** Conservative
   processing now rejects altered word sequences, numerical punctuation/signs,
   technical tokens, protected code and meaningful symbols. Rejected or malformed
   output retains raw recognition and a content-free explanation. Punctuation can
   still alter meaning; this is a content-preservation guard, not a semantic proof.
7. **Recovery controls could be placed off-screen.** A real 1280×900 desktop
   measured the 420×660 recovery window at (660,474), extending 234 pixels below the
   display. The app swallowed a denied centering call because its capability was
   absent. The popover now uses explicit requested physical dimensions, caps them
   to the monitor work area and retains scrolling on smaller displays. Existing
   settings/onboarding centering receives its specific main-window capability.
   Placement tests cover negative coordinates, fractional scaling and small bounds;
   native acceptance additionally checks the actual window and Copy action.
8. **Desktop helpers could hang the UI or accumulate zombies.** Notifications use
   bounded supervision off the UI thread. Desktop application launchers return on
   dispatch and use a shared child reaper without killing long-lived browsers or
   their descendants. A successful spawn does not prove an application opened.

## Current validation results

| Check | Result |
| --- | --- |
| Rust suite | 182 passed, zero failures |
| Python ownership/protocol/engine | 102 passed (17 + 9 + 76) |
| TypeScript, ESLint and frontend regressions | 216 passed; two private captured-user-audio cases intentionally skipped |
| Rendered lifecycle suite | 30 scenarios, zero errors or unexpected console messages |
| Private headless IBus | Passed against current engine |
| Native WebKit destination safety | **Failed:** both trigger-to-start and lease-to-commit A→B redirects, including identical cursor geometry |
| Real full application, final-only | Exact short transcript once in A; B unchanged |
| Real full application, canonical final path | Exact short transcript once in A; B unchanged; this short case does not cover rolling checkpoints |
| Real full application, focus change during capture | Recognition completes; recovery retained; no field mutation; real Copy action returns exact transcript |
| Public speech baseline | 4 errors / 160 reference words, 2.50% WER |
| Repeated speech full and canonical | 4 deletions / 72 words, 5.56% WER; canonical prefix continuity passes |
| Node/Rust dependency audits | Zero reported vulnerability entries; existing 17 maintenance and two soundness warnings remain |
| Release package | Built and verified; exact packaged executable passes all three native cases |

The final evidence manifest records exact identities and distinguishes each earlier
native reproduction from the final artifact. A passing short native result is not
proof of all-day reliability or universal application coverage.

## Verification boundaries

The native fixture launches the actual candidate executable with a private X11,
IBus/session/accessibility bus and PulseAudio server. The public licensed speech
fixture traverses WebKit `getUserMedia`, AudioWorklet, resampling, VCA1 IPC, the
unchanged Whisper model and IBus delivery into a real GTK entry. The fixture mounts no
host microphone/keyboard devices and uses private desktop sockets and networking. It is local
Bubblewrap isolation, not a remote VM or an installed GNOME/KDE session.

Chromium lifecycle tests continue to exercise real React hooks and an actual
AudioWorklet graph, with the native, clipboard and synthetic microphone boundaries
explicitly mocked. They complement rather than substitute for native validation.

The fixed speech gates include the eight-reader 71.01-second baseline and a
42.12-second repetition case. These are small deterministic regression floors,
not representative accuracy or p95 latency measurements. The 15% continuity ceiling
was fixed before evaluating the correction and was not relaxed to make it pass.
See [continuity methodology](speech-continuity.md).

VCA1 validates frame, metadata, finite samples and per-command limits before sample
allocation. Tauri has already received the body at that point; this is not a cap on
all allocations inside Tauri's IPC transport.

CI runs rendered lifecycle, engine, isolated native widget and speech regressions.
Release verification additionally runs final-only, short canonical and focus-loss
recovery scenarios through a virtual microphone, using the executable extracted
from the freshly built and verified Debian artifact. Extraction runs no installer or package maintainer scripts. Native failure logs,
JSON reports and fixture-only screenshots/audio are retained. Hosted workflows
have been reviewed and locally rehearsed, not executed on GitHub in this task.

## Requirements that remain open

- **Cross-application destination identity.** Consuming protocol-v4 tokens establish
  shortcut-origin input-context ownership. WebKit can reuse one IBus context across
  distinct DOM controls. Corrected tests captured the shortcuts and reproduced
  actual wrong-target delivery before lease acquisition and before commit. Earlier
  unavailable-shortcut reports were contaminated by an uncanceled test session.
  Same-position controls also redirect without any prior IBus focus, cursor or
  content callback. The optional accessibility
  witness is [design and feasibility evidence only](native-focus-witness-design.md);
  its privacy/product choice remains pending, and a focus observer cannot by itself
  close the demonstrated defect. An exact-target adapter or suspension of automatic
  IBus delivery is required; see the concrete decision above.
- **Cold-start coverage.** A separate five-launch GTK series yielded four correct
  deliveries and one safe rejection after unchanged content metadata was omitted.
  The 30-cycle established-focus result must not hide that failure. No eligibility
  policy was weakened to improve the rate.
- **Full Linux support matrix.** Real GNOME/KDE Wayland, Qt, Chromium/Electron,
  LibreOffice, physical hotkeys, suspend/lock, PipeWire restart, microphone unplug,
  screen readers and display scaling require their own measured acceptance.
- **Independent speech evaluation.** Accents, noise/music, technical/numeric language,
  conversational speech, hours-long use and correction cost remain outside these
  small public-fixture tests. Textual overlap can still be ambiguous.
- **Upstream dependency health.** The current audit reports zero vulnerability
  entries, 17 maintenance warnings and two soundness warnings. The documented
  [reachability assessment](../security/dependency-assessment-2026-09-04.md) does not
  suppress advisories or equate source inspection with a formal safety proof.

The source checkout and installed application remain separate from this uncommitted
candidate. No commit, push, host installation, live input injection, service restart
or release publication was performed. Package metadata still says 2026.0.21; assign
and verify a new version before publishing. This work materially raises the tested
foundation but cannot substantiate a best-in-the-world claim.
