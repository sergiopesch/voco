# Laptop performance diagnostics

## Current NVIDIA candidate

The 2026.0.37 application and worker share opt-in `VOCO_PERFORMANCE_LOG=1`.
Start the **complete** candidate through its verified launcher/binary after normal
shutdown; an extracted base package cannot supply the speech runtime by itself.
Capture package/executable, worker and model hashes with every comparison.

Application logs are in `voco/performance/`; worker logs are in
`voco/stream-performance/`, beneath `${XDG_STATE_HOME:-$HOME/.local/state}`.
The worker retains `worker.jsonl` and up to three rotated files, 8 MiB each (32 MiB
maximum file allowance); the application retains two 8 MiB files. Both use bounded
asynchronous queues. Disk/queue failures must not block recognition; losses and
incomplete shutdown remain evidence limitations. These are separate from existing
hotkey trace retention and explicit debug captures.

```bash
python3 scripts/report-speech-performance.py "${XDG_STATE_HOME:-$HOME/.local/state}/voco"
python3 scripts/report-performance.py --json
```

The Rust `speech_worker_failed` event adds finite `stage` (`startup`, `exchange` or `liveness`),
finite `reason`, `exit_observed`, and nullable numeric `exit_code`/`exit_signal`.
The exit status is observed before cleanup kills the child; null means unavailable,
not success. Exchange outcomes include `worker_eof`, `worker_disconnected` and
`request_backlog`. An idle child found exited at the next start/warmup records `liveness`/`idle_exit`
before replacement, including its observed exit status. Mid-session failures are
not replayed. No arbitrary exception or child stderr is copied into these events.

Worker startup failures use fixed stages (`runtime_import`, `model_initialize`);
import-stage errors may occur before file metrics are available and are recorded
as sanitized stderr categories. Oversized or truncated worker protocol input exits
with a failure status. Retain stderr alongside rotated files when investigating
startup, without copying arbitrary transcripts or environment dumps into reports.

Worker stages include silence gate, recognizer push, result drain, queue age and
first hypothesis. `gate_released_frames` counts gate output frames before batching;
`recognizer_push_calls` counts actual native calls. They need not be equal.
Sample-preserving preroll batching reduced call overhead; no material first-word
speedup was demonstrated. Nonzero audio is not acoustic speech onset.

App/worker session hashes correlate requests, not recipient rendering. First
hypothesis, clipboard completion, keyboard dispatch and observed field mutation
have different boundaries. Never report any of the former as cursor paint latency,
match updates by ordinal position, or sum overlapping timers. Routine diagnostics
cannot score words, omissions or correctness because they omit text and audio.
CPU/RSS scope differs by logger; external process-tree PSS evidence is separate,
and neither CPU nor RSS establishes energy usage or leak freedom.

The sections below retain the application logger contract and dated development
notes; versioned measurements and old model policies are historical evidence.


The local foundations candidate has automated and isolated smoke coverage. Everyday
stability still needs real laptop use. Diagnostics explain observed behavior; they
do not automatically certify recognition quality or a stable release.

## Start and report

Quit the running VOCO instance normally, then start the **diagnostics-enabled
candidate binary** with:

```bash
VOCO_PERFORMANCE_LOG=1 /absolute/path/to/extracted/usr/bin/voco
```

VOCO 2026.0.22 and newer include this recorder. Earlier foundations packages
predate it; setting the variable on an older executable does not add instrumentation. A package
can be extracted with `dpkg-deb -x candidate.deb /path/to/new/extracted-directory`;
extraction does not install or change the active input method. Normal application
use still reads the user's existing config/model and uses their chosen microphone.
The agent's automated smoke uses the separate private virtual-audio harness.

After a test session, from the application repository:

```bash
npm run report:performance
python3 scripts/report-performance.py --json > laptop-performance-report.json
```

The report reads `${XDG_STATE_HOME:-$HOME/.local/state}/voco/performance/` and selects
the latest app run. Pass another directory as the first argument, or `--run <id>`
for an older retained run. Save **both** `performance.jsonl` and
`performance.previous.jsonl` (if present) with the report when sharing a test.
Quit VOCO normally before copying logs to reduce the possibility of a partial final
line. Missing/incomplete records and dropped events remain visible in the report.

No installation or diagnostics setting is changed automatically. Restart without
`VOCO_PERFORMANCE_LOG=1` to disable the new recorder. Existing lifecycle logging is
unchanged. Diagnostics are entirely local; nothing is uploaded.

## Measurements

| Measurement | What it establishes |
| --- | --- |
| Directed Start/Stop admission | Fixed `dictation_trigger_*_admitted` and `*_rejected` categories distinguish commands passing authorization/phase validation from rejected commands. They contain no raw trigger tokens or arbitrary reasons. Admission is not proof that capture/teardown completed; correlate with recording lifecycle events. The attached session number, when present, is the session active at admission, not a newly allocated Start session. |
| Recording request → capture active | Backend-observed startup interval, separated from first-text and finalization time. |
| Identical preview reuse | `dictation_live_preview_reused` counts reuse only when session, generation, sample rate and exact source bounds match. It is not a native recognition completion or a zero-millisecond decode. Stop/cancel/discard clears the cached result; no extra audio copy is retained. |
| Preview, first live text, checkpoint, Stop → final/idle | Existing frontend duration events, when emitted by the selected mode; absent measurements stay unavailable. |
| Capture Stop → teardown / prepared | Differences between backend event receipt times. Existing teardown/prepared `duration_ms` fields describe the **amount of audio**, not processing latency, and are reported separately. |
| Native input validation, model availability, decoder lock wait, model load/cache, recognition | Per-IPC request stage timings with monotonic clocks, mode, outcome, audio sample count and request ID. Early returns retain their failure stage. |
| Recognition real-time factor | Recognition wall time / requested audio duration. Values below 1 mean faster than that input's duration; overlapping/retried audio does not represent unique recorded speech. |
| Capture input gap / capture-health interruption | Counts of the existing worklet and WebKit watchdog failures. The generic watchdog counter covers mute, ended/disconnected track and sample timeout; it does not distinguish those causes. |
| Delivery, focus-related failure, manual Copy, recovery | Counts of existing lifecycle outcomes. Manual Copy is not classified as successful automatic insertion. |
| CPU, peak RSS, page faults, context switches | Two-second samples of the Rust process, including decoder threads. CPU 100% means one core; several cores can exceed 100%. Peak RSS is a lifetime high-water mark. WebKit/browser/helper resources and battery use are excluded. |
| Build/run identity and evidence completeness | Executable SHA-256, package version, model name, compiled capture feature, session type, run ID, event sequence and dropped-event counter. |

Summaries show count, median, p95 and maximum. Report native outcomes by mode and
keep failed, skipped and empty requests visible. Frontend reloads get separate
session epochs; only hybrid native requests carry the frontend session ID, so other
native requests must not be assigned to a frontend session by guesswork.

## Privacy, overhead and retention

The recorder is disabled by default. It records numeric/boolean metadata and fixed
event categories, **never audio, transcripts, clipboard values, window titles,
URLs, device names, arbitrary errors or configuration dumps**. It does not enable
`VOCO_DEBUG_CAPTURE_AUDIO` or native capture. File activity, counts, timing and build
identity are still diagnostic metadata; share them deliberately.

A dedicated writer receives a bounded 256-event queue through nonblocking sends.
Each file is capped at 8 MiB with one previous file, so the new logs retain at most
16 MiB. A full queue drops diagnostics and increments a counter rather than delaying
recognition. Directories are private (0700), files are private (0600), and unsafe
existing final directory/file entries are refused. Disk errors disable this recorder
without changing dictation behavior. Existing `hotkey-trace.jsonl` is separate and
its retention policy is unchanged.

There is no audio-callback instrumentation or new recognition policy. Timers,
small metadata allocations, hashing the executable once and resource sampling still
have overhead; zero impact has not been established. Abrupt termination can lose the
last queued events. An absent clean-exit marker does not prove a crash, and an exit
request marker does not prove successful full shutdown.

## Useful laptop trial

1. Note the candidate checksum, microphone/headset, output mode, AC/battery state,
   and whether the machine is otherwise busy. Avoid changing several variables together.
2. Try a cold launch and repeated short dictations, then a 1–3 minute natural passage
   with pauses. Include punctuation, numbers and names you normally dictate.
3. Exercise Stop, Cancel, manual Copy, and switching focus while recording. Note any
   unexpected destination change, lost words, repeated words, hangs or confusing state.
4. Write a short observation beside each problematic session: what you did, what you
   expected, what appeared and roughly when. Avoid sensitive text in shared notes.
5. For measured word accuracy, read an agreed passage and compare the returned text
   with that reference. Operational logs do not contain enough information to compute
   word-error rate, omissions or hallucinations. Recording or sharing personal audio
   requires a separate explicit choice.

Historical latency and crop findings must be rechecked against the selected runtime;
old Whisper findings do not automatically describe the NVIDIA path.
Physical desktop reliability, natural speech accuracy, accessibility, whole-app power
use and perceived responsiveness remain separate qualification work; no aggregate
"great app" score is generated from incomplete measurements.

## Preview performance candidate — 2026.0.24

Preview decoding uses padded contexts for inputs up to 20 seconds. A failed
short-context attempt falls back once to the original context and retry policy;
rejected partial output is never published. Final/canonical transcription keeps
its existing context and accuracy policy. A preview error after both attempts
remains visible as an error, not a fabricated empty success.

The browser acceptance harness records exact Rust-process CPU ticks in
`process-cpu.json`, using the host's `getconf CLK_TCK` conversion. These process
lifetime totals include decoder threads and the test's recovery/debug work, but
exclude WebKit and Chromium. Compare identical fixtures and flows on the same host,
without simultaneous builds. Do not interpret CPU seconds as elapsed seconds,
power draw, or battery life. The harness now fails if a live preview fails during
its healthy synthetic speech scenarios, even when final transcription succeeds.

## Diagnostic review — 2026.0.25

The report now lists each recording separately, keyed by process run, frontend
reload epoch and session ID. It keeps short recovery checks separate from long
recordings, splits native timings by outcome, and lists the five slowest request
IDs per mode for raw-log inspection. A recording with no observed start is marked
as such. Native preview/final requests still lack frontend session IDs; do not
assign them to a recording by guessing from adjacent timestamps.

New numeric metadata makes the following costs observable:

- `dictation_stop_checkpoint_wait_completed`, `dictation_stop_preview_wait_completed`
  and `dictation_stop_insertion_wait_completed`: sequential frontend waits after
  audio teardown. They measure residual blocking at each await, not the complete
  background task duration. An earlier wait may overlap work measured later.
- `preview_diagnostics.initial_context_frames`: selected initial Whisper context;
  one context unit spans 20 ms of model input.
- `preview_diagnostics.reduced_attempt_us` and nullable `fallback_us`: elapsed
  decoder-policy attempts, including their internal retries. A non-null fallback
  measures the original-context attempt, even if it failed. Zero is a measured
  sub-microsecond/rounded duration, not absence. Requests skipped before recognition
  have no preview diagnostics. Both attempts remain inside native recognition time;
  do not add them again to that stage.
- Writer queue delay, cumulative backend CPU through the last resource sample,
  sample coverage and available page-fault/context-switch deltas. CPU work after
  the last sample remains unmeasured; these are not whole-app energy metrics.

Old logs remain readable. Missing wait/fallback values are `null` or zero sample
counts, never fabricated zero latency or proof that no fallback occurred. Invalid
payloads are counted and excluded; duplicate sequence records are counted and
excluded from aggregates. Malformed-line counts cover all supplied files because
an invalid record may have no usable run ID.

`review_flags` identify incomplete logs, unpaired requests, native errors, failed
previews and absence of active recording. These are review prompts, not automatic
crash diagnoses or release qualification. In an intentional failure test, evaluate
flags against its expected outcome. No flags does not prove correct words or
correct insertion; reference scoring and destination assertions remain separate.

## Required inputs for the next performance comparison

Record these alongside each run, with unavailable values stated explicitly. Do not
put dictated text, device identifiers, URLs or secrets into performance logs.

| Input | Evidence or test note |
| --- | --- |
| Exact candidate and model | Package version, executable SHA-256 and model SHA-256 from the package/test receipt. An installed old app is not the new candidate. |
| Speech workload | Fixture ID/hash, reference ID and audio duration; for physical speech use a consented reference test stored separately from diagnostics. |
| Capture and delivery | Physical or private synthetic capture, output mode, sample rate, chosen app/field test category, and expected focus/recovery behavior. |
| Warmth and repetition | Cold app/model start or warm session; repeat index and baseline/candidate order. |
| Host conditions | AC/battery, selected power profile, significant background work, approximate thermal state, and whether conditions changed during the comparison. These are test notes, not newly collected product telemetry. |
| Instrumentation | Diagnostics on/off, debug audio on/off, exact test script/source snapshot, start/end time, and resource scope. Synthetic debug capture belongs in private test evidence. |
| Independent success criteria | Reference word error rate, repetition/omission assertions, target-field assertions, Stop/recovery success and preview health. Set expectations before running. |

Keep workload and instrumentation fixed when comparing builds. Alternate order and
repeat runs; report every valid run and label rejected runs with the reason. Do not
compare CPU totals from recordings of different durations or flows. Validate build
identity and evidence completeness before ranking latency improvements.

For the next bounded round, include: cold start and short speech; warm 40-second
natural speech; repeated phrases; pause/unfinished-phrase previews; Stop while
preview or checkpoint work is active; expected focus-loss recovery and a fresh
recording. Follow with a physical microphone/noise trial and a longer session,
reported separately from the deterministic fixture comparison.


## Delivery-aware manual review — 13 September 2026

The report now includes `delivery_observations` per recording and review flags for
unavailable/failed cursor delivery and manual Copy. A completed transcription is
not evidence that words reached the target. These fields describe observed events:
`false` means not observed, and partial logs cannot establish absence. Expected
focus-loss recovery or deliberately requested Copy can produce review flags without
being a product failure; compare them with the test's intended outcome.

The first physical 2026.0.26 laptop review found two completed transcriptions but
no cursor sessions or target commits in the Codex desktop editor. The native IBus
mutation path is explicitly disabled. Chromium exact-field fixture passes do not
qualify the Codex desktop editor. `first_text_ms` comes from the existing owned
preview update event; it is neither a physical paint measurement nor a destination
commit receipt. Missing values must not be replaced with zero or labelled fast typing.
The review report is in `../../../manual-review-2026-09-13/` from this document.


For 2026.0.27 native-paste candidates, `desktop_paste_enabled` records the launcher
policy and per-session events identify the actual path. The report keeps desktop
paste dispatch separate from exact-field output completion. Its
`desktop_paste_dispatch_needs_target_verification` flag requires inspecting the
recipient, because input helpers do not provide an editor receipt. See
[desktop-paste.md](desktop-paste.md).


## Streaming foundation diagnostics (2026.0.31)

Each recording now separates preview/final recognition and queue-wait duration
distributions. Fixed event categories count coalesced/superseded snapshots and
empty, waiting-agreement, unchanged or revised hypotheses. Superseded
counts include both queued and in-flight work, so they need not equal coalescing
counts. Queue wait is the age of the newest pending audio, not the age of the
oldest replaced snapshot. These remain local metadata; no transcript or target
application name is included. Missing timing samples remain unavailable.

The full native test measures field mutations independently of helper dispatch.
A private virtual-microphone fixture proves capture-to-decoder-to-editor behavior
on its tested desktop; it does not establish physical-microphone noise handling,
all applications, or the proposed sub-second latency targets.


In 2026.0.32, native preview outcomes include `skipped_budget`. The report exposes
the count under `native_requests.preview.outcomes` and adds
`desktop_preview_budget_exhausted` for inspection. It is a completed, intentionally
abandoned speculative request, not a decoder error or evidence of dropped audio.
Compare skip frequency, live update gaps, final target text, Stop latency and CPU
together; a lower decode duration alone is not enough to accept an optimization.

For the 2026.0.33 startup schedule, use `dictation_desktop_snapshot_requested`
audio durations to distinguish startup additions from the regular schedule. Pair
native preview outcomes and recognition durations with `waiting_agreement` and
the first desktop dispatch. A dispatch timestamp alone still does not prove the
target received text: first-word comparisons require independent field readback
and a known playback/onset reference. Compare different recording-to-speech delays
because cadence alignment can change the apparent first-word result.

## Current interpretation

Use [quality attribution](dictation-quality.md) for per-session sample, hypothesis
and delivery reconciliation. Equal accepted/dispatched byte counts do not prove
recipient content: a wrong one-byte key can preserve that equality. Report
`destination_content_observation` explicitly. Owner-reported Codex success is
manual acceptance evidence, not an automated field-readback or cursor-paint clock.
See [pre-release review](pre-release-review-2026-09-15.md).
