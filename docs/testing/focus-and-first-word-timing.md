# Focus-event verification and first-word timing

The desktop helper now subscribes to `object:state-changed:focused`. It uses an event's source only as a search hint: before using it, it refreshes its focused state, process identity and parent chain to the active window, including the parent's current child reference. A stale or detached hint falls back to the bounded fresh tree search. The tree fallback now budgets 128 discovered nodes globally instead of truncating each container to 30 children. This covers more wide containers while bounding total child fetches. Some GTK controls do not emit a focus-gained event until an accessibility client first discovers them; the native test exposed this gap. Larger or inaccessible trees can still exceed the budget.

Observed focus departures or switches advance an opaque generation. Returning to the original field therefore does not silently resume a previous destination transaction. Repeated gain notifications for the same current field do not change the token. A helper restart changes its nonce, invalidating earlier tokens. The app retains its existing rejection/recovery behavior when the expected token no longer matches.

The event queue is drained before discovery, with a 256-iteration limit; an unresolved backlog returns unavailable metadata. The helper does not read field text, accessible names, window titles or clipboard content. No event payloads or destination tokens are written to performance logs.

`destination_check` records a finite scope (`control`, `window`, `unavailable`), whether event registration succeeded, the operation (`status` for status observations, `paste` for dispatch checks), and outcome (`observed`, `matched`, `rejected`, `unverified`). `duration_ms` measures the fresh helper query for each operation. Status observations include startup and diagnostic reads, so use paste-stage records for dispatch probe latency.

Window fallback remains for compatibility when neither a fresh event hint nor the bounded search establishes a control. Missing events, inaccessible controls, delayed event delivery and the interval between checking and pasting remain coverage limits. `events_tracked=true` means successful registration, not proof that a toolkit emits every transition. A capture started without a token still follows the existing unverified compatibility path. No universal focus safety claim is made.

## Recognition diagnostics

The local runtime now records per-input-call `recognizer_push_ms`, `result_drain_ms`, `recognizer_push_calls`, and `first_nonzero_audio_s`, alongside existing gate, queue, processed/skipped/buffered audio and total request timings. Calls flushed from the initial zero-silence buffer are counted separately within a transport request. Input validation, samples, cadence, weights and output handling are unchanged.

`first_nonzero_audio_s` locates the first nonzero digital sample. It is not speech onset or a word boundary: real microphone noise often makes it zero. No audio or transcript is added to routine logs. Stop timing remains in the existing finish/ASR metrics; the new push/drain split covers push calls. The native `stream_next` function advances `runner_->step()`: `result_drain_ms` therefore includes model computation and result collection, not just Python copying. `recognizer_push_ms` covers input submission/resampling. Use the separate native stage trace to distinguish encoder and decoder work inside advancement.

`NEMO_SPEECH_TIMING=1` enables the pinned native library's existing encoder/decoder diagnostic lines. Use it only in a separately labelled profiling run, and compare profiling-on/off output and timing. Encoder timing includes first cache-state initialization and projection; decoder timing includes token accumulation after encoding. These times do not cover every operation in the worker.

The `word_boundary_estimate` example produces offline Whisper token timestamp estimates for public benchmark audio supplied as raw mono 16 kHz float32 samples. It does not alter VOCO's inference path. The timestamp feature is experimental and these estimates are not human acoustic annotations. Do not treat subtraction from a first-word clock as a production latency guarantee.

Verification belongs in a new dated evidence directory. Keep previous evidence immutable and preserve actual field readback separately from model-only timing.
