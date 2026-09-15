# Dictation quality attribution (.36 diagnostic candidate)

The .36 diagnostics measure recognition, queue transformation and delivery separately.
They remain in .37, which adds [focused-field observation and sentence joining](delivery-observation.md).
The selected model and generic final-message formatting are unchanged.

## Local logging

Enable the existing `VOCO_PERFORMANCE_LOG=1` opt-in for local metadata. Normal
logging never records audio, transcript text, clipboard text, window titles or
URLs. Debug audio recording remains a separate explicit option and is unnecessary
for these metrics. Do not turn it on for ordinary use.

`speech_quality` events correlate the stream, worker request and delivery IDs.
Hypothesis, delivery request, native dispatch and terminal events expose queue
age, dispatched lengths and transformations. UTF-8 bytes, Unicode scalars and
UTF-16 code units have explicit units; do not subtract unlike lengths. Native
metadata records the existing leading-space key/paste split. A frontend terminal summary
marks destination verification unavailable; individual .37 native dispatches may
separately report sampled observation of the eligible field. Helper completion proves dispatch,
not target consumption or paint. Unknown outcomes must not be retried blindly.

Diagnostic sending is bounded, allowlisted and best effort. Sequence/drop counts
make missing diagnostics visible. Packet sample offsets describe ingress to the
speech queue, not independent hardware continuity. Timers with different origins
must not be subtracted to infer stage latency.

## Exact-text scoring

The separate Node scorer keeps existing speech WER gates unchanged. It compares
reference, model, queued and observed text only when those inputs are available.
Observed field contents require an owned disposable test target or explicit local
diagnostic consent. Never read arbitrary user fields to populate a report.

```bash
node scripts/dictation-quality-cli.mjs --input /path/to/private-fixtures.json --output /path/to/new-quality-report.json
```

Inputs use schema version 1, provenance, case IDs and separate optional reference,
modelText, queuedText, intendedFieldText and observedField fields. The complete
intended field includes known prefill/selection behavior; do not infer it from the
queue. Formatting references must explicitly authorize punctuation and case
scoring. The CLI refuses to overwrite a receipt. Reports contain aggregate numeric
results, not raw transcripts; keep input fixtures private unless redistribution is
permitted.

Exact codepoint character errors complement lexical scores. Whitespace boundary,
punctuation and capitalization metrics retain alignment exclusions and ambiguous
cases. Uppercase/unpunctuated corpus annotations cannot establish display-format
accuracy. Missing model text or field observations stay unavailable, never zero
errors. Tests cover Unicode, revisions, repeated sessions and reference limits.

## Installed application tests

Record package, executable, model and runtime hashes plus session/backend identity.
Exercise empty/prefilled/selected fields, repeated sessions, delayed clipboard
reads, focus changes and worker failure in isolated desktop namespaces. Retain
failed attempts and distinguish harness errors from application failures. Use the
same harness against baseline and candidate. A private X11 GTK fixture does not
qualify Codex, Brave, Ghostty or the owner's physical Wayland session.

Trace-based inspection can change worker scheduling. Exclude traced runs from
normal performance comparisons, and discard their quality interpretation if the
observer provokes stream failure. Use untraced trials for performance and report
playback-start versus word-end origins accurately. A single trial is not a tail
latency estimate. No public release claim follows from a diagnostic score alone.

Punctuation is scored as a multiset per aligned boundary, so its order is checked
by the separate exact-text metric. Internal apostrophes stay lexical. Empty gold
references retain edit counts with unavailable rates. Alignment work is bounded;
limits are reported explicitly rather than silently truncating long cases.

## Metadata correlation report

Summarize retained opt-in performance JSONL files, including adjacent rotations
when available, without loading transcripts or field contents:

```bash
python3 scripts/report-dictation-quality-events.py /path/to/performance.jsonl /path/to/performance.jsonl.1 --output /path/to/new-metadata-report.json
python3 scripts/test-report-dictation-quality-events.py
```

The report checks per-stream hypothesis, queue delivery, native dispatch and
terminal identities, length/sample reconciliation, sequence gaps, duplicate IDs,
dropped records and absent terminal summaries. `reconciled_dispatch_metadata`
means those recorded stages reconcile; destination content remains `unavailable`.
Missing instrumentation also remains `unavailable`. Partial rotations, malformed
records or failed sessions produce incomplete evidence. Timing observations have
separate frontend and native origins and must not be added together. Sample counts
cover queue ingress and validated responses, not independent microphone continuity.
The parser bounds line sizes and record count, reports truncation, excludes unknown
content fields, and refuses to overwrite an existing report.
