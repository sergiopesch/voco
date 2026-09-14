# Linux end-to-end qualification matrix

Current behavior: native recordings complete through **manual Copy**. Automatic IBus
text mutation is suspended. Direct delivery is limited to the explicitly enabled
Chromium adapter in supported plain fields, using Alt+Shift+V. Helper availability,
IBus context metadata, successful recording, or a passing unit test does not establish
a safe automatic destination.

This matrix is an acceptance plan. Physical desktop/microphone rows below remain
**not run**. The [iteration 5 acceptance record](foundations-iteration-5-2026-09-05.md)
binds current local evidence to its exact development package and retains failures;
it does not qualify an installed GNOME/KDE session.

## Target environments

| Environment | Session | Priority | Physical session status |
| --- | --- | --- | --- |
| Ubuntu 24.04 GNOME | Wayland | Primary reference | Not run |
| Ubuntu 24.04 GNOME | X11 | Reference | Not run |
| Kubuntu 24.04 KDE | Wayland | Second compositor | Not run |
| Kubuntu 24.04 KDE | X11 | Additional compatibility | Not run |
| Debian GNOME, record exact version | Wayland | Distribution spot-check | Not run |

Record actual available sessions and application versions. Do not force an unavailable
session or change global device permissions to fill a row. Follow the
[physical microphone protocol](physical-microphone-qualification.md) for consent,
selected-device provenance, read-aloud references, noise, device lifecycle and latency.
No microphone, input, clipboard or browser-profile action on the active desktop is
implied by this document.

## Preflight and automated evidence

The following commands exist in the current repository. Run builds/inference serially
when measuring performance; unit checks do not require microphone access.

```bash
npm run check
npm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run rehearse:release
npm run report:linux-runtime
```

The runtime report describes the machine where it runs. Retain it with candidate,
model and executable hashes; do not label a host report as a disposable target report.
Advanced runtime diagnostics may report compatibility helpers, but those helpers are
not a native automatic dictation fallback. Missing optional helpers must not cause
silent redirection or be “fixed” through unapproved host policy changes.

Use these documented harnesses for additional isolated checks:

- [Private X11 GTK/WebKit and manual-Copy app cases](native-isolated.md): actual
  toolkit/IPC paths in namespaces, with private synthetic audio when requested.
- [Private native Wayland smoke](wayland-isolated.md): real GTK3/GTK4 WebKit surfaces,
  pinned model-cache readiness and observed VOCO Open/Quit lifecycle. The optional
  [surface journey](wayland-surface-acceptance.md) adds actual capture, painted Copy,
  fresh clipboard verification and focus-loss/reopen checks in nested Weston.
  Headless Weston has no physical input seat; these checks do not qualify physical
  shortcuts or microphones.
- [Private GNOME Shell/Mutter](gnome-isolated.md): actual compositor and real Ubuntu
  appindicator watcher, toolkit mapping and process-bound packaged app lifecycle.
  Capture results and harness failures retain their exact candidate identities.
- [Private KDE/KWin](kde-isolated.md): actual KWin/Plasma, real kded watcher,
  process-bound lifecycle, synthetic capture and native geometry/paint evidence.
  Extracted runtime packages do not qualify an installed distribution or login.
- [Chromium adapter](../../integrations/chromium/README.md) and
  [broker contract](browser-broker.md): direct captured-element mutation and receipts.
  The original browser harness's localhost-only permission grant remains separate
  from the [actual toolbar harness](chromium-toolbar-acceptance.md), which uses the
  shipped permissions and visible Chromium action. Neither qualifies an installed
  browser profile or arbitrary websites.
- [Physical microphone protocol](physical-microphone-qualification.md): human steps
  and existing consented-WAV replay/scoring, all marked unrun until performed.

Use exact packaged GUI/host/extension files for package acceptance, not a mixture of
current source and stale executables. Preserve each invocation's manifest, failures,
fixture identity and instrumentation. A later passing run cannot erase an earlier
failed waveform or promote an unrelated old report to current evidence.

## Native manual-Copy journeys

| ID | Scenario | Required result |
| --- | --- | --- |
| NATIVE-01 | Fresh launch and model cache | Correct candidate starts; tray registers; existing pinned model is verified. Distinguish cache readiness from actual decoder loading. |
| NATIVE-02 | First microphone access | Human verifies selected physical device and any permission UI; denial produces a clear recoverable state. No silent device substitution. |
| NATIVE-03 | Recording and stop | Ready/listening/transcribing/completion states follow actual activity; selected shortcut starts/stops once without a stuck modifier or repeat toggle. |
| NATIVE-04 | Final text only | Recognition completes into Transcript ready to copy. Native editor/browser fields receive zero automatic text. |
| NATIVE-05 | Stable cursor streaming | Long recording checkpoints and final tail remain accounted for; native delivery still requires Copy. No speculative text enters a field. |
| NATIVE-06 | Copy and Clear | Actual Copy control places the complete result on the test clipboard; human paste matches. A new recording cannot silently replace an uncleared result. Clear permits the next recording. |
| NATIVE-07 | Focus switch or startup delay | Switching native fields, microphone prompts and delayed startup never authorize automatic text mutation. Completed text remains available for Copy. |
| NATIVE-08 | Capture/transcription failure | Visible failure recovery is distinct from normal completion; available transcript/audio is retained according to the current recovery flow, with no automatic replay into a field. |
| NATIVE-09 | Restart and configuration | Selected microphone/configured shortcut persist where supported; actual active binding is checked after restart. |
| NATIVE-10 | Runtime/update diagnostics | Actual session/helper state is accurately reported; update checks finish or expose an error without remaining stuck. Network-dependent outcomes are recorded separately. |

Run against a plain editor and explicitly named GTK/Qt/Electron/LibreOffice scratch
applications as available. These destinations test zero automatic mutation and manual
Copy; they are not claims of integrated automatic delivery support. Do not test dormant
legacy type-simulation/auto-fallback APIs as substitutes for the current dictation flow.

## Chromium exact-field journeys

Use a disposable profile and local fixture with independently observable fields A/B.
Enable the adapter through its real toolbar action for physical qualification. Supported
controls are top-frame textarea and text/search/url/tel inputs with collapsed selection;
password/private-marked, readonly, disabled and rich-editor targets are unsupported.
Keep a copy of the fixture's focus, selection and mutation events alongside app traces.

| ID | Scenario | Required result |
| --- | --- | --- |
| BROWSER-01 | Warm and cold Alt+Shift+V start in A | The original element/document token is claimed before delivery. Correct field or explicit recovery; never another field or address bar. |
| BROWSER-02 | A→B before claim | B remains unchanged; a late claim cannot authorize B. Record unsupported/recovery separately from successful automatic delivery. |
| BROWSER-03 | A→B during recording/checkpoint | Any acknowledged prefix in A remains exact; B remains empty; remaining available text is recoverable. |
| BROWSER-04 | Fast Stop, repeat and startup failure | Directed Stop cannot create a new recording; held-key repeat does not toggle repeatedly; microphone/AudioContext failure releases its original browser token. |
| BROWSER-05 | Page mutation before append | A→B→A, element replacement/removal, privacy/eligibility changes and changed value/selection reject stale ownership; no replacement target is silently acquired. |
| BROWSER-06 | Navigation, reload or native-host disconnect | Tokens invalidate; stale messages/cleanup cannot affect a new recording. Re-enable explicitly when required. |
| BROWSER-07 | Slow handler or lost receipt | A stale queued append is refused; uncertain delivery is not replayed automatically. Preserve acknowledged counts/prefix and recovery evidence. Shared-host-clock assumption remains explicit. |
| BROWSER-08 | Recovery Copy/Discard, then another recording | Actual controls work; original transcript is retained until the user's terminal action; the next recording receives a fresh token. |
| BROWSER-09 | Long canonical recording | At least one nonempty checkpoint is observed before stop; final text has no lost/duplicated boundary words. A short final-only success is not streaming proof. |

Test final-only and canonical paths separately with fixed text/audio and existing model.
Report exact original field identity, acknowledged Unicode counts, mutations, recovery
outcomes and stop-to-idle. A trace merely saying “owned” or a final string in some field
is insufficient. Direct element editing does not preserve browser-native undo history;
record this documented limitation rather than treating an untested undo path as passed.

## Physical shortcut and session lifecycle

These cases require human input on an explicitly authorized disposable desktop; they
are not performed by the headless harness. Check default/configured native shortcuts
separately from the adapter's Alt+Shift+V. Record conflicts with application shortcuts,
left/right modifiers, extra Control/Super, repeats, layout/AltGr and keyboard reconnect.
A passive evdev observation is not evidence that the chord was consumed.

For consented microphone unplug/reconnect, idle lock/unlock and suspend/resume, follow
the physical protocol and recheck selected device, shortcut, tray and a short take.
Record unsupported cases as such. Lock-during-recording requires an agreed behavior
and a separately consented test. Never broaden device access or restart the active
host IBus/session service merely to complete this matrix.

## Evidence and exit criteria

For every row record candidate/model/toolkit/session identity, attempts, successful
completions, explicit recoveries, failures and unrun cases. Preserve observed text and
references, latency methodology and individual samples, screenshots/accessibility
observations where claimed, and clipboard checks. Recording and retained audio require
specific consent; synthetic fixture provenance must remain labeled synthetic.

Zero wrong-target mutations and zero automatic replay after uncertain delivery are
mandatory safety criteria. Recognition accuracy, physical capture reliability, UI
accessibility and latency need their own measured acceptance; safe refusal is not
successful automatic delivery. No full Linux qualification claim is justified while
required physical sessions remain unrun. Unit tests and local namespace passes are
valuable separate evidence, not installed distribution/compositor certification.

## Historical IBus investigations

The former lease-based automatic IBus matrix is superseded. Its GTK success cases,
cold-focus 4/5 result and same-context WebKit wrong-field reproductions are retained in
[native isolation history](native-isolated.md), the
[iteration 2 record](foundations-iteration-2-2026-09-04.md) and the
[approved delivery decision](targeted-delivery-decision.md). They explain why generic
IBus mutation was suspended; they are not operative setup instructions or a current
acceptance path. Current IBus tests require zero target mutation.
