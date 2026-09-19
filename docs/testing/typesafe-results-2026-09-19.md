# TypeSafe-guided dictation evaluation · 19 September 2026

## Findings and decisions

1. **Retain context 1.** Context 0 fixes one development word substitution, but
   leaves held-out WER unchanged, uses 49.2% more median worker service time, and
   brings first worker text forward by only 7.4 ms. In the small paired desktop
   check, it puts the first text into the field later. This does not justify a
   global default change.
2. **Track semantic errors separately from WER.** Jev flags the public fixture's
   `idealisation` → `idolization` substitution in both settings (material-error
   probabilities 0.54 and 0.62). This is a review trigger, not a calibrated verdict.
   A low aggregate WER can hide a meaningful change in a short sentence.
3. **Treat six-thread tuning as machine-specific research.** It reduced service
   time in the exploratory replay while preserving complete transcript text.
   More threads do not establish lower perceived latency, better battery use or
   suitability for a four-core machine. Two threads were slower than four.
4. **Punctuation accuracy and true word-display lag remain unmeasured.** The
   current audiobook references have no independently audited punctuation or
   word-end times. Punctuation differences are visible, but assigning accuracy
   percentages to them would invent ground truth.

No product defaults, installed binary, recognition model, public package, or
delivery policy changed. The work adds a repeatable evaluation and a dated chapter
in the VOCO guide. The experimental settings below are not a shipped “after.”

## Real TypeSafe results

This time the evaluation called the real API: **40 case evaluations**, pinned
`jev-1.13.0`, using only synthetic challenge text and public-fixture transcripts.
The response totals were **27,269 input tokens and 1,568 output tokens**. No audio,
personal transcript or destination text was sent. The temporary credential file
was removed after the evaluations; it was never printed or committed.

The [rubric and protocol](typesafe-evaluation.md) distinguish a 0–3 meaning score
from an independent consequential-error probability. Values below normalize
meaning to 0–100; they are **not word accuracy or overall app grades**. No
confidence threshold permits automatic acceptance or text insertion.

| Speech set | Current context 1 | Experimental context 0 |
| --- | ---: | ---: |
| Meaning, 8 development speakers | 95.79 / 100 | 97.29 / 100 |
| Meaning, 4 held-out speakers | 86.50 / 100 | 86.17 / 100 |
| Material-error review flags on held-out set | 1 / 4 | 1 / 4 |
| Lowest meaning confidence on held-out set | 0.32 | 0.19 |

Each transcript/setting was judged once. These small score differences are not
statistically established improvements; judge repeatability was not estimated.
The held-out set was withheld from this tuning decision, but is an existing
historical regression corpus, not a fresh independent benchmark.

The synthetic judge challenge used 16 authored cases: unchanged text, equivalent
numbers, negation, quantities, recipients, conditions, omissions, invented actions,
punctuation and quoted prompt-injection instructions. At the **provisional** 0.5
material-error threshold it flagged 10/10 positive cases and 0/6 negative cases.
Brier score was 0.00698; mean absolute meaning-score error was 0.1769 on the 0–3
scale. These are author-label smoke-check results, not population calibration.

The invented-action example received **2.10/3 meaning** alongside **0.76 material
error probability**. That is direct evidence for separate semantic hard checks.
An overall average would make this transcript look safer than it is.

The initial client rejected eight otherwise usable responses because an overly
strict recomputation check did not allow the API's observed two-decimal rounding.
We retained those failures, added a bounded mathematical rounding tolerance and
revalidated the same raw responses without new API calls. All 40 retained responses
then satisfied the typed contract. This is a client-validation correction, not an
improvement in Jev's judgments or VOCO's recognition.

## Matched local worker measurements

Baseline source: `946ce185c7cab68ecb9ab20aaa837c8febc18c77` (.41 candidate).
Model SHA-256: `d9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d`.
The runtime and each fixture have exact file hashes in every run plan. The worker
uses the pinned Q8 NVIDIA payload, digital-zero gate and production 20 ms packets.

Hardware: AMD Ryzen 7 PRO 8840HS. The primary comparison ran A–B–B–A, one complete
12-speaker corpus per run, with real-time PCM pacing: **24 trials per setting,
48 total**, all completed. Each setting contains 476 reference-word observations
across two playbacks of 238 unique reference words. Repeats are not extra speakers.
No microphone, renderer, native delivery or clipboard is part of this boundary.

| Measure | Context 1 / 4 threads | Context 0 / 4 threads |
| --- | ---: | ---: |
| Lexical errors / reference words | 12 / 476 | 10 / 476 |
| WER, all fixtures | 2.521% | 2.101% |
| WER, development only | 2.500% | 1.875% |
| WER, held-out only | 2.564% | 2.564% |
| First hypothesis from paced replay, median | 1,175.1 ms | 1,167.6 ms |
| First hypothesis, descriptive p95 | 1,494.8 ms | 1,489.0 ms |
| Warm worker Start acknowledgement, median | 0.122 ms | 0.116 ms |
| Worker Finish acknowledgement, median | 66.7 ms | 76.5 ms |
| Service time / audio duration, median | 0.257 | 0.384 |
| Median of per-session text-update gaps | 162.4 ms | 161.2 ms |
| Longest observed text-update gap | 1,601.4 ms | 1,520.9 ms |
| Median new words per hypothesis update | 1 | 1 |
| Peak sampled worker RSS | 1,012,367,360 bytes | 1,011,544,064 bytes |

Percentiles use nearest rank and are descriptive; 12 speakers do not qualify a
population tail. Service time includes the harness/JSON exchange, not just CPU
compute. Text-update gaps include genuine pauses; there are no audited voiced-span
labels. The sub-millisecond Start row is a warmed worker protocol acknowledgement,
**not shortcut-to-recording feedback**. RSS is sampled worker memory, not whole-app
or transient peak memory. Model loading was process-cold with OS cache uncontrolled.

The development improvement is one `laudable` recognition per replay. Strict WER
also counts spelling/orthographic differences such as `honor`/`honour` and
`et cetera`/`etcetera`; the semantic judge can accept equivalent meaning. Future
reference alternatives must be audited and frozen before tuning, not added to
erase observed errors after the fact.

Punctuation changed in both directions under context 0, including missing final
periods and changed comma placement. This reinforces the need for audited
punctuation references rather than interpreting the WER improvement as a complete
text-quality improvement.

## Six-thread follow-up and two-thread rejection

Four unpaced exploratory arms (context 1 / 4 threads, context 0 / 4 threads,
context 1 / 2 threads, context 1 / 6 threads) each completed 16 development trials.
Their median service RTFs were 0.245, 0.354, 0.340 and 0.205 respectively. These
throughput-only runs did not measure perceived timing. Two threads were slower
without a text-quality gain, so that arm was not extended.

We then replayed the full 12-speaker corpus twice with **context 1 / 6 threads**.
All 24 trials completed, and complete final text—including punctuation—matched the
four-thread arm for each corresponding trial. No new TypeSafe call was needed to
evaluate identical reference/transcript pairs.

| Paced worker measure | 4 threads | 6 threads |
| --- | ---: | ---: |
| WER | 2.521% | 2.521% |
| Service RTF, median | 0.257 | 0.228 |
| Finish acknowledgement, median | 66.7 ms | 59.8 ms |
| First hypothesis, median | 1,175.1 ms | 1,170.5 ms |

This is **11.2% less median service time** on the AMD Ryzen 7 PRO 8840HS test system, but only 4.6 ms
earlier first text. The six-thread runs occurred later rather than in a second
counterbalanced A/B sequence; energy, thermals, loaded desktop behavior and other
CPU classes were not qualified. It is a promising machine-specific follow-up,
not evidence for a universal six-thread default. No default was promoted.
Across all exploration and paced arms there were **136 completed worker trials**;
only 12 distinct public speech fixtures were used.

## Packaged application and actual recipient

Four isolated GTK/X11 desktop trials ran A–B–B–A against the **same sealed .41
executable**, with only the context environment variable changed. They used public
fixture `422-122949-0000`, a private PulseAudio virtual microphone, private Xvfb /
Openbox / D-Bus / IBus, and a network-disabled container with four CPU cores of
quota and a 6 GiB memory limit. No test speech entered the active desktop.

Executable SHA-256: `f8a7b7de8846060f0f37535ddc7ea42370fd56ed535aa2a380dd0d4453626438`.
Image SHA-256: `ef2ef2d506962abb881de2eda9c9c140a2c7bb2237a0c1c9502d5d050c8bd1df`.

| Recipient-bound observation | Context 1: two trials | Context 0: two trials |
| --- | ---: | ---: |
| Start command → capture-active observation | 50.67–50.68 ms | 50.75–101.02 ms |
| Playback process launch → first field text | 1,365.5–1,380.8 ms | 1,455.0–1,457.8 ms |
| Stop command → idle observation | 207.28–207.85 ms | 207.36–208.53 ms |
| Median interval between field text changes | 295.0 ms | 233.0 ms |
| Unintended writes to the other field | 0 / 2 trials | 0 / 2 trials |

All four trials completed. These are **ranges from two trials**, not p95 estimates.
State observations poll every 50 ms, and the Start/Stop origin is an `xdotool`
command. Field `changed` callbacks observe text, not painted pixels. Playback
launch is not first-word end, and the harness deliberately waits for active capture
before playing the fixture, so it does not qualify speech-on-shortcut onset clipping.
The final text change happened before Stop in these trials; Stop-to-idle is not a
measure of a demanding final speech tail. The field update count includes punctuation
updates. Physical microphone, default compositor and application acceptance remain
separate.

## Reproduction, retained evidence and next work

The tools and commands are in [the protocol](typesafe-evaluation.md). The
machine-readable curated table is [typesafe-summary-2026-09-19.json](typesafe-summary-2026-09-19.json).
Raw request/response files, speech transcripts, run plans, Docker command arrays,
field observations, screenshots and every attempted run are retained in the
external `typesafe-evidence-2026-09-19` directory. They are not bundled into the
guide or application. The guide keeps its .39 source catalog and identifies this
as a later research chapter.

Next acceptance work is concrete: independently audit word/clause times and
punctuation alternatives, expand speaker/noise/device coverage, measure true
word-end-to-recipient lag and Stop during speech, collect physical desktop evidence,
and run matched competitor trials. The protocol specifies initial numerical
targets, non-compensating safety rules and the minimum evidence needed to make
a comparative quality claim.
