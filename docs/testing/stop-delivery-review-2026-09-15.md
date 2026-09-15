# Stop-delivery candidate review — 15 September 2026

**Status: `2026.0.37+local6` validation C passed 34 selected strict Stop cases from
35 attempts, five userspace continuation cases from eight attempts and all 65
model-protocol cases. Exact artifact qualification is supplied in external receipts.**
`+local3` remains installed. The owner deferred installation and requested isolated
testing. No owner-desktop access, release cut or publication is authorized by this
document. `+local5` packages and failed/passing receipts remain frozen evidence.

## Problem and selected mechanism

The [previous investigation](x11-stop-delivery-followup.md) reproduced a missing
final delivery when Stop overlapped a 1.8-second delayed clipboard reader. A root
passive X11 shortcut grab generated a short GTK/AT-SPI focus loss. The existing
focus-generation guard correctly invalidated the pending receipt; increasing an
observation timeout would not repair that identity change. Normal five-userspace
dictation passed separately on `+local5`.

The isolated mechanism proof distinguishes a **root ancestor grab** from a grab
on the **exact X input-focus window**. The latter retained GTK/AT-SPI field focus
in the controlled recipient. This supports changing where the existing shortcut
is registered during a recording; it does not justify ignoring focus events.
The earlier per-delivery focus-loss/provenance exception proposal is superseded
and was not implemented. Full packaged-app qualification remains separate.

The current implementation:

- Acquires one recording scope before capture and retains it through final queue
  drain. The existing actor, key mapping, lock-mask variants and callback machinery
  remain; no new hotkey engine, model, keybinding or fallback configuration is added.
- Moves the configured X11 passive grab from root to the exact input-focus window.
  Keeping the root grab simultaneously would leave the ancestor-grab problem.
- Binds ownership to manager, registration generation and lease nonce. The native
  watchdog is fixed at 650 seconds from acquisition; capture remains capped at
  600 seconds. There is no renewal or recipient-deadline extension.
- Restores root scope on end, real focus departure, window loss, registration change
  or expiry. Failed restoration/actor uncertainty changes health and blocks delivery
  or shortcut-ready claims. Automatic restoration ends the old session's authority.
- Serializes begin/end with in-flight recipient observation. Renderer disposal is
  UUID-bound and idempotent; it waits for an uncertain begin, ends only that owner,
  and prevents a late reply from cleaning up a newer recording.
- Retries only an explicitly held-key, pre-mutation start condition for at most
  one second. If the initial target was unavailable, it probes once after begin
  acknowledgement; an initially valid token is never replaced. Real focus changes,
  away-and-back transitions and uncertain receipts still reject continuation.

Wayland/evdev/unsupported routes retain their existing behavior. A frontend begin
may acknowledge a native no-op, so `dictation_desktop_shortcut_acquired` and the
corresponding release/failure events describe **logical session lifecycle**, not
proof of a physical X11 scope. Finite event names and numeric recording identity
exclude window IDs, app titles, target text and clipboard content. Use actor/native
receipts to establish actual scope and restoration.

Renderer reload is a separate ownership boundary: main PageLoad Started advances
a native epoch synchronously, then asynchronously releases only older ownership.
Preflight captures its epoch before the blocking target probe; Begin retains that
immutable value and validates it before/after acquisition, cleaning any acquisition
overtaken by reload. Delivery readiness rejects a registered stale epoch immediately.
UUIDs still isolate recordings. Generic paste IPC carries no renderer epoch, so
this closes shortcut orphan/stale-Begin races without claiming universal cancellation
of all queued renderer work. Focused epoch tests passed 10 Rust and 22 frontend cases.

## Validation B failure and arbitration correction

Validation B attempted two native cases: the planned 25 ms case completed under
the original harness; the next planned 250 ms case failed before capture became
active. Both attempts remain preserved. The first is not retroactively counted
against C's tightened actual-Stop-overlap and verified-focus-negative gates.
The B trace reached the global-shortcut callback and toggle evaluation without
emitted/buffered/debounced output. This is consistent with the previously silent
IBus suppression branch, but does not independently prove that event's exact poll state.

Source review established a concrete race: `begin_poll` set polling before every
IBus round trip, and the former authority check treated polling as consuming
authority. Even Disarmed responses left windows that could drop an already-consumed
X11 callback or revoke registration from a delayed main-thread synchronization.
C separates completed Armed/Uncertain authority from passive polling suppression.
Registration, config synchronization and readiness use only completed authority.
Passive evdev retains both guards because it may observe an IBus-consumed chord.
X11 root/scoped registrations use `owner_events=false`; their real callback has
already consumed input and retains shared debounce instead of passive suppression.
Plugin-generation checks and the one-second IBus authority limit are unchanged.

Finite native input-event traces expose `eval_toggle_suppressed_ibus` and
`eval_toggle_x11_consumed_during_ibus_poll` (with corresponding realtime variants).
They are emitted on the relevant input event, not every poll, and add no key,
content, title or destination identity. Ten arbitration tests and all-features
library Clippy passed; model, epoch and focus-receipt behavior were not changed.
Raw evidence and source analysis are retained in `arbitration-review/REPORT.md`
and `checks/shortcut-arbitration-{rust,clippy}-01/`.

A natural C field-away-and-back trial recorded global callback → evaluation →
`x11_consumed_during_ibus_poll` → emitted → frontend received/admitted at the same
14,694 ms trace timestamp (sequences 71–76). This validates the corrected class
without an extra injected experiment; B's exact historical poll state remains
unproven. See the `final-c-bare-field-away-back` hotkey trace.

Validation C's application SHA-256 is
`795b525c2ea1c1a9893351b1fcec7110217e530e4136e3be9bd4af14a3c66b91`;
its test Debian SHA-256 is
`3ade680c866da6588ff1c48df3886ee1096d40a491c6fd3a9df33184f04e5171`.
`validation-c/IDENTITY.json` pins all executables and unchanged speech payload.
These identify the test artifact, not the forthcoming documentation-complete
Debian/RPM/Arch packages. Final assembly must prove executable/runtime byte parity.

The patch vendors the existing `global-hotkey` **0.7.0** dependency at upstream
commit `dc7a755790ccbef1971b6c59eceb90d107df1feb`. Original licenses and archive/file
checksums are retained in [provenance](../../vendor/global-hotkey/VOCO-UPSTREAM.json);
[patch boundaries](../../vendor/global-hotkey/VOCO-PATCH.md) describe actor changes,
bounded waits and connection-failure limitations. X11 remains a shared desktop,
not an atomic target-ownership boundary.

## Additional bounded cleanup

The final X11 actor waits on the X connection fd and nonblocking UnixStream command
signal with `libc::poll`. Senders queue before signaling; the actor drains buffered
X events before waiting and bounds each drain so cleanup is not starved. The only
scheduled deadline is the original lease expiry. Interrupted waits preserve it;
fd failure closes the actor and degrades active scope. The direct libc dependency
uses the application's existing locked 0.2.183, without a version upgrade.

The paired isolated actor comparison used three trials at each planned delay
(0, 1, 5, 10, 25 and 75 ms) in bare Xvfb and Openbox. It observed **36/36 callbacks**
with event-driven waiting versus **9/36** with the polling actor. All **8/8** final
scope/departure/conflict/partial-registration mechanism cases passed separately.
In one quiet five-second interval per actor on the same image, voluntary context
switches fell from **100 to 0**. Both sampled CPU counters were below the 100 Hz
(10 ms tick) accounting resolution; this establishes neither zero cost nor app
energy savings. The zero-delay helper was scheduled after XSync acknowledgement,
not atomically in the same X-server batch as the focus change. This is a bounded
callback study, not a statistical tail-latency or universal availability guarantee.

Raw comparison and actor hashes are in
`platform/actor-event-driven-comparison.json`; it references both raw callback
schedules, final mechanism results and the paired idle receipts. Earlier polling
results and failed attempts remain preserved.

Rust worker transport now moves each audio request into its I/O channel instead
of copying the sample array twice. Bounded diagnostic metadata and response
identity are retained. The synthetic operation microbenchmark measured median
15.896 μs → 2.440 μs per 960-sample packet: about 0.67 ms CPU work saved per second
at 48 kHz/20 ms packets. This is a modest allocation cleanup; it excludes capture,
IPC, model inference, dispatch and cursor paint. It establishes no ASR or first-word
speedup. Queue backpressure, final-tail accounting and optional asynchronous logs
were reviewed without speculative refactoring.

## Evidence and remaining gates

New private evidence is under `stop-delivery-review-2026-09-15/` outside source.
Each run has a fresh output directory and command/artifact identity; earlier failures
remain available. Source tests and a mechanism proof do not qualify a later package.

| Check | Current status and scope |
| --- | --- |
| Focused Rust request ownership | 10/10 isolated tests passed; bounded metadata, moved allocation and response mismatch handling |
| Frontend lifecycle/queue/session | Initial ownership/queue run: 74/74 passed. Final epoch-focused run: 22/22 passed; full frontend suite below supersedes the earlier snapshot count. |
| TypeScript/lint | Isolated checks passed after final target-probe ordering change |
| Final source regression suites | Rust: 498 test executions passed (`rust-final-04`). Frontend unchanged: 459 passed, 2 optional cases skipped (`npm-final-02`). Full npm/20 assembler tests, TypeScript, lint, formatting, version and selected Clippy checks passed. |
| Final vendored actor | 22 unit tests and Clippy passed; paired callbacks 36/36 versus polling baseline 9/36; 8/8 final mechanism cases passed. Two earlier unregister-failure attempts remain recorded separately. |
| Full runtime/model tests | 65 protocol cases passed across five userspaces on the C payload |
| Exact `+local6` complete package | C production build and test assembly exist. Final Debian/RPM/Arch qualification is supplied alongside each artifact in external exact-SHA, executable/runtime parity and install/remove receipts; this document is not a self-attestation of its own package. |
| Native delayed-reader and held-key tests | Strict gate passed:34 selected/35 attempted;20 overlaps,8 focus negatives,2 held-Start,2 final-suffix gaps,2 ordinary. Exact artifact/session and actual observed overlap checked. |
| Distribution userspaces | Five selected normal/route-continuation cases passed from eight attempts; original three inappropriate root-only fixture assertions retained. Actual route:Ubuntu/Debian root X11, Fedora/Mint/Omarchy IBus retrigger. All selected metadata reconciled. |
| Renderer reload | Deterministic epoch/UUID tests pass. Packaged UI exposed no supported Reload action; Ctrl+R produced no second frontend initialization. Active-owner full-app reload remains unqualified. |
| Default desktops and owner laptop | Pending; userspace/Openbox fixtures do not qualify default GNOME, KDE, Cinnamon, Omarchy/Hyprland or physical microphones |
| Release/public sharing | Blocked pending candidate gates, owner testing and explicit release approval |

The acceptance plan must retain actual attempted denominators, overlapping Stop
timing, independent final-field readback, queue terminal outcome and cleanup health.
Evaluate actual observed Stop while the intended read is pending, not only the
planned scheduling offset. Focus negatives require proven destination identity;
an unrelated startup/injection failure cannot qualify a safe rejection. Aggregate
only exact expected application/runtime/fixture identities and recording sessions.
The completed matrix is `platform/final-c-complete-analysis/GATE.json`; the full
attempt ledger is `platform/final-c-complete-schedule/attempts.json`. One original
gap attempt completed normally but had no remaining suffix, so it did not test the
planned case. Only that fixture branch was corrected, with unchanged production
bytes. Report 34 selected passes from 35 attempts, not 34/34 total attempts.
Departure negatives intentionally produce incomplete delivery/recovery metadata;
their expected safety outcome must not be relabeled reconciled full delivery.

The fixture deliberately delayed reads by 1.8 seconds. With ±250 ms phase tolerance,
conservative request-to-observed-Stop ranges were 75.9–76.4, 301.0–301.1,
800.9–801.1, 1301.0–1301.5 and 1750.9–1751.2 ms for planned 25, 250, 750, 1250
and 1700 ms phases. These are observed bounds, not exact timing bins or normal
speech latency. The separate reload attempt used no debugger, production backdoor
or child-process kill to substitute for an unavailable supported UI action.

Five-userspace results are in `platform/final-c-platform-summary/summary.json`,
with selected observed field lengths of Ubuntu 258, Debian 259, Fedora 258,
Mint 258 and Omarchy 258 characters. These are fixture observations, not accuracy
scores. The three original Fedora/Mint/Omarchy attempts completed speech but failed
a root-binding assertion inappropriate to their active IBus ownership. Corrected
fixtures proved real Start/Stop continuation with unchanged production bytes;
all eight attempts remain recorded. Userspaces share the host kernel; Omarchy is
the actual ISO-derived installer filesystem plus recorded dependencies, not an
installed Hyprland desktop.

Final package receipts sit outside the package and bind its exact SHA-256 to the
validated executable/runtime, payload contents and native install/remove results.
Consumers must inspect the receipt accompanying their artifact. Keeping these
attestations external avoids a circular rebuild caused by embedding a package's
own final hash inside its documentation. No source/package document alone grants
acceptance to an unverified artifact with the same version label.
Key dispatch, recipient readback and final queue completion are separate events.
Unsupported controls remain best effort; no universal editor, Wayland, accuracy or
fastest-dictation claim follows. See [release gates](../release-candidate.md).

## Fresh dependency assessment

Isolated npm/Rust audits exited 0 with no vulnerability-class findings; seven
maintenance and two unsoundness notices remain, without suppression. rand 0.7.3's
affected `log` feature is not enabled in the resolved graph. glib 0.18.5 remains;
a lexical search found no affected iterator use outside glib in inspected sources,
which is not complete reachability proof or a fix. See [security applicability](../security/README.md#current-dependency-audit).
Raw outputs and graph/search scope are retained in `checks/dependency-audit-02/`
and `checks/dependency-paths-01/`; the earlier DNS-setup failure remains preserved.
Native libraries, distro packages and models are outside npm/RustSec coverage.
