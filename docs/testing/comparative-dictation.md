# Comparative dictation evaluation

This protocol defines the prospective matched evaluation. A separate retained six-case
file comparison is complete: the current application worker had 7 word edits across 85
reference words, the historical VOCO result had 11, and Vibe had 12. Those diagnostic
cases reuse earlier observations and do not establish representative application quality,
matched latency or physical dictation performance. See the
[comparison evidence](../../../foundations-evidence/iteration-13/application-integration/COMPARATOR-DESCRIPTION-VERIFIED.json)
and its [per-case source record](../../../foundations-evidence/iteration-13/application-integration/comparator-update-proposal/description.json).

The broader matched product evaluation and text-card recordings below remain unmeasured.
This protocol compares bounded tasks, not “best application” claims. No new speech model,
private recording or audio download is authorized by this protocol. The existing base.en SHA-256 is `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`. Same model weights alone do not imply identical decoding, segmentation, defaults or user experience.

## Historical primary-source comparator discovery (5 September 2026)

The table preserves the pre-execution discovery scope. Vibe's later six-case file results
are linked above; they do not qualify its full desktop workflow or update the other entries.

| Project | Documented interface and model path | Eligible comparison and remaining checks |
| --- | --- | --- |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | The README demonstrates base.en GGML file inference and the `whisper-cli`/stream examples. | Decoder/file baseline. Freeze commit, build flags, `--help`, binary and exact model hashes before execution. It is not a desktop dictation peer and supplies no insertion/recovery claim. |
| [Handy](https://github.com/cjpais/Handy#custom-whisper-models) | Linux support; custom GGML `.bin` discovery; `--toggle-transcription` controls recording. The README describes Silero VAD. | A credible desktop dictation peer with a documented route to the same model. Exact base.en loading and auxiliary-model requirements remain unverified. Do not download VAD weights or silently disable its default pipeline to claim equivalent application performance. Under the current no-new-model constraint, eligibility is conditional. |
| [Vibe](https://github.com/thewh1teagle/vibe) | Linux support, custom model settings, file transcription/export and documented CLI availability. | A file-transcription peer, not an assumed direct-insertion application. Verify pinned-version local GGML base.en acceptance and CLI arguments before adding an executable adapter. No command syntax or successful same-model run is claimed here. |

These are source-described interfaces, not observed product efficacy. Record peer defaults, any disabled enhancement/network features and the exact reason for an unavailable comparator. Keep source versions contemporary and pinned; never replace a peer's default pipeline with VOCO's and label it peer performance.

## Frozen task design

Two strata remain separate. Existing licensed public WAVs provide reproducible file replay and historical regression checks; already evaluated fixtures are diagnostic, not new qualification. Novel text-only dictation cards are frozen in `comparative-dictation-cards.json`. They have no audio yet and cannot yield accuracy claims. Cards cover an ordinary message, numbered instructions, dates/currency, proper names, technical terms, repetition and a complete closing phrase. They are original test text, available under CC0-1.0; names and addresses are fictional test content or public historical names.

An explicitly consented recording session may later bind each complete utterance to an original audio hash, normalized evaluation PCM hash, device/session metadata and a human-checked verbatim reference BEFORE any recognizer output is viewed. Reading a card is read speech, not spontaneous dictation. Optional spontaneous messages require their reference transcribed independently before hypotheses, and belong to a separate stratum. No trimming words to fit 30 seconds. Preserve starts, endings, pauses, hesitations and repeated words. The native import lane owns consent/original-audio handling; this importer consumes its metadata mapping and never searches recording directories.

Do not count spelled-out numerals versus digits as semantic corruption without evidence. The importer reports strict lexical/orthographic protected-term counts. A future semantic rendering policy must be defined before outputs; no output-driven aliases or name corrections. Record S/D/I with the repository's existing NFKC/case/punctuation normalization, and preserve original reference/output files. [NIST's scoring toolkit](https://github.com/usnistgov/SCTK/blob/master/doc/sclite.htm) motivates separate alignment errors; this repository's deterministic tie order is not claimed byte-equivalent to SCLITE. WER alone can hide an extra repeated phrase or a damaged name.

## Measurement and limits

Freeze the exact plan and case order before each system run. Compare the same audio bytes on the same hardware, thread budget and accelerator policy. Record cold and warm runs separately; do not pool them. For a future multi-system campaign, predeclare a rotated system order and three runs per system/case, preserving every trial. A crash does not authorize a replacement trial. These repetitions measure runtime variation, not independent speakers.

Freeze resource caps with the campaign: the proposed operational ceiling is 120 seconds per decode request, eight CPU threads and 4 GiB peak RSS for the process tree. These are containment limits, not quality thresholds or measured product requirements. Enforce caps in the eventual execution adapter/cgroup; imported metadata cannot prove enforcement. Unknown RSS prevents capped qualification. Never kill unrelated desktop applications to improve timings. Capture host load, RAM, CPU, governor and GPU/backend/version; unrelated activity makes timings observed host measurements, not isolated benchmarks.

Use distinct timing boundaries: file decode request→complete result; actual dictation stop→final text; first stable text; and total task completion including correction. Keep model loading visible. Report completed-only p50/p90/p95 plus sample count, timeout/error/resource-limit counts and all censored durations. A success-only percentile must never stand in for all-attempt latency. Censored failures remain in the qualification denominator; do not invent their transcripts or WER. Avoid significance or population claims from this small, deliberately varied sample.

Minimum word edits are a correction-effort proxy, not observed typing. Human correction must separately log monotonic elapsed milliseconds and action count from the displayed hypothesis to the independently prepared final reference, with the same editor/input method and balanced order. Report missing observations as unmeasured. Do not infer keystrokes or correction seconds from WER. The present importer stores these measurements per case; it does not invent them.

## Executable file-output contract

`node scripts/comparative-dictation.mjs PLAN.json RUN.json NEW_REPORT.json` imports already retained application/worker outputs. It performs no inference, desktop access, network operation or model loading. Inputs must be regular non-symlink files of at most 8 MiB each; descriptor-based bounded reads reject FIFOs/devices and prevent path-replacement checks from authorizing another file. It exclusively creates a private report (0600), exits nonzero on failed gates or invalid input, and retains a validation error artifact. Never edit raw source evidence to fit the contract; construct an adapter-owned JSON sidecar with source hashes.

Plan schema 1 has `modelSha256`, `resourceCaps: {timeoutMs, maxRssBytes}`, and unique `cases`: `{id, reference, audioSha256, durationSeconds, maxWer, protectedTerms: [], integrity?}`. Copy historical WER thresholds exactly; optional `integrity` uses the existing speech-integrity schema. If present it must validate; null/false cannot silently disable a declared gate. Protected terms must occur in the frozen reference and require the same token-sequence occurrence count. This does not independently prove semantic identity or correct position.

Run fields: `planSha256`, `modelSha256`, `system: {id, version, artifactSha256}`, descriptive `environment`, explicit `timingBoundary`, `loadState: "cold"|"warm"`, and one row per case. A row contains `{id, audioSha256, status, elapsedMs, peakRssBytes, correction}`. Completed rows additionally require a string `hypothesis`; statuses `timeout`, `error`, `resource-limit` must not claim a completed hypothesis. `correction` is null or `{elapsedMs, actions}`. Retain partial/error output in the original evidence outside the scored sidecar. Missing/duplicate IDs, wrong hashes, nonfinite/boolean times, nonfinite converted durations or real-time factors, incomplete cases and unknown statuses fail validation.

The native session-import schema need not change: map its evaluation WAV checksum to `audioSha256`, retain original-source hashes alongside the sidecar, and use the exact completed reference/duration. A VOCO worker adapter may select one explicit `text` or canonical `canonicalText` field from the stored response; never concatenate both or choose whichever scores better. Imported peer artifacts and elapsed measurements remain supplied evidence, not authenticated telemetry.

Run focused tests with `node --test scripts/comparative-dictation.test.mjs`. Current tests exercise censoring, zero output, numeral/name damage despite passing WER, duplicated protected phrases, cap overruns, missing RSS, invalid metadata, private failure evidence and overwrite refusal. No model inference is involved. Existing broader speech failures remain unchanged.
