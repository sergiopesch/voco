# Speech engine benchmark, October 2026

**Question.** Should VOCO replace its engine, NVIDIA Nemotron Speech Streaming
English 0.6B at a 160 ms step, with Parakeet TDT 0.6B v3, Whisper large-v3-turbo
or Nemotron 3.5 Streaming 0.6B, or change Nemotron's latency setting?

**Answer.** No change of engine. Nemotron English at 160 ms types words while you
speak, typically 0.32 s after each word, in a quarter of real time on four
threads, without revising text. None of the other engines does all three on this
CPU:

- Parakeet is clearly more accurate, mostly in punctuation and accented speech,
  but live it shows words about 3 s late.
- Whisper can't keep up on a CPU.
- Nemotron 3.5 is less accurate in English.

Longer Nemotron steps don't measurably improve accuracy on this speech. A 560 ms
step trades 0.18 s more delay for 36% less processing time and better
punctuation.

The harness that produced these numbers is in [harness/](harness/), and every
run's per-utterance results are in [results/](results/). Neither `npm test` nor
CI runs it. This record describes the measurements of 9 October 2026; VOCO's
documentation describes how it works now.

## Setup

- **Machine:** a cloud server (Hetzner CCX33) with 8 dedicated AMD EPYC-Milan
  vCPUs with AVX2, FMA and F16C (no AVX-512), and 30 GB of memory. Every engine
  ran with 4 threads, VOCO's maximum.
- **Runtime:** NeMo-Speech.cpp `a5b6953` with VOCO's two patches, built by VOCO's
  own `runtime/native/build.py` at VOCO `754b4c7`. The test-only
  [`bench_bridge.cpp`](harness/bench_bridge.cpp) adds an explicit right context, a
  language prompt, and offline recognition with word times. whisper.cpp v1.9.5
  (`d1be6fd`) was built for AVX2 the same way, with
  [`ws_shim.c`](harness/ws_shim.c).
- **Models,** all Q8_0 and pinned by SHA-256:

  | Model | File size | Weights licence |
  | --- | --- | --- |
  | Nemotron Speech Streaming English 0.6B, HF `ebe59e5` (VOCO's model) | 700 MB | NVIDIA Open Model License |
  | Nemotron 3.5 ASR Streaming 0.6B, HF `1c8deae`, language `en-US` | 742 MB | OpenMDW-1.1 |
  | Parakeet TDT 0.6B v3, HF `541d1f9` | 714 MB | CC BY 4.0 |
  | Whisper large-v3-turbo, whisper.cpp HF `5359861` | 874 MB | MIT |

- **Audio:** 311 public utterances, 42.2 minutes and 6,381 reference words. The
  subsets were fixed before any inference:

  | Set | Utterances | Minutes | Speakers |
  | --- | --- | --- | --- |
  | LibriSpeech-PC test-clean, every 24th | 101 | 11.9 | 39 |
  | LibriSpeech-PC test-other, every 36th | 80 | 8.5 | 33 |
  | FLEURS en_us test, every 5th sentence | 70 | 11.8 | – |
  | VoxPopuli en test, first 3–20 s utterance of the first 60 speakers (mostly non-native) | 60 | 10.0 | 60 |

- **Feeding:** 100 ms packets, as VOCO's worker receives them. Each call's
  processing time was measured, then replayed on a real-time clock: packet k
  arrives at (k+1)×100 ms, and a call starts once its packet has arrived and the
  previous call has finished. A real-time paced run of the baseline (63
  utterances, 1,526 text updates) matched the replay within 2 ms. Calls ran
  about 25% longer when paced (processing time per audio second 0.31 against
  0.25), which adds roughly 0.01 s to word delays.
- **Pasteable text,** per engine:
  - Nemotron: its running hypothesis, exactly what VOCO pastes.
  - Parakeet live: offline decodes over 10 s / 2 s / 2 s windows, NVIDIA's
    recommended buffered setting, committing only the words that start inside
    the chunk.
  - Whisper live: LocalAgreement-2 (ufal/whisper_streaming) at 1 s steps.
- **Metrics:**
  - **WER:** corpus word error rate after NFKC and whisper-normalizer 0.1.12's
    English normaliser.
  - **PER:** NeMo-style punctuation error rate over `. , ?`, against the
    punctuated references. These references are restored or edited text, not
    verbatim.
  - **Cap:** capitalisation errors among matched words.
  - **Word delay:** when a word first shows in its final spelling, minus the end
    of that word in the Parakeet offline alignment. It ends when the engine has
    the word, so it leaves out the time VOCO takes to paste it.
  - **Stop → final:** from the end of the audio to the final text.
  - **Processing per audio second:** the wall time of the engine's calls divided
    by the audio's length (`computePerAudio` in `summary.json`, the `CPU/audio`
    column of `summary.txt`). With 4 threads it isn't CPU time.
  - **Revised:** utterances where earlier text changed. VOCO stops dictation
    when that happens.

## Results

| Engine and setting | WER % | LS clean / other / FLEURS / VoxPopuli | PER % | Cap % | Word delay p50 / p90 s | Stop → final p50 s | Processing per audio s | Revised |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Nemotron EN 160 ms (VOCO today)** | **6.10** | 2.35 / 4.86 / 8.74 / 9.38 | 46.1 | 2.6 | **0.32 / 0.62** | **0.11** | 0.25 | 0 |
| Nemotron EN 80 ms | 6.16 | 2.40 / 5.29 / 8.74 / 9.18 | 53.6 | 2.7 | 0.32 / 0.63 | 0.12 | 0.39 | 0 |
| Nemotron EN 560 ms | 6.03 | 2.40 / 5.15 / 7.84 / 9.71 | 41.2 | 2.6 | 0.50 / 0.90 | 0.15 | 0.16 | 0 |
| Nemotron EN 1.12 s | 5.88 | 2.35 / 4.35 / 7.97 / 9.71 | 41.7 | 2.7 | 0.81 / 1.35 | 0.25 | 0.14 | 0 |
| Nemotron 3.5 160 ms | 7.77 | 3.17 / 7.90 / 10.10 / 11.24 | 44.5 | 2.2 | 0.38 / 0.62 | 0.11 | 0.25 | 0 |
| Nemotron 3.5 320 ms | 7.76 | 3.38 / 7.32 / 10.23 / 11.31 | 40.9 | 2.2 | 0.43 / 0.70 | 0.14 | 0.18 | 0 |
| Nemotron 3.5 560 ms | 7.43 | 2.81 / 7.25 / 9.97 / 10.98 | 41.1 | 2.3 | 0.54 / 0.88 | 0.15 | 0.15 | 0 |
| Parakeet TDT v3 live, 10/2/2 s windows | 5.19 | 2.81 / 4.35 / 7.32 / 6.85 | 29.0 | 1.8 | 3.15 / 4.28 | 0.81 | 0.34 | 0 |
| Parakeet TDT v3 offline, at Stop | 4.17 | 1.43 / 2.83 / 6.99 / 6.05 | 27.7 | 1.8 | text only after Stop | 0.79 | 0.11 | 0 |
| Whisper turbo offline, at Stop | 5.44 | 1.99 / 3.70 / 6.48 / 10.45 | 48.9 | 3.8 | text only after Stop | 11.25 | 1.39 | 0 |
| Whisper turbo live, LocalAgreement-2 (9-utterance sample) | 16.59 | – | 40.5 | 4.4 | 65.9 / 144.1 | 92.8 | 10.87 | 0 |

The step settings appear in the result files as right contexts: `r0` is 80 ms,
`r1` 160 ms, `r6` 560 ms and `r13` 1.12 s for Nemotron English, and `r1`, `r3` and
`r6` are 160, 320 and 560 ms for Nemotron 3.5.

Peak memory was about 970 MB for each NeMo-Speech.cpp engine and 1,080 MB for
Whisper. Warm-up (the first utterance, as VOCO warms its worker) took 3.2 s for
Nemotron, 4.6 s for Parakeet live and 11.4 s for Whisper.

**Paired bootstrap** of the WER difference against VOCO today (2,000 resamples of
utterances, [`analyze.py`](harness/analyze.py)):

| Engine | Difference (points) | 95% interval |
| --- | --- | --- |
| Nemotron EN 80 ms | +0.06 | −0.28 to +0.37 |
| Nemotron EN 560 ms | −0.06 | −0.38 to +0.21 |
| Nemotron EN 1.12 s | −0.22 | −0.57 to +0.13 |
| Nemotron 3.5 160 / 320 / 560 ms | +1.68 / +1.66 / +1.33 | each excludes 0 |
| Parakeet live | −0.91 | −1.56 to −0.23 |
| Parakeet offline | −1.93 | −2.49 to −1.37 |
| Whisper offline | −0.66 | −1.60 to +0.66 |

## Findings

1. **Nemotron English at 160 ms suits live dictation.**
   - Words show 0.32 s after they're spoken (p90 0.62 s), and the final text
     0.11 s after Stop.
   - It used a quarter of real time on 4 threads, and its backlog never passed
     0.1 s.
   - Its weak spots are punctuation (PER 46%) and accented speech (VoxPopuli
     9.4%).
2. **The latency setting changes delay and processing, not accuracy.** Nemotron's
   longer steps don't move WER measurably on this speech. NVIDIA's larger
   published gains come mostly from meeting audio (AMI). Even so:
   - 80 ms is worse on every count here: no faster for the user, worse
     punctuation, more processing.
   - 560 ms is the one real alternative: PER drops from 46% to 41%, and
     processing from 0.25 to 0.16 per audio second, for 0.18 s more word delay.
3. **Parakeet TDT v3 is more accurate but not live.**
   - It wins on WER, punctuation and accented speech (VoxPopuli 6.9% live
     against 9.4%).
   - VOCO's runtime runs it offline only, though. The buffered emulation shows
     words about 3 s late (p90 4.3 s) and loses about 1 point to seams.
   - A stateful buffered runner in NeMo-Speech.cpp would remove the seams, but
     the latency floor stays at the chunk plus the right context: seconds, not
     tenths.
4. **Nemotron 3.5 is worse in English,** by 1.3–1.7 points in every setting. Its
   case is multilingual dictation, which VOCO doesn't offer.
5. **Whisper turbo doesn't fit a CPU dictation app.** Each decode pads to 30 s
   and took about 11 s on 4 threads, so live use fell minutes behind. Even one
   decode at Stop means an 11 s wait. Its offline WER isn't distinguishable from
   Nemotron's, and its punctuation is the weakest here.

## Limits

- One server CPU, not a laptop. There was no real microphone, room noise or
  laptop-microphone audio.
- Read and broadcast speech only; no conversational or meeting speech. English
  only.
- 311 utterances give intervals of about ±0.3–0.6 points; smaller differences
  are noise.
- Parakeet live approximates NVIDIA's buffered streaming without carrying
  decoder state between windows, so a stateful runner could score somewhat
  better.
- Whisper was tried on CPU only, with whisper.cpp's default 30 s window.
  Reducing `audio_ctx` is untested.
- The punctuation references are restored or edited text.
- Word delay leaves out VOCO's paste, and the live Whisper row is a 9-utterance
  sample.

## Files

| File | Contents |
| --- | --- |
| `results/summary.json`, `results/summary.txt` | Every configuration's scores, as `score.py` wrote them |
| `results/runs/<config>.jsonl.xz` | One JSON record per utterance: each step's processing time and text, and the final text. `nemo-en-r1-paced` is the real-time paced check. Decompress with `xz -d` |
| `results/corpus-manifest.jsonl` | The 311 utterances: set, speaker, duration and the plain and punctuated references |
| `results/python-packages.txt` | The scoring environment's Python packages |
| `results/run-all.log` | When each configuration started and finished, and its exit status |

## Reproduce

You need an Ubuntu 24.04 x86-64 machine with AVX2, FMA and F16C, and root.
Everything lands in `/opt/bench`, and every download is pinned by SHA-256. The
harness clones VOCO at `754b4c7` and builds the runtime with VOCO's own recipe
at that commit.

```bash
sudo install -d /opt/bench/tools
sudo cp research/engine-benchmark-2026-10/harness/* /opt/bench/tools/
cd /opt/bench
sudo tools/setup-box.sh tools && sudo tools/setup-box.sh models && sudo tools/setup-box.sh data
sudo tools/run-all.sh   # every configuration, one at a time, then score.py
venv/bin/python tools/score.py --paced-check results/nemo-en-r1-paced.jsonl
venv/bin/python tools/analyze.py --corpus corpus results/nemo-en-r1.jsonl results/*.jsonl
```

The full plan took just under 3 hours on the machine above. Run nothing else on
it while it measures. `run-all.sh` scores only the configurations it ran, first
runs `parakeet-offline` when its word times are missing, and exits 1 if a
configuration failed or left no complete record, which then stays out of the
summary. Those safeguards were added after publication review; in this run
every configuration exited 0 and left a complete record.

## Data and licences

The audio isn't included; `setup-box.sh data` downloads it. The results and the
manifest contain the reference transcripts and each engine's transcripts of
this audio:

- [LibriSpeech](https://www.openslr.org/12/) by Vassil Panayotov, Guoguo Chen,
  Daniel Povey and Sanjeev Khudanpur, CC BY 4.0, with the punctuated and
  capitalised references of [LibriSpeech-PC](https://www.openslr.org/145/),
  CC BY 4.0.
- [FLEURS](https://huggingface.co/datasets/google/fleurs) by Google, CC BY 4.0.
- [VoxPopuli](https://huggingface.co/datasets/facebook/voxpopuli) by Meta, CC0.

The subsets above were selected from them, and their references normalised for
scoring. The harness is part of VOCO and shares its MIT licence; the engines and
models keep their own.
