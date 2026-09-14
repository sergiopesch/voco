# Prospective speech and hallucination evaluation

`scripts/test-speech-adversarial.py` separates preparation from inference. Preparation writes an immutable plan, individual PCM16 WAVs, their hashes and one combined replay WAV. Evaluation refuses an existing results directory, checks every audio hash and the existing pinned model, and records source, worker, runner and Git provenance. It does not download models or record private audio.

The replay worker accepts complete canonical mono 16 kHz PCM16 WAV files only.
RIFF/data lengths, format size, byte rate and block alignment must match; truncated
or trailing bytes are rejected instead of silently shortening the recording. The
opened file must be regular and contain at most 512 MiB of PCM, accommodating
combined diagnostic corpora. On Linux, symlinks, FIFOs and devices are refused
before reading. Growth during reading is bounded too.

JSON request lines are limited to 1 MiB and reject unknown fields. Sample ranges
must be nonempty and entirely inside the file; they are never clamped. A
`fullSession` request must select the complete WAV, cannot also set `canonical`,
and cannot supply a canonical prefix. Only canonical requests accept
`previousCanonicalText`. The `--full` file interface deliberately decodes the
whole file; range comparisons must first derive an explicitly hashed WAV slice.
A file name is not evidence of its sample extent or reference transcript.

Run the worker's model-free input tests with
`cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --example preview_replay_worker`.
CI and release Rust gates use `--all-targets` so these diagnostic tests and the
browser fixture tests are included.

The fixed 58-case plan was selected before candidate inference:

- The exact original ten 30-second repeated-speech windows: leading silence and onset cropping at 0, 50, 100, 250 and 500 ms.
- Eight held-out phase windows: both transformations at 25, 175, 375 and 750 ms.
- All eight existing baseline utterances, unchanged and attenuated by gains 0.1 and 0.01 (24 cases).
- Three complete baseline utterances joined with 1-second and 5-second pauses (two cases).
- Four independent speakers: the first four numeric speaker IDs absent from the existing manifest, each speaker's first lexicographic utterance in the cached checksum-verified LibriSpeech dev-clean archive (four cases). Selection does not inspect recognition results.
- Digital silence, seeded uniform integer noise at amplitudes 3, 300 and 3000, and a 440 Hz tone at amplitude 3000; each at 3 and 30 seconds (ten controls).

The phase reference is thirteen repetitions of `GO DO YOU HEAR`. Some boundary words are partially truncated by the fixed windows. Those errors remain visible in the score; the evaluator does not choose a shorter reference after observing recognition. Exact retained PCM hashes establish continuity with the original empty-output diagnostic.

The evaluator uses the existing `speech-score.mjs` tokenizer and substitution/deletion/insertion scorer. Every speech case must contain words. Original and quiet versions retain the baseline per-utterance maximum WER of 0.5; unseen utterances use the same bound. Phase and pause cases use a maximum WER of 0.25. Each speech family independently must also achieve aggregate WER <= 0.25, preventing easy families from masking another family's failures. Non-speech controls must contain zero lexical words. All responses and failures remain in the report; a nonzero worker exit fails the run even when every response arrived.

These gates supplement the baseline, continuity and strict original phase diagnostics. The current continuity gate also requires the exact repeated sequence, independently of its unchanged WER threshold. Passing a nonempty-output check alone is insufficient. Synthetic controls are a bounded hallucination probe, not a claim to cover all real environmental noise or music.

```bash
python3 scripts/test-speech-adversarial.py prepare \
  --plan-dir /path/to/new/fixed-plan
VOCO_MODEL_PATH=/path/to/existing/ggml-base.en.bin \
python3 scripts/test-speech-adversarial.py evaluate \
  --plan-dir /path/to/fixed-plan \
  --worker /path/to/preview_replay_worker \
  --output-dir /path/to/new/candidate-results
```

Preparation uses checksum-verified repository WAVs by default, with no archive, network or ffmpeg requirement. Optional `--archive /path/to/existing/dev-clean.tar.gz` independently verifies the original corpus selection and uses the already used `ffmpeg` executable to reproduce identical PCM from FLAC. Evaluation uses the canonical chunk path with empty previous text, isolating recognition from text overlap merging. Existing full-session and preview acceptance checks remain separate requirements. Baseline and candidate must use the identical prepared plan, pinned model and worker interface, run serially without competing decoder loads.

`prepare-speech-boundaries.py --plan-dir /path/to/new/boundary-plan` prepares a separate twelve-case plan: complete brief speech at the end of 15.01/15.5/16/29.99/30-second captures; gain0.01 brief speech centered within the same lengths; and two complete utterances crossing the 15-second point. These cases preserve exact public references and do not change the original 58-case plan.

Pass `--worker-source /path/to/frozen/transcribe.rs` when evaluating a captured worker. Its `workerSourceSha256` is separate from the explicitly labelled current-worktree source/Git provenance. Older evidence retains its historical field names and should be interpreted with its saved source snapshots. Malformed responses, timeouts and setup failures produce a final failure report and traceback without overwriting earlier evidence; valid responses received before failure remain available.

The shared response reader bounds the complete JSON line to 120 seconds and 8 MiB,
including a worker that writes a partial line and stalls. Scoring has a separate
10-second timeout. A failure retains the active case, any complete response and the
worker exit status. The ordinary test suite exercises real pipe framing without a
model. The production speech wrapper hashes local Cargo, Rust and owned native
inputs before and after its build, rejecting concurrent source changes.

`compare-speech-adversarial.py BASELINE_REPORT CANDIDATE_REPORT --output NEW_COMPARISON` requires matching plan/model hashes, reports every edit-count increase and decrease, and exits nonzero for any worsened case or failing candidate. This stricter comparison prevents an aggregate passing threshold from hiding a new individual regression.

`prepare-speech-repetition-generalization.py --plan-dir NEW_DIRECTORY` prepares
twelve complete-reference repetition controls using the three shorter checked-in
additional voices (777, 1272 and 1993). Each repeats a fixed number of complete
utterances with 250 ms gaps and leading offsets of 0/175/500/750 ms, followed by
digital-zero padding to 30 seconds. No spoken source is cropped. Every case and the
family require WER <=0.25 and nonempty text. The separate mixed-level preparation
script challenges pause selection with quiet speech between louder utterances and
with a single full-scale impulse. Freeze both plans before evaluating a new policy.

A separate final qualification plan is prepared by `prepare-speech-qualification.py --archive EXISTING_DEV_CLEAN_ARCHIVE --plan-dir NEW_DIRECTORY`. It selects the next eight numeric speakers absent from both checked-in manifests and the first complete lexicographic utterance <=30 seconds per speaker. Each source is evaluated unchanged and with seeded 40 dB SNR white noise; four selected complete utterances are also placed at 0/5/10/tail in 30-second clips with the same continuous noise level throughout their pauses. Noise uses whole-source utterance RMS, records measured SNR and PCM hashes, and refuses clipping. The twenty cases retain per-case WER <=0.5 and each family's aggregate <=0.25.

Freeze that qualification plan before the next candidate inference. Do not run its recognition until a production candidate passes development58 and boundary12. The separate qualification stage must not become an iterative tuning set: preserve any failure and report that the candidate did not qualify. Existing plans are never replaced by newly prepared provenance variants.

The [iteration 4 candidate](foundations-iteration-4-2026-09-05.md) completed that
qualification once. Across the development, boundary, mixed-level, repetition,
matched-noise and qualification sets, 108 of 114 unique canonical cases pass and
six fail. Four repetition cases and two versions of a name-containing phrase
exceed their unchanged per-case bounds. These are failed release gates; their
passing family averages do not count as qualification.

Once a qualification case informs development or diagnosis, it is no longer an
untouched acceptance case. `prepare-speech-qualification-next.py --archive ARCHIVE
--prior-qualification-plan PRIOR_PLAN --plan-dir NEW_DIRECTORY` prepares twenty
cases from the next eight numeric corpus speakers, excluding the original eight,
four additional development speakers and the eight prior qualification speakers.
Selection uses source metadata, never hypotheses. Freeze the new plan before
candidate inference. Additional speakers from this read-speech corpus do not
establish spontaneous dictation, accent, device or population coverage.

The new plan declares supplemental integrity requirements before inference:
separate zero-deletion and zero-insertion gates plus exact normalized first/last
reference words. These are stricter than the unchanged WER bounds and are reported
separately. `node scripts/report-speech-integrity.mjs PLAN REPORT NEW_OUTPUT`
verifies exact plan/model provenance, complete responses and worker identity,
retains failures, and cannot waive an original suite failure. Its exact repeated
sequence option also detects missing/extra phrases that aggregate WER can mask.

Assertion-dependent Python evaluators refuse `-O`, `-OO` and nonzero
`PYTHONOPTIMIZE` before argument processing or fixture creation. Run validation
with assertions enabled. This guards the executable checks without changing
references, scores or normal-mode results.
