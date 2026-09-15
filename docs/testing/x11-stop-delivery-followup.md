# X11 Stop during delayed delivery: follow-up design

**Status: frozen `+local5` failure; earlier exception proposal superseded, 15 September 2026.**
The current `+local6` implementation uses recording-scoped exact-focus X11 grabs,
preserving the focus guard. Validation C's strict matrix passed 34 selected cases
from 35 attempts; remaining gates are separate. See
[the current review](stop-delivery-review-2026-09-15.md). This document does not
authorize an owner-machine install, release cut or publication.

## Reproduction and evidence

The actual `+local5` application, executable SHA-256
`29c730cea29c86f1cf13c21c6804edc005f6ffdb15f0b64deac1806562ad8a71`,
fails a controlled GTK recipient test when the global Stop shortcut overlaps a
pending clipboard read delayed by 1.8 seconds. The same case fails in bare Xvfb
and in an Openbox-managed X11 session. Normal dictation in five representative
distribution userspaces passes; these are separate results.

| Observation | Bare Xvfb | Openbox |
| --- | ---: | ---: |
| X11 grab-to-ungrab interval at Stop | 12.4 ms | 12.4 ms |
| GTK heartbeat maximum gap during Stop input | 10.4 ms | 10.1 ms |
| Pending recipient reads at Stop | 1 | 1 |
| Result | Uncertain delivery; recovery retained | Uncertain delivery; recovery retained |

Passive X11 focus observation records `NotifyGrab` followed by `NotifyUngrab`.
GTK reports the entry losing focus and its window becoming inactive; AT-SPI reports
the same accessible field becoming unfocused, then focused again about 12 ms later.
The responsive asynchronous-input fixture still fails. Thus the earlier hypothesis
that synchronous keyboard injection starved GTK for more than the 80 ms AT-SPI RPC
budget is not supported. Openbox also rules out an explanation confined to a missing
window manager.

The managed intentional focus-switch negative passes: the other field remains
empty and recovery is required. This is evidence that the existing safety guard
works, not a justification for ignoring short focus changes.

Private workspace receipts are preserved outside source under
`cross-linux-review-2026-09-15/platform/`:

- `delayed-read-focus-diagnosis.json` correlates both environments and the negative.
- `ubuntu26/final-local5-delayed-focus-trace/` contains the bare trace.
- `ubuntu26/final-local5-delayed-openbox-trace/` contains the managed trace.
- `ubuntu26/final-local5-focus-switch-openbox-trace/` contains the managed negative.
- Earlier failed attempts, including synchronous/asynchronous heartbeat comparisons,
  remain in their original directories; do not replace them with a later pass.

This is isolated GTK/X11 and virtual-microphone evidence, not a reproduction on the
owner's desktop, Wayland, GNOME, Cinnamon, Hyprland or every destination application.
Queue accounting after failure does not establish that retained recovery audio was
lost. No model accuracy or model latency conclusion follows.

## Reproduced +local5 causal path

[`FocusTracker.event`](../../apps/desktop/src-tauri/resources/voco_desktop_target.py)
invalidates the target generation on a focused-false event. A subsequent true event
for the same accessible path receives a new identity. `verify_delivery` rejects the
old receipt/token, and [`observe_delivery`](../../apps/desktop/src-tauri/src/insertion.rs)
returns uncertain immediately on a changed/unavailable response. The three-second
observation budget is not exhausted in this reproduction. No automatic replay or
next clipboard update follows uncertain delivery.

The `+local5` insertion, focus-probe and Python helper files match the frozen `+local4`
snapshot exactly. This establishes an exposed integration limitation; it does not
establish that this round introduced a new focus-guard regression. Pressed/released
hotkey callback timing alone cannot prevent AT-SPI from observing the keyboard grab.

## Superseded proposal and current implementation

The earlier proposal investigated a per-delivery exception for a temporary focus
loss with additional grab provenance. It was not implemented. A short gap, matching
PID, returned focus or generic `NotifyGrab` cannot establish safe target authority.
No AT-SPI generation exception or retained-token bypass was added.

The selected mechanism changes the existing registered shortcut's X11 grab window
for one recording: root before recording, exact X input-focus window while recording
and draining, then root again. The isolated mechanism proof retained GTK/AT-SPI
field focus for the exact-window grab; full candidate qualification is separate.
The upstream parser, configured binding and callback engine remain. See
[the pinned vendor patch](../../vendor/global-hotkey/VOCO-PATCH.md).

Frontend UUID ownership spans capture startup through queue `finish()`. Native
scope is bound to actor/registration/nonce and expires after a fixed 650 seconds;
recording is capped at 600 seconds. End, cancellation, window/focus departure,
registration change and expiry restore root scope or expose degraded health.
Automatic restoration never grants an old stream authority to continue. No
recipient deadline is extended, uncertain text replayed or user configuration
changed. An initially valid target token is never refreshed. Only an unavailable
initial probe is repeated after begin acknowledgement, allowing a held Start key
to settle before capture.

Main-renderer reload synchronously advances an ownership epoch, then schedules
cleanup of only older epochs. Preflight captures the epoch before its target probe;
Begin checks the immutable value before/after acquisition and releases an overtaken
lease. UUIDs isolate recordings, and late cleanup cannot take a newer renderer's
scope. Generic paste IPC remains outside that epoch contract; no universal reload
cancellation is claimed. Dedicated stale-Begin/reset tests supplement the native
reload case in the acceptance matrix.

Validation B then exposed a separate startup/admission failure in its second
attempted case, before capture. The source conflated an in-flight IBus poll with
completed consuming authority. Validation C separates them: registration/readiness
use completed Armed/Uncertain authority; passive evdev retains polling suppression;
an already-consuming X11 callback uses the unchanged shared debounce. Finite input
events now expose those decisions. B's first completed 25 ms case and second failed
250 ms case remain recorded under the original harness. Neither is re-evaluated as
a pass against C's strengthened actual-overlap and focus-negative gates.

The final actor waits directly for X events and queued commands instead of polling
every 50 ms. In paired bare-Xvfb/Openbox tests it observed 36/36 callbacks across
six planned focus-change-to-helper delays, versus 9/36 for the polling actor.
The zero-delay helper was scheduled after XSync acknowledgement; these results
do not guarantee a focus switch and key event in the same X server batch. Eight
final actor mechanism cases passed separately. The strict C matrix below selected
34 passes from 35 attempts; details, remaining gates and idle measurements are in
[the current review](stop-delivery-review-2026-09-15.md).

## Selected C coverage

The exact C binary passed 20 actual delayed-read overlaps (ten per X11 environment),
eight field/window departure negatives, two held-Start cases, two between-delivery
final-suffix cases and two ordinary cases. The original gap attempt completed after
all speech had already dispatched and failed its coverage precondition. Only that
fixture branch was corrected and rerun; both fixture hashes and the excluded attempt
remain recorded. Negative cases intentionally retain incomplete delivery/recovery
metadata rather than report full successful delivery.

The following table describes broader desired boundaries, not a claim every row
has a full-app test in those 34 cases. Actor/unit tests and other artifacts have
separate receipts. Active-owner renderer reload remains unqualified: the packaged
UI exposed no supported Reload action and Ctrl+R did not reinitialize the renderer.

Separately, normal dictation and actual-route continuation passed in five userspaces
from eight attempts, plus all 65 model-protocol cases. Three initial fixtures imposed
an invalid root-X11 assertion on a valid IBus-owned route; their failures remain
alongside corrected real Start/Stop checks. External exact-package receipts qualify
final Debian/RPM/Arch installation and byte parity; these documents do not attest
to their own package hash.

## Acceptance gates for the new candidate

Use one complete pinned candidate and fresh isolated output directories. Preserve
all attempted trials, including failures and non-overlapping Stop attempts. The
previous `+local5` failures above remain historical facts after a later pass.

| Case | Required outcome |
| --- | --- |
| Ordinary immediate reader | Exact final text once, normal completion, scoped shortcut cleaned up |
| 1.8-second delayed read overlapping Stop | Final suffix delivered once, recipient readback and queue completion reconcile |
| Held Start and held Stop; press/release ordering | Capture begins only after bounded start resolution; no lost suffix or stuck binding |
| Same-window different entry, including away and back | Old target invalidated; other field empty, no automatic continuation after return |
| Different window/process during pending read | No output into the other destination; explicit recovery and cleanup |
| 4.5-second reader, cancellation, expiry or missing recipient | Bounded uncertainty without extending recipient deadlines or replaying text |
| Native registration conflict, actor/X failure or restoration failure | Finite failure/degraded health; no false shortcut-ready or delivery-ready result |
| Late begin/end or replacement recording | Only original UUID/nonce released; no late capture or mutation in replacement |
| Wayland/evdev/unsupported target | Existing route retained; logical begin/end events not counted as physical X11 scope |

For the delayed-reader positive, retain at least ten consecutive recorded overlapping
Stop trials per bare-Xvfb and Openbox environment, with planned overlap phase per
trial. Do not count a non-overlapping Stop as acceptance or retry away a failure.
Run genuine focus-switch negatives in both environments, including while a read is
pending. Unit/actor fixtures cover malformed commands, cleanup races and event
sequences that are difficult to schedule reliably in a desktop fixture.

Every receipt distinguishes key dispatch, sampled field observation and terminal
queue completion. Record pending-reader overlap, cleanup state, recovery and any
unexpected destination mutation. Retained-audio recovery is separate from live-queue
sample reconciliation. Compare ordinary delivery timing and resources against a
matched baseline before claiming a performance improvement.

Run the full source regressions and fresh distribution userspace matrix afterward.
Default compositors, physical audio and owner Codex/Brave/Ghostty acceptance remain
separate work. Update [the current review](stop-delivery-review-2026-09-15.md) and
[release gates](../release-candidate.md) only from actual final candidate receipts.
