# Whisper repetition recovery — 14 September 2026

A contained recovery change passes the frozen 12-case repetition suite that exposed
four legacy Whisper failures in CI. All broader local regression checks passed. The
owner's merge gate is unchanged: fix the failure and pass the required checks
before merging; a waiver or a passing aggregate score does not satisfy it.
This work does not change the selected NVIDIA live dictation model or authorize a
release cut.

## Reproduced failure and rejected experiment

The unchanged baseline reproduced all four CI failures for the speaker-777 fixture
at leading offsets of 0, 175, 500 and 750 ms. Each scored 17 word edits over 45
reference words (37.78% WER), exceeding the unchanged 25% case threshold. This
behavior also occurred in the historical baseline; it was not introduced by the
2026.0.35 version change.

Candidate 1 preferred exact digital-silence boundaries but retained the existing
eight-second coalescing of adjacent recovery ranges. Its 327 Rust library tests
passed, but the same four cases still scored 17/45. All 12 recognition scores were
unchanged. That experiment was rejected; passing unit tests did not resolve the
accuracy failure.

## Accepted local hypothesis: bounded repetition recovery

Candidate 2 changes retry partition selection only when the native decoder reports
repetition-rejection history. In that path it can preserve separate partitions at
the centers of interior, exactly zero-valued pauses lasting at least 200 ms. At
least two usable boundaries are required; every resulting partition must be at
least 1.5 seconds, no longer than eight seconds, and the total must not exceed 20
partitions. Edge padding is not an interior boundary. Original samples, their order
and complete coverage are preserved.

If those conditions are not met, or a different decoder failure triggered recovery,
the original energy-based range selection and coalescing remain in effect. The
change does not rewrite recognized words, consult reference text, replace the
model, or change the existing 512-context behavior. Exact-zero pauses provide a
narrow signal: this is not a general speech-silence detector and does not establish
better recovery for noisy microphone pauses.

## Frozen focused comparison

The baseline and candidate use the same 12-case plan, model and scoring policy.

| Measure | Baseline | Candidate 2 |
| --- | ---: | ---: |
| Cases passing their gates | 8/12 | 12/12 |
| Each of the four previously failing cases | 17/45 edits; 37.78% WER | 9/45 edits; 20.00% WER |
| Other eight case scores | Reference | Unchanged |
| Total edits / reference words | 84/724 | 52/724 |
| Aggregate WER | 11.60% | 7.18% |
| One-pass elapsed time | 41.83 s | 40.80 s |
| Rust library tests | — | 329 passed, zero failed |

No focused case worsened. Each corrected case now falls below its unchanged 25%
threshold, but still contains nine errors; this is not perfect transcription. The
elapsed times are one pass per variant and are not evidence of a general speedup.
Independent code review found no blocking issue; that review does not replace the
remaining execution gates.

The focused plan SHA-256 is
`c91252bcc7e1cc7c4a0d80510f2db4a023c448b40b40af3297a1b625d5ecc91c`.
The unchanged Whisper model SHA-256 is
`a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`.

## Remaining gates and evidence

Broader baseline/candidate comparisons use identical frozen plans: 58 adversarial,
12 boundary and six mixed cases. Baseline and continuity checks are also required.
All 76 cases passed for both variants, with no worsened case scores. One adversarial
case improved by one word edit; boundary and mixed scores were unchanged. The
separate baseline and continuity checks also passed. These local receipts qualify
integration for CI; all required GitHub checks must still pass on the integrated
commit before merging.

Two historical name-recognition qualification failures have not been rerun or fixed
by this focused change. Do not describe all Whisper accuracy as qualified. Real
laptop acceptance, the existing release-cut approval gate and further artifact
verification also remain separate.

Local evidence is retained outside the repository in the supplied
`whisper-repetition-evidence-2026-09-14` directory. Relevant receipts include
`BASELINE.json`, `FROZEN-PLANS.json`, `CANDIDATE-DECISIONS.md`,
`candidate1-comparison.json`, `candidate2-comparison.json`, and
`candidate2-lib-tests.log`, `candidate2-{adversarial,boundary,mixed}-comparison.json`,
`candidate2-speech-baseline.json`, and `candidate2-speech-continuity.json`.
Consult the delivery index for the local absolute path. Preserve the original
failures and rejected experiment; do not rewrite historical receipts or copy audio
and transcripts into public documentation.
