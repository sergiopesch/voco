# Evidence behind the release story

## 1. Selecting a live engine, not just the lowest WER

The 14 September seven-configuration comparison tested Nemotron 0.6B, Moonshine Small/Medium, Qwen3-ASR 0.6B/1.7B, Parakeet TDT v3 and Whisper base.en in their pinned local adapters. Three consented recordings lasted 33.184, 93.749 and 303.712 seconds: one speaker, 919 distinct reference-word positions, all used in earlier development rounds. Each configuration/recording pair ran three times. There were 63 selected successful trials from 64 attempts; an initial Whisper WAV-wrapper failure was corrected and rerun. All 21 groups produced identical final text across repetitions. Repeats improve timing evidence but do not create independent speech examples.

On the AMD Ryzen 7 PRO 8840HS, CPU only, Nemotron had 5.33% literal WER, 4.68% contraction-normalized WER, 1.50 s median first callback, 0.94 CPU seconds per audio second and 0.98 GiB maximum sampled process-tree RSS. Qwen 0.6B had 4.68% literal / 4.46% normalized WER, but 2.73 s first output, 2.97 CPU seconds per audio second and 2.86 GiB RSS. Its advantage was six literal edits, or only two contraction-normalized edits, across 919 positions. Nemotron had no completed-prefix revisions in its nine trials. This combination supported Nemotron's selection for live dictation.

The schedule was interleaved but not fully counterbalanced; Moonshine Medium started each long repetition. Runtime thread settings differ, background desktop work was not blocked, and a temperature-start gate did not hold temperature constant. These were warmed models with uncontrolled filesystem caching. CPU totals include replay controller/recognizer work, excluding load/warmup; memory samples include process-tree startup and can double-count shared pages. Neither is a battery measurement. Offline Parakeet and Whisper adapters have no streaming first-output value; unavailable is not zero.

Literal WER ignores case/punctuation; contraction normalization changes that score separately. First callback is measured from audio sample zero, not word end or cursor paint. Streaming progress counts provisional hypothesis words as a fraction of final hypothesis length; it measures neither accuracy nor safe insertion. Qwen 1.7B required roughly 236.6 seconds of post-audio work on the five-minute case in this CPU configuration. Model-family capabilities beyond the tested adapters were not evaluated.

Public technical summary: [frozen model-comparison report](https://github.com/sergiopesch/voco/blob/92501c949968f46a4db163d59f970bae7922c347/docs/testing/model-comparison-2026-09-14.md). Personal recordings, raw transcripts and the original transcript-bearing PDF remain outside this collection.

## 2. A separate public read-speech comparison

Four integrations each transcribed the same 40 public LibriSpeech clips, one per speaker: 998 reference words and 364.36 seconds of audio, 160 completed inferences. NVIDIA and Moonshine received incremental audio; Whisper used a full-utterance decoder. NVIDIA had 13 errors (1.30%), Moonshine Medium 19 (1.90%), Whisper 23 (2.30%), Moonshine Small 27 (2.71%). The six-error difference between NVIDIA and Medium does not establish general superiority: a descriptive paired speaker-bootstrap interval for Medium minus NVIDIA spans −0.11 to +1.41 percentage points.

The corpus was selected deterministically from a retained 240-clip corpus whose NVIDIA/Whisper results were already known. It is not unseen validation. Accuracy inference wall time is not streaming latency. WER excludes punctuation and capitalization. Never pool this corpus with the one-speaker suite or label them as a before/after accuracy gain.

A separate eight-clip paced subset ran twice through each streaming recognizer: 48 trials, 20 ms scheduled chunks. Correct stable first-word medians were NVIDIA 1.096 s, Moonshine Small 1.469 s, Medium 1.525 s. Stability is determined retrospectively. Maximum observed backlog across those trials was 73, 3,509 and 1,881 ms respectively. The original backlog image shows the uninterrupted 20.22-second clip at returned hypotheses, not continuous cursor latency. NVIDIA used its four-thread optimized native pool; Moonshine used pinned SDK defaults. This tests integrations, not equalized model architectures.

Source: retained `model-comparison-2026-09-13/REPORT.md`, exact hash in the manifest. The aggregate accuracy, bootstrap and paced summaries are in the bundled JSON. The original local bundle checked 208 scores against VOCO's independent scorer.

## 3. Measuring where words actually arrive

Three interleaved paired trials compared installed NVIDIA / VOCO .34 with Whisper / .33 in an isolated X11/GTK pipeline, including capture, shortcut, clipboard insertion and field readback. All six delivered the 47-word public passage. First-correct-word medians were 1.597 s and 1.662 s; this small first-word difference is less compelling than continued delivery and Stop. NVIDIA delivered 46, 46 and 47 words earlier in the respective paired trials. Median per-word advantages were 1.262, 1.254 and 1.319 s. Stop-to-idle medians were 165 ms (161–165) and 2,859 ms (2,579–3,066).

Two additional Moonshine prototype feasibility trials failed with incomplete passages and retained recovery. Neither is counted as successful Stop-to-idle. Their exact failure causes were not established, and the prototypes were less developed. The graph therefore compares the two completed integrations, with both failures explicitly retained in the bundled numeric data. No text reached the secondary field in any of the eight trials.

The chart's clock starts at playback launch, and observations read field text. These are neither physical acoustic onset nor pixel paint. Versions .33/.34 are historical, not fresh tests of .43. Separate integrations can differ in more than model weights. The small ranges are not population percentiles or confidence intervals.

## 4. TypeSafe helps evaluate meaning; it does not replace timing

On 19 September, context 1 and experimental context 0 used the same .41 candidate runtime/model. A–B–B–A paced worker replay covered 12 public speakers, twice per setting: 24 trials / 476 reference-word observations per setting, from 238 unique words. Context 0 reduced total WER from 2.521% to 2.101% by fixing one development substitution per replay. Held-out WER stayed 2.564%. Median first hypothesis moved from 1,175.1 to 1,167.6 ms; median worker service/audio ratio rose from 0.257 to 0.384 (~49%). In a separate four-trial isolated GTK/X11 experiment, context 0 put first text into the field later. The decision was to retain context 1.

TypeSafe Jev 1.13.0 performed 40 case evaluations: 16 synthetic judge challenges and one judgment for each of 12 speaker transcripts under two settings. Meaning scores normalize a 0–3 rubric to 0–100; they are not percentages of correct words or overall app grades. Development meaning was 95.79 vs 97.29; held-out meaning 86.50 vs 86.17 across only four speakers. Both settings had one held-out material-error review flag. Judge repeatability was not estimated, and this held-out set was a historical regression corpus, not new independent speech. Only public/synthetic text was sent, with no audio or personal transcript.

The initial client rejected eight responses due to an overly strict rounding check; retained responses were revalidated after a bounded correction, without additional API calls. That was a client fix, not improved judging. A later six-thread experiment showed compute headroom but was also not promoted. Neither experiment is a shipped before/after speedup. Audited punctuation references and word-end alignment remain missing.

Full public reports: [results](https://github.com/sergiopesch/voco/blob/92501c949968f46a4db163d59f970bae7922c347/docs/testing/typesafe-results-2026-09-19.md) and [protocol](https://github.com/sergiopesch/voco/blob/92501c949968f46a4db163d59f970bae7922c347/docs/testing/typesafe-evaluation.md).

## 5. Release qualification is a separate step

The refreshed .43 executable SHA-256 is `c04a65c215387aa021cdb8a174a1e5c18834cf62cc3b47ce68f424dca8840301`. Seven native package lifecycles passed install, reinstall, removal, payload verification and preservation of a package-independent user-state marker. Ubuntu 24.04 upgraded from public .42; Ubuntu 26.04, Debian 13 and Mint 22.3 container checks used a preserved .37 baseline. Fedora, openSUSE and Omarchy used native managers. These package checks preceded publisher signing; they do not themselves certify publisher trust.

Four refreshed desktop scenarios passed from six attempts: Fedora GNOME Wayland / GTK, openSUSE KDE Wayland / Firefox, Omarchy Hyprland / GTK and Ubuntu GNOME X11 / GTK. Two Fedora attempts failed before recording because the overview prevented recipient focus. An Omarchy package attempt failed after reboot because its disposable test keyring was empty; the full lifecycle was repeated after restoring the key. These failures are retained. The Omarchy guest used packaged Hyprland/Quickshell with a supplied kernel, not an ISO/bootloader installation test.

The previous f634 executable had broader long-recording/recovery/focus testing. Those timings are not relabeled as c04 results. The refreshed binary changed one Updates help sentence; recognition/runtime/model/integration payloads remained identical. Public virtual speech, VM observations and container package checks do not qualify physical microphones, suspend/resume, arbitrary recipients, every CPU architecture or universal Linux support. No new TypeSafe scores or punctuation-accuracy results were produced for .43.

Public sources: [refreshed release verification](https://github.com/sergiopesch/voco/blob/92501c949968f46a4db163d59f970bae7922c347/docs/testing/linux-release-2026-09-20.md), [support matrix](https://github.com/sergiopesch/voco/blob/92501c949968f46a4db163d59f970bae7922c347/docs/linux-support.md), and [release downloads](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.43).
