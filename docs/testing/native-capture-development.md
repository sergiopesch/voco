# Native capture development backend

The optional Linux capture backend is being qualified against the existing WebKit path. It does not change the pinned speech model, recognition policy, mono preparation, resampling, or automatic text-delivery safeguards. Passing protocol or renderer mocks alone does not qualify audio continuity or physical microphones.

## Build and enable

Ordinary builds keep WebKit capture. To include the development backend, build with `bash scripts/build-desktop.sh --native-capture-dev` and the libpulse development headers/library available to the build environment. The backend also requires the exact runtime setting `VOCO_DEV_NATIVE_CAPTURE=1`. Neither switch alone enables native capture. No helper daemon or privileged service is installed for native capture.

The first version requires PipeWire's `object.serial` source identity metadata through its Pulse compatibility server. Unsupported sources remain visible but cannot be approved. VOCO connects only to the existing current user's `/run/user/<uid>/pulse/native` socket, verifies ownership, and disables autospawn. It does not use an environment-selected remote server.

## Selection and privacy

In Audio settings, choose a native input, acknowledge direct microphone access for the current app session, and select **Use this microphone**. This is separate from browser microphone permission. **System default (current device)** resolves to a concrete current source; it never follows later default changes silently. Opening settings, refreshing devices and retrying setup do not record audio or open WebKit microphone preview in native mode.

A healthy recording Stop, Cancel or retained-audio discard does not revoke that app-session choice. Approval is bound to the audio-server connection and exact source name, index and object serial. Device-list revisions, labels, idle-state changes and a changed system default do not transfer or revoke an unchanged approved source. Renderer reload, app shutdown or an unhealthy capture invalidates the relevant state. After an interruption, refresh devices and explicitly choose and allow the source again. No failure falls back to WebKit or reconnects during recording. Realtime voice continues to use its existing browser microphone path and permission, separately from native dictation readiness.

## Audio and ownership contract

The worker owns one explicitly selected stream. Before uncorking it rechecks source name, index and object serial, plus the negotiated S16LE stereo format at 44,100 Hz. The renderer receives an immutable per-recording capture descriptor; retained audio and recovery keep its source rate even after the capture graph is gone. Stereo conversion is exactly `(left + right) / 65536` before the existing preparation pipeline.

Audio arrives in bounded binary batches, each with capture/session/generation identity, contiguous sequence and source-frame extents. ACKs cover exactly the complete issued batch. Unacknowledged replay is byte-identical; the renderer never acknowledges samples it did not retain. The callback copies into 64 preallocated slots; it does not allocate, serialize JSON, call IPC or write files. A slot holds at most 35,280 bytes. Small callbacks append to the newest block only until its first peek. Peek immediately exposes a partial block and seals its bytes and extent through ACK/cancel. Frame and block counters advance during enqueue, so the worker's receipt remains coherent before peeking.

The callback reserves capacity for its entire accepted extent before copying; overflow cannot append a partial callback. The 600-second capture ceiling still permits its exact final prefix. Packing uses the existing 2,257,920-byte PCM storage, with one additional capture-local exposure counter. Already exposed partial blocks consume whole slots, so remaining capacity depends on prior delivery. The five-second drain lease and independent server/IPC limits still apply; densely packed storage is not an end-to-end stall-duration promise. Overflow remains an explicit unhealthy result.

Stop requires acknowledged cork and timing-barrier receipts plus delivery and ACK of every produced frame before healthy finalization. This bounds the locally delivered stream; it does not independently prove physical microphone frames through the user's click. Missing frames, holes, overflow, source movement/removal, suspension and server loss invalidate automatic inference/delivery. Received audio remains available for manual recovery. A 600-second source-frame ceiling seals capture explicitly. Startup, stop, command and renderer-lease deadlines bound failures; renderer reset cancels the stream and outstanding callback operations before reuse.

## Verification

- `npm test`, `npm run check`, `npm run lint`: existing and new frontend/component contracts.
- `VOCO_RENDERER_EVIDENCE_DIR=<new-directory> npm run test:microphone-renderer`: existing actual-App WebKit settings checks with media/native mocks.
- `VOCO_RENDERER_EVIDENCE_DIR=<new-directory> npm run test:native-capture-renderer`: actual-App native setup, recording and recovery checks with native/media/transcription mocks.
- `VOCO_RENDERER_EVIDENCE_DIR=<new-directory> npm run test:dictation-renderer`: broader dictation renderer regression checks.
- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`, repeated with `--features native-capture-dev`: default and native manager/protocol contracts. Native tests use a fake backend and do not connect to microphones.
- The C shim's `VC_UNIT_TEST` mode exercises queue and operation ownership without connecting to Pulse; strict compilation and ASAN/UBSAN runs complement Rust tests.

Installed Linux qualification must use a prospectively identified package, guest, source and public fixture, retain raw/prepared audio and complete coverage, and apply the existing waveform thresholds unchanged. Physical microphone qualification needs separate consent and complete reference evidence. Native capture remains a development option until those results justify a production decision.

## Installed qualification

Candidate04 completed one audited public-reference capture in an owned Ubuntu/GNOME/Wayland
KVM guest. All 1,834,119 source frames matched the independently retained renderer samples;
the complete 37.44-second reference passed the unchanged waveform gate and all 64 words had
zero substitutions, deletions or insertions. Explicit Copy, source loss in a second capture,
manual Retry without recapture, source revocation and guest cleanup also passed. This is
virtual-source evidence for that package and path, not physical microphone qualification.

The first audited attempt remains failed because the guest's group-writable `.local`
ancestor prevented private audit export. After GUI shutdown, its mode was temporarily
changed from 0775 to 0755 and the same package was launched again. The original mode was
restored after qualification. The application did not weaken its directory checks or
change source selection automatically. Do not interpret a missing audit bundle as a pass.

The [candidate04 delivery record](../../../foundations-evidence/iteration-13/application-integration/native/backend-integration-01/NATIVE-AUDIT-DELIVERY-04.md)
binds the exact source, package, outcomes, failed attempt and independent reviews. Its
frozen source snapshot retains the earlier pre-install wording; this working documentation
records the later result. Package03's prepared-wave evidence remains separate. Native
capture still requires both development switches and explicit app-session approval; wider
speech, desktop, physical microphone and destination qualification remain open.

## Optional native audit

For a development build, all three exact runtime flags must be `1`:

```sh
VOCO_DEV_NATIVE_CAPTURE=1 VOCO_DEBUG_CAPTURE_AUDIO=1 VOCO_DEBUG_NATIVE_CAPTURE=1 voco
```

The normal explicit microphone choice and app-session acknowledgment still apply. The audit does not enable a source, start recording, grant browser permission or change the default backend. It is one-shot per process: an attempted audit is not automatically rearmed after failure. Restarting for another audit is a deliberate new run.

Before uncorking the first audited capture, the native worker reserves its bounded packet store: at most 144 MiB, plus a journal limited to 131072 events. A reservation failure refuses that requested audited Begin; it does not silently capture without evidence. Packet replay is retained as replay, and journal or packet exhaustion makes the audit incomplete. The event bound is based on actual events, not an assumed minimum callback interval. Peak process memory is higher than the packet cap because journal values, renderer-retained samples, IPC copies and preparation buffers also coexist.

No filesystem operation runs in the audio callback. After terminal handling, ownership of the audit data moves to a background writer. The writer streams unique issued PCM spans from the stored packets instead of allocating another full raw buffer. The native bundle contains `descriptor.json`, `journal.json`, `packets.bin` and `raw.s16le`. Issued blocks, byte-identical replay, accepted ACKs, rejected operations and terminal receipts have distinct meanings. A stop request alone does not prove that every trailing block was delivered and acknowledged. Cancellation, capture failure, missing terminal coverage and persistence errors cannot qualify as complete evidence.

A separate renderer witness exports the actual retained mono F32 bytes before DC removal or resampling, with the immutable capture descriptor and native identity. Its bundle contains `source.f32le` and `renderer.json`. It does not reconstruct these samples from backend raw PCM, and it does not substitute already-prepared recovery audio. Comparing this independent retained buffer with the exact stereo-average conversion provides stronger retention evidence than an accepted ACK request alone.

Bundles are private under `$XDG_STATE_HOME/voco/debug-native-captures`, or the corresponding user state directory when unset. The shared `voco` directory is not chmodded; it must be owned and not writable by other users. The audit root and each unique bundle are 0700, with exclusive 0600 single-link regular files. Directory traversal is anchored to opened descriptors and does not follow symlinks. Collisions, replaced entries and unsafe ownership/modes are rejected. `COMMIT.json` is published last after payload persistence, with exact file lengths and SHA256 values; incomplete private payloads may remain after failure. A commit and successful writer completion are required, not a filename or log message alone. These files contain audio and should be retained or deleted deliberately.

The offline verifier performs no recording or transcription:

```sh
python3 scripts/verify-native-capture-audit.py \
  --bundle /absolute/path/to/native-bundle \
  --expected /absolute/path/to/independently-bound-descriptor.json \
  --renderer-bundle /absolute/path/to/renderer-bundle \
  --output /absolute/path/to/new-result.json
```

The expected file is the complete descriptor envelope independently bound for the planned run, not a copy invented from the candidate output after inspection. The verifier checks strict schemas, file hashes, identities, ordered packet extents, replay/ACK transitions and complete frame coverage. With the renderer bundle it also compares every retained mono sample against the exact native conversion. Omitting that optional argument produces native-only evidence and reports that renderer mono was not compared. This audit establishes transport/retention relationships; the existing separate full-reference waveform gate remains necessary to evaluate source continuity. Neither audit establishes physical microphone fidelity or general recognition accuracy.

## Shortcut readiness and installed keyboard evidence

The installed candidate04 Alt+D check in the owned run06 GNOME/Wayland guest remains
failed. One QMP chord reached the focused GTK receiver, but VOCO observed no keyboard
shortcut ingress, recording admission or inference. Both receiver fields and the empty
clipboard remained unchanged. The log reported no readable evdev keyboard. The timed
observer's final snapshot missed its deadline; later fresh reads and the final transferred
trace confirmed no recording in the current GUI segment, without retroactively completing
that observation window. Guest settings, source graph and processes were cleaned up and
QEMU exited normally. See the [independent run06 review](../../../foundations-evidence/iteration-13/application-integration/local-vm/run-06/DECODER-OUTCOME-REVIEW.json).

Current source adds observational shortcut readiness to runtime diagnostics and the
onboarding, popover and settings instructions. A configured key alone is not advertised
as available. The observation checks the current configuration and renderer heartbeat,
an armed IBus poll or the applicable live keyboard/global registration; an uncertain
consuming IBus lease withholds passive-route readiness. Frontend observations expire and
late replies cannot restore readiness after configuration or surface changes. None of
these observations registers a new shortcut, changes trigger admission, grants raw-input
access, selects IBus automatically or enables native capture by default. The microphone
footer identifies the approved native source rather than substituting the browser default.

The initial
[renderer-01 fixture](../../../foundations-evidence/iteration-13/application-integration/platform-next-01/hotkey-readiness/renderer-01/) did not load the application's CSS and provides logic evidence only; its screenshots do not qualify the styled layout. The corrected [renderer-08 run](../../../foundations-evidence/iteration-13/application-integration/platform-next-01/hotkey-readiness/renderer-08/RESULTS.json) passes all 36 interaction cases with the production stylesheet and fonts. It verifies the 420×520 popover and 760×560 Settings view, current source label, expired and late diagnostics, and wheel scrolling. That check exposed and fixed a Settings grid that exceeded its visible area; navigation and content now scroll within the available height. These are local Chromium checks with mocked native and media boundaries, not installed WebKitGTK evidence. The earlier installed Alt+D failure remains preserved as its own result. Tray initiation remains the explicit fallback; physical microphone, desktop permissions and destination qualification retain their separate requirements.

The separately bound [run07 installed review](../../../foundations-evidence/iteration-13/application-integration/local-vm/run-07/ROOT-QUALIFICATION.json) covers candidate05 on the owned GNOME/Wayland KVM guest. The actual packaged WebKitGTK panel showed the configured-key fallback and approved microphone label; Audio settings allowed scrolling to source consent. With the original US input source and no readable evdev keyboard, one Alt+D remained in the receiver and caused no admission. After selecting VOCO Dictation through GNOME's normal input-source UI, the initial generic GTK receiver still failed the planned positive test. Its fields supplied no explicit content hints; the existing eligibility policy requires fresh, known, non-sensitive metadata. That failed attempt remains separate evidence.

A separate GTK receiver explicitly declared public `FREE_FORM` / `SPELLCHECK` fields. With the same installed GUI, selected source and permissions, one Alt+D produced exactly one authoritative IBus ingress and one recording admission; the receiver did not receive the D key. The observed overlay Cancel stopped capture without a transcription request or completion. Cancel retained test audio in memory, and the observed Discard recovery control released it. Both fields and the clipboard's no-selection state remained unchanged. No speech was played or transcribed. The guest's original input source, audio default, idle/lock settings and permissions were restored, all owned capture/GUI/receiver processes stopped, and QEMU exited normally. This qualifies that keyboard/cancel path in one explicitly typed GTK context; it does not qualify generic fields, other desktops/apps, physical capture, recognition or Stop-to-final latency.

The run also exposed a status-only defect: an idle bridge reports no active insertion session, which prevented the `focus-required` guidance even when the bridge was connected and returned a fresh disarmed shortcut poll. Current source uses bridge availability plus that fresh poll for the guidance. It still requires an armed poll for IBus shortcut availability and does not relax field eligibility or automatic delivery. This correction is newer than candidate05 and is **not included in run07's installed result**. Its source and validation evidence are kept in [idle-shortcut-status-01](../../../foundations-evidence/iteration-13/application-integration/platform-next-02/idle-shortcut-status-01/).

## Offline native callback lifecycle regression

Run `npm run test:native-capture-callbacks` on Linux with a C11 compiler, Python 3, pkg-config and libpulse development headers. The runner respects `CC` and `PKG_CONFIG_PATH`; missing dependencies fail explicitly. It compiles only a temporary standalone executable with strict warnings, ASan/UBSan and linker section elimination, then removes it. Compilation is bounded to 60 seconds and execution to 10 seconds. Optional `--report NEW_FILE.json` retains commands, source hashes and outputs; existing reports are never overwritten.

The fixture includes the actual native C implementation and exercises read callbacks, 64-slot overflow, exact retained prefix/ACK order, cork/barrier completion, timeout, operation cleanup, source/server errors and healthy cancel. Packing coverage checks exact PCM for 200/500/1000/2000 ms input extents with four fragment shapes and three initial publication states. Boundary cases cover atomic overflow, exact capacity, exposed partial immutability, out-of-order peek, slot reuse, the capture ceiling and terminal tails. The Begin reset witness intentionally fails stream creation after checking reset bookkeeping; it does not establish successful source startup. Pulse transport objects, callback scheduling and monotonic time are controlled doubles. The runner does not connect to an audio server, build Rust, record audio or invoke a model. These are input extents under a controlled schedule, not measured renderer pauses. CI runs this in the native feature job with libpulse-dev installed.

The source-bound [native-load-01 evidence](../../../foundations-evidence/iteration-13/application-integration/native-load-01/PLAN.md) preserves the original queue's overflow after 64 nominal 441-frame callbacks. The packing candidate retains all positive backlog extents without enlarging PCM storage. Near-full tests deliberately retain overflow as a failure when exposed blocks leave insufficient capacity. A separate actual-C-to-client fixture verifies every expected mono sample, immutable replay and final ACK across six regrouped schedules. Its packet adapter simulates serialization and terminal flags; it complements the C callback and Rust tests. It does not qualify installed renderer scheduling, level-meter timing or canonical-checkpoint timing, which can change with delivery grouping.


## Previously qualified package native capture

The capture-input-gap-01 package was verified in a fresh local KVM GNOME/Wayland guest with native capture explicitly enabled. That package predates the queue packing change above; it includes the shared sample-count calculations and recovery controls. One complete public repetition recording preserved all 64 words with zero edits. The native audit accounted for all 4,159 blocks and 1,834,119 frames, matched independently retained renderer audio, and ended with complete acknowledgments and a healthy Stop. The original whole-fixture waveform gate passed at 0.999986 correlation, with all four quarters passing. Prepared audio contained exactly 665,440 samples; this recording had an integral output extent, so fractional rounding edge cases remain covered by the separate arithmetic tests. This result cannot qualify the newer native-load-01 source or its behavior under renderer stalls.

In the same process, Copy returned the complete transcript, Clear allowed one short recording with four words and zero edits, and Cancel retained audio for Review Recording and Discard without inference or a new recording. Later recordings did not have independent raw audits. Two UI-action preconditions failed after clipboard inspection dismissed the panel; the actions were not attempted, the records were retained, and unchanged content was available after reopening. The clipboard tool's documented focus behavior is a plausible cause, without a captured protocol-level focus witness. Guest configuration, clipboard, audio graph, settings and permissions were restored; QEMU shut down normally and its backing disks were unchanged.

This is synthetic installed capture and consumer evidence, not physical-microphone, broad desktop, automatic insertion, comparative performance or production-default qualification. Native capture remains a development opt-in, and the separate default WebKit continuity failure remains open. Exact identities and reviewed evidence are in [native-current-01](../../../foundations-evidence/iteration-13/application-integration/native-current-01/DELIVERY.md).
