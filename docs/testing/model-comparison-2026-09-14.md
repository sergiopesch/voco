# Local model comparison — 14 September 2026

This is a summary of the frozen round-3 comparison, not fresh candidate validation
or a general model leaderboard. The original PDF, CSV datasets, raw logs, charts,
identities and rejected attempts are retained outside the repository in the private
`personal-benchmark-2026-09-14/round3` evidence directory. Do not publish the personal
recordings or transcript-bearing files without separate authorization.

## Method and denominator

Seven model/runtime configurations used the same three consented recordings, lasting
33.184, 93.749 and 303.712 seconds. Each was repeated three times: **63 selected
successful trials from 64 attempts**. One Whisper WAV-wrapper failure was corrected
and rerun; its original attempt is retained. The three recordings contain 919 written
reference-word positions, from one speaker, also used in earlier development rounds.
They are not an unseen evaluation corpus. Repetition improves timing evidence but
does not create additional independent speech examples.

The CPU-only host was a Ryzen 7 PRO 8840HS (8 physical/16 logical CPUs), with 27.1 GiB
OS-reported RAM. Same available CPU affinity; actual runtime thread configurations
differ and are frozen per adapter. A temperature-start gate was used, not constant
inference temperature. Ordering was interleaved, **not fully counterbalanced**;
Moonshine Medium started every long repetition. Desktop activity was not blocked.

| Model/runtime configuration | Literal WER | Normalized WER | Median first callback | CPU seconds / audio second | Max sampled RSS sum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Nemotron streaming candidate | 5.33% | 4.68% | 1.50 s | 0.94 | 0.98 GiB |
| Moonshine Small | 7.62% | 6.96% | 1.97 s | 3.17 | 0.52 GiB |
| Moonshine Medium | 7.94% | 7.29% | 1.97 s | 3.75 | 0.84 GiB |
| Qwen3-ASR 0.6B | 4.68% | 4.46% | 2.73 s | 2.97 | 2.86 GiB |
| Qwen3-ASR 1.7B | 6.42% | 5.98% | 3.71 s | 6.68 | 6.80 GiB |
| Parakeet TDT v3 tested offline adapter | 7.18% | 6.53% | Unavailable | 0.43 | 3.12 GiB |
| Whisper base.en tested offline adapter | 9.36% | 8.71% | Unavailable | 0.80 | 0.40 GiB |

WER ignores case/punctuation; the normalized score additionally expands contractions.
Number rendering remains significant. First callback starts at audio sample zero,
not acoustic word end and not visible cursor paint. Offline adapter results say
nothing about every possible streaming implementation of that model family.
CPU totals cover controller/recognizer replay work, excluding warmup/load; they are
not elapsed time, energy or battery measurements. RSS is sampled process-tree sum,
including load/warmup, and may count shared pages more than once.

## Decision and limitations

Nemotron is the live candidate on this laptop: early output, sustained streaming
and short finalization make it the strongest measured fit. Its nine selected runs
had zero completed-prefix revisions. Qwen 0.6B is an accuracy research candidate;
its advantage is six literal edits but only **two normalized edits across 919
positions**, too small a dataset for a universal quality claim. Qwen 1.7B accumulated
about 237 seconds of post-audio work on the five-minute case in this CPU configuration.
Moonshine provisional revisions require a suitable stable/provisional delivery
contract before integration into arbitrary fields.

All 21 model/recording groups produced identical final text across their three
repetitions. Timing/scoring audit found zero issues in selected trials. These facts
do not prove correctness on other speakers, accents, languages or noisy microphones.

The separate short private X11/GTK native replay covered capture, worker and field
delivery, with zero observed log sequence gaps/duplicates/reported drops. It recorded
median target probe 2 ms, clipboard 5 ms, and keyboard dispatch 40 ms; Stop-to-idle was
211 ms in one case. Stage timers overlap and must not be added. This fixture does
not qualify real Codex, Brave, Ghostty or native Wayland. App/worker correlation
still needs independent field readback to establish cursor appearance latency.

The sample-preserving Nemotron preroll batching reduced native call count, but no
material first-word improvement was demonstrated. Treat it as reduced overhead,
not an accuracy or perceptual-speed breakthrough. Candidate changes after this
comparison require their own regression receipts.
