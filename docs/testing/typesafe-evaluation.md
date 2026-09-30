# TypeSafe evaluation

These tools compare changes to VOCO's speech worker. They replay public speech
into the worker, score the transcripts and, when you ask, have TypeSafe's
[Jev](https://docs.typesafe.ai/introduction) judge whether each transcript keeps
its reference's meaning. VOCO never runs or ships them, and TypeSafe receives
only the questions and the text of public or synthetic cases, never audio.

## Replay and score

`scripts/evaluate-dictation-worker.py` runs the `stream_worker.py` in `--runtime`
under its own Python, which needs 3.11 or later with NumPy and psutil, and streams
each clip's samples to it over the worker's JSON protocol. It opens no microphone,
audio device or clipboard, so it measures the worker alone. It needs a Git
checkout and the [provisioned runtime](../linux-packaging.md#runtime-provisioning).

```bash
/usr/bin/python3 scripts/evaluate-dictation-worker.py \
  --runtime runtime/speech --output NEW-REPLAY
node scripts/score-dictation-worker.mjs NEW-REPLAY/run.json NEW-score.json
```

| Option | Default | Choices |
| --- | --- | --- |
| `--split` | `development` | `development`, the eight [speech fixtures](../../tests/fixtures/speech/README.md); `held-out`, the four [held-out clips](../../tests/fixtures/speech/adversarial/README.md); or `all` |
| `--packet-ms` | 100, as VOCO sends | 20, 40, 50 or 100 |
| `--context` | 1, as the worker uses | 0 or 1, as `VOCO_NEMOTRON_CONTEXT` |
| `--threads` | 4 | 1 to 8, as `NEMO_SPEECH_CPU_THREADS`; VOCO uses one fewer than the available CPUs, between 1 and 4 |
| `--repeats` | 1 | 1 to 10, each in its own shuffled order, the same on every run |
| `--paced` | Off | Sends each packet in real time and records how late each send was |

The worker keeps its default backend and silence gate, without performance
logging or `TYPESAFE` variables. The evaluator checks each clip's SHA-256 and
writes to a new private directory: `plan.json`, with the commit, the host, the
options and the SHA-256 of the harness and the runtime's code and model;
`worker.stderr`; `trials.jsonl`, with each trial's transcript, updates, timings
and memory; and `run.json`, only when every trial completes and the worker exits
cleanly. The first failed trial is written to `trials.jsonl` and stops the run.

The scorer writes a new private file and prints the trial counts, the word error
rate with its substitutions, deletions and insertions, ignoring case and
punctuation, and the median, p95 and maximum round trips and worker time over
audio time. Percentiles are nearest rank and only descriptive, because repeated
clips aren't independent speakers. The `unavailable` block names what a
replay can't measure, from shortcut start to any ranking against other apps.

## Judge with TypeSafe

`scripts/typesafe-evaluate.py` sends each case to Jev, pinned to `jev-1.13.0` at
TypeSafe's [documented endpoint](https://docs.typesafe.ai/api), as one request.
Its input is a JSON file whose `provenance` is `public-fixture` or
`synthetic-calibration`, with 1 to 100 `cases`, each with a unique `id`, a
`reference`, a `transcript` and `formattingAudited`. For a replay, take each
trial's `reference` and `hypothesis` from `run.json`, with `formattingAudited`
false, as the fixture references have no audited punctuation. The 16 synthetic
cases in `tests/fixtures/typesafe/calibration.json` carry expected answers.

Every question tells Jev to treat both texts as quoted speech, never as
instructions. `meaning` scores from 0 to 3, against four written criteria, how
faithfully the transcript keeps the reference's meaning. `material_error` is the
probability of a consequential error or omission in negation, quantities, names,
obligations, conditions or actions. `punctuation` scores from 0 to 3 and is
asked only when `formattingAudited` is true.

```bash
python3 scripts/typesafe-evaluate.py \
  --input tests/fixtures/typesafe/calibration.json --output NEW-REQUESTS
python3 scripts/typesafe-evaluate.py --send \
  --input tests/fixtures/typesafe/calibration.json --output NEW-JUDGED
python3 scripts/report-typesafe-evaluation.py --evaluation NEW-JUDGED/evaluation.json \
  --labels tests/fixtures/typesafe/calibration.json --output NEW-report.json
```

Without `--send`, nothing leaves the computer: each request is written to a file
marked `not_sent`, for you to read. With `--send`, the key comes from
`TYPESAFE_API_KEY` or `--key-file`, a regular file, not a link, of at most 8 KiB
that you own and no one else can access. Never put a key in Git or on a command line.

Requests time out after 45 seconds, never follow redirects and are retried only
for HTTP 429 and 529, up to three attempts. Each response must name the model,
answer exactly the questions asked and keep its probabilities and score
consistent within the service's two-decimal rounding. A failed case is kept with
its error stage and the run continues, then the script exits with status 1. It
never prints a response body, a header or the key.

`scripts/report-typesafe-evaluation.py` rechecks each request's SHA-256 and each
response without calling the service and writes a new file. For each group of
cases it gives the mean meaning score, from 0 to 3 and as `100 × score / 3`, the
lowest confidence and the cases with a material-error probability of 0.5 or more;
ids starting `baseline-` or `context0-` form their own groups. `--labels`, the
evaluated input itself, adds true and false positives and negatives at 0.5, the
Brier score and the mean meaning error. `automaticAcceptance` is always false.

## Reading the results

- Eight development clips and four held-out clips are too few to rank settings
  or models, repeats add no speakers, and the references have no punctuation or
  word timing.
- A material-error probability of 0.5 or more sends the case to a person. It is
  not an acceptance threshold, and no mean score outweighs lost words, a wrong
  number or a failed trial.
- The calibration labels are the author's, a smoke check rather than independent
  validation. [Confidence](https://docs.typesafe.ai/confidence) says how
  concentrated Jev's answer is, not whether it is right.
- Other settings are experiments that change nothing in VOCO. Run one at a time.

`npm run test:dictation-evaluation` tests the judge's checks, the key file rules
and the scorer without a real key or network access. The
[evidence rules](README.md#evidence-rules) apply: keep every attempted trial and
failed case, give each run a new directory, and remove local paths before sharing.
