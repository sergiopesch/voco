# Speech integrity evaluation

Iteration 5 adds strict integrity requirements alongside the existing WER gates. It does not lower previous thresholds or turn a passing family average into a waiver for failed words. `scripts/speech-integrity.mjs` imports the existing Unicode word normalization and deterministic substitution/deletion/insertion alignment. Its reports retain all three error counts independently; equal total word counts cannot prove complete speech.

For synthetic complete repetitions, the reference must be exactly the declared phrase repeated the declared number of times. Acceptance requires both the exact normalized full sequence and the expected count of nonoverlapping complete phrases. A partial final phrase, missing phrase, or extra phrase fails even when the previous WER≤0.15 gate passes. Substitutions remain errors; phrase counting is not a mechanism for correcting text. Decoder-owned continuity fixtures retain every complete source sample, and canonical prefix/append checks remain separate.

Explicit boundary requirements must match the beginning/end of the complete reference. Empty speech, a missing final word, malformed hypotheses, unknown/vacuous requirements, Boolean or nonfinite numeric budgets fail. Insertion and deletion limits are independent. These tests evaluate observable transcript fidelity; they do not establish that model timestamps identify hallucinated words.

Run pure tests with `node --test scripts/speech-integrity.test.mjs`. After an authorized unchanged-plan worker run, use:

```sh
node scripts/report-speech-integrity.mjs path/to/plan.json path/to/report.json NEW-integrity-report.json
```

The adapter verifies the report's exact plan hash, matching model, complete unique case IDs and successful worker exit. It recomputes errors from actual `chunkText`, retains the original suite result, and exits nonzero on any failure. It writes a new report without overwriting prior evidence. The recognition runner is still `scripts/test-speech-adversarial.py`; the added adapter runs no model.

The new qualification plan is prepared with `scripts/prepare-speech-qualification-next.py --archive PATH --prior-qualification-plan PATH --plan-dir NEW-DIRECTORY`. It excludes all eight original, four adversarial and eight already-evaluated qualification speakers, then selects the next eight numeric dev-clean speakers and their first lexicographic complete utterance fitting 30 seconds. Sixteen cases use clean speech and the same speech with deterministic 40 dB SNR white noise; four additional complete utterances are padded at the existing fixed positions 0/5/10/tail with continuous background noise. The archive checksums, license, references, transformation metadata, source hashes and exact PCM extents are retained.

This plan retains the original per-case WER ≤ 0.5 and family WER ≤ 0.25 requirements. Its supplemental integrity gate independently requires zero deletions, zero insertions, and exact normalized first and last reference words. These requirements check bounded aspects of word integrity, not exact transcription or acoustic completeness. Candidate source and all requirements must be frozen before the single qualification run; results must not trigger tuning or a second attempt on the same qualification set. The prior 20 cases are now diagnostic, never reused as untouched qualification. Eight more read-speech speakers improve corpus independence but do not qualify spontaneous speech, physical microphones, other languages or user-population diversity.

Iteration 5 preparation and baseline comparisons live under `../foundations-evidence/iteration-5/evaluation/`. The two previously failed `KIRKLEATHAM YEAST` cases were replayed once on their identical retained PCM using the original decoder. Both reproduce `Kirkley Thim Yeast.` with one substitution and one insertion, exactly matching the newer decoder. They remain strict failures; this comparison establishes their measured historical origin and does not waive them.

The new 20-case plan was prepared without inference, then ran exactly once against the frozen iteration 5 candidate. All 20 pass the original WER gates; 18 pass supplemental integrity and only eight are word-exact. Two versions of a proper-name passage fail zero-deletion integrity. See the [iteration 5 acceptance record](foundations-iteration-5-2026-09-05.md) for counts, raw-evidence pointers and remaining recognition failures. No tuning or qualification rerun followed those results.
