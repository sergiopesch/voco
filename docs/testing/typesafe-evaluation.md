# Measuring and improving VOCO with TypeSafe

This is a development evaluation protocol, not an online dictation feature. VOCO
continues to recognize speech locally. The optional evaluator sends only explicitly
selected public or synthetic reference/transcript pairs to TypeSafe. It never
receives microphone audio, personal dictation, clipboard data or recipient contents.
The local study guide itself makes no external requests.

## What the skill does, and what we must supply

The [TypeSafe skill](https://docs.typesafe.ai/agent-skill) is agent guidance, not an
automatic quality certificate. [Jev](https://docs.typesafe.ai/introduction) judges
text against questions we define. It cannot hear audio or observe screen paint.
Its [current model contract](https://docs.typesafe.ai/models) supports text inputs.
We must provide evidence, an explicit rubric, representative labeled cases and the
policy that turns answers into engineering decisions.

1. **State:** a reference transcript and actual output, with documented provenance.
   Word timing and formatting require independently audited annotations. A model's
   own transcript cannot become its ground truth.
2. **Questions:** one dimension each. `Score` grades meaning fidelity from 0–3;
   `Noul` estimates whether a consequential error exists. An additional punctuation
   `Score` runs only with an audited formatting reference. We accept equivalent
   wording and punctuation without ignoring incorrect facts or negation.
3. **Answers:** retain the raw response, model version, rubric/request hashes,
   probability distributions, confidence, token usage and request duration. The
   runner validates types, bounds and question identities. Live responses round
   probabilities/scores to two decimals; consistency checks allow only the bounded
   accumulated rounding error.
4. **Calibration:** challenge the judge with known mistakes and unchanged controls.
   Author-written challenge labels are a smoke check, not independent validation.
   Before a release gate, two human annotators must label a held-out set and
   adjudicate disagreements. Measure false negatives, false positives, Brier score,
   calibration by probability bin, and score disagreement. Recheck after any rubric
   or judge-model change.
5. **Decision:** calculations and safety rules stay in code. A 0–100 semantic display
   is `100 * score / 3`, not percent-correct words. [Confidence](https://docs.typesafe.ai/confidence)
   describes distribution concentration, not truth. No single semantic average can
   waive lost words, wrong numbers, unsafe insertion, or missing measurements.

The client pins `jev-1.13.0` rather than a moving alias, uses the documented
[HTTP endpoint](https://docs.typesafe.ai/api), bounds input/output and request time,
refuses redirects, and retries only throttling/overload with bounded backoff.
All independent questions for a case share one request. Token use is recorded;
latency here belongs to the research evaluator, never to the user's speech path.

## Criteria for excellent English dictation on Linux

These are **initial engineering targets**, chosen for a responsive, accurate user
experience. They are not published industry standards or claims already achieved.
Freeze them before a comparison; revise them only in a new protocol version with
the reason recorded. Report every metric by hardware, microphone, environment,
desktop/application and corpus stratum. Never turn missing evidence into a zero.

| Measure | Exact start → end boundary | Initial target |
| --- | --- | --- |
| Cold readiness | Process launch → warmed worker and usable UI | p95 ≤ 5 s |
| Start feedback | Physical shortcut event → visible recording indication | p95 ≤ 100 ms |
| Capture admission | Shortcut event → first accepted source audio frame | p95 ≤ 150 ms; no clipped onset |
| First correct word | Audited first spoken word end → first correct word observed in recipient | p50 ≤ 350 ms; p95 ≤ 700 ms |
| Ongoing word lag | Each audited word end → first stable correct occurrence in recipient | p50 ≤ 400 ms; p95 ≤ 800 ms |
| Display cadence | Gaps between additions during continuously voiced spans | p95 ≤ 800 ms; report burst size and longest stall |
| Punctuation lag | Audited clause/sentence end → correct stable mark at aligned recipient boundary | p95 ≤ 700 ms; missing marks count as missing, not zero latency |
| Stop feedback | Stop shortcut → visible finishing/stopped indication | p95 ≤ 100 ms |
| Stop completion | Stop shortcut → final intended text observed and capture closed | p95 ≤ 500 ms; maximum ≤ 2 s on the reference machine |
| Clean lexical accuracy | (Substitutions + deletions + insertions) / reference words | WER ≤ 3%; report each component and speaker distribution |
| Difficult lexical accuracy | Same metric, separately for noise/accent/distance strata | WER ≤ 8% in every declared supported stratum |
| Numbers, names, negation | Audited exact/equivalent protected-span matches | ≥ 99.5% numbers/negation; ≥ 99% names; report denominators |
| Text accuracy | Raw character error rate and normalized lexical CER | Publish both; never erase formatting failures through normalization |
| Punctuation accuracy | Precision/recall/F1 at unambiguous aligned boundaries | F1 ≥ 0.95; sentence-boundary F1 ≥ 0.98; publish exclusions |
| Capitalization | Correct case on unambiguous eligible words | ≥ 99%; names reported separately |
| Meaning fidelity | Jev 0–3 plus independent human judgments | Target mean ≥ 2.97/3; no confirmed consequential errors |
| Correction effort | Human correction time and editing actions | ≤ 1 edit action / 100 words; ≥ 95% reduction vs typing the same text |
| Compute headroom | Worker service seconds / audio seconds | p95 RTF ≤ 0.5; no growing queue in 10-minute speech |
| Resources | Whole-app peak RSS, idle CPU, energy per dictated minute | Initial RSS budget ≤ 1.5 GiB normal / 3 GiB recovery; publish CPU/energy until hardware budgets are set |
| Safety and resilience | Wrong-target writes, duplicate output, lost retained samples, silent failures | Zero observed; any occurrence rejects the candidate |

WER can exceed 100% and is not universally `1 - accuracy`. Latency for an incorrect
or missing word is censored; report the missing fraction beside the matched-word
latency distribution. Do not improve latency by dropping slow or difficult cases.
Provisional text, final model text, dispatched text, observed field text and painted
pixels are separate evidence levels. Accessible-field sampling has a polling bound;
pixel claims require timestamped frames or an independent optical measurement.
Clocks must share an origin or a measured synchronization error.

## Corpus, fairness and release decisions

The repository's 8-speaker clean corpus is for development. Its separate 4-speaker
corpus is a held-out check **for this tuning experiment**, although both were used
historically. Neither is a worldwide test. Their uppercase reference text lacks
audited punctuation and word-end timestamps, so those measures remain unavailable.

Build the acceptance set before further tuning: at least 30 speakers, 1,000
utterances, 20,000 reference words, balanced reported accent/noise/device strata,
conversational notes, messages, technical names, numbers, negation, short commands,
questions, lists, silence, long dictation and interruptions. Include varied pace,
quiet speech, hesitations and self-correction. Use licensed public audio or explicit
consent. Keep all personal material local; separate public judge data from owner QA.
Audit punctuation alternatives and word/clause timestamps independently of VOCO.

Use a frozen development/validation/test split by speaker. Randomize paired A/B
order, preserve every attempted trial, and repeat under warm/cold and idle/loaded
conditions. Give medians, p95, maxima and counts; do not qualify a p95 with fewer
than 100 independent applicable observations, or p99 with fewer than 1,000. Repeated
playbacks measure variability, not extra independent speakers. Use a paired
speaker-cluster bootstrap for confidence intervals on the larger acceptance set.

Candidate acceptance is a vector of gates: no safety failure, no new consequential
semantic error, no accuracy regression in any required stratum, and a reproducible
improvement in the targeted metric without exceeding resource budgets. A global
weighted score can hide dangerous regressions, so there is no release total.
Jev's provisional material-error threshold of 0.5 is a review trigger only; it is
not a calibrated acceptance threshold. Human review owns consequential-error labels.
Even zero failures in 3,000 independent trials supports only an approximate 0.1%
upper 95% failure-rate bound, not guaranteed safety.

To substantiate “best,” run competing Linux dictation apps on the same consented
audio, hardware, destination apps and boundaries, with pinned versions/configuration
and the same scoring. Compare correction effort, speed, accuracy, privacy and Linux
compatibility separately. Without that comparison, no world ranking is justified.

## Reproduce the evaluation

The harness requires Python 3.11+ with NumPy/psutil in the **worker** environment and the
verified pinned local NVIDIA payload. It streams PCM directly into a child process;
it never plays audio, opens the microphone or touches the clipboard. Start with the
production 20 ms packet cadence, context 1 and four threads. The study scripts do
not change application defaults.

```sh
/usr/bin/python3 scripts/evaluate-dictation-worker.py \
  --runtime /absolute/path/to/verified/runtime/speech \
  --output /absolute/path/to/new-baseline --repeats 2 --paced
node scripts/score-dictation-worker.mjs \
  /absolute/path/to/new-baseline/run.json /absolute/path/to/new-baseline/score.json
python3 scripts/typesafe-evaluate.py \
  --input tests/fixtures/typesafe/calibration.json \
  --output /absolute/path/to/new-judge-check
# Inspect the generated public/synthetic request files first. To call the service:
python3 scripts/typesafe-evaluate.py \
  --input tests/fixtures/typesafe/calibration.json \
  --output /absolute/path/to/new-live-judge-check --send
```

The final command reads `TYPESAFE_API_KEY` from the environment; a private credential
file can be supplied with `--key-file`. Never put keys in Git, shell command
arguments, receipts or the guide. Output directories must be new; failures remain
in attempt records. `--context 0` and `--threads 2` are experiments, not deployment
instructions. Run one CPU experiment at a time to avoid contaminating timings.

See [the dated before/after report](typesafe-results-2026-09-19.md) for actual
outcomes, judge limitations, rejected candidates and the next evidence gaps.
