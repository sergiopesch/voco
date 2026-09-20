# VOCO — all tested models, one metric at a time

**15 white-background figures, each supplied as a 7680 × 4320 PNG and a scalable SVG.** Open [the gallery](index.html), the [PDF](VOCO-all-models-benchmark.pdf), or [the overview PNG](png/00-overview.png). SVG has no fixed resolution ceiling; use it for large-format output. PNGs are 16:9, rendered at 480 DPI on a 16 × 9 inch canvas. Small previews are provided for browsing, not print.

The graphics visualize retained September 2026 measurements. They are not new benchmark runs or a new release qualification. The same model order is used throughout. Green identifies the selected VOCO default, **not the winner of every metric**. Each chart contains all seven tested configurations; missing measurements and unsuccessful integration trials remain visible. No overall score has been invented.

## Image index and aggregation

| Image | Metric | Calculation / scope |
| --- | --- | --- |
| [00](png/00-overview.png) | Comparison overview | Selected metrics from the matched seven-configuration study |
| [01](png/01-word-error-rate.png) | Literal word error rate | Pooled edits / reference-word observations × 100; nine trials per model |
| [02](png/02-normalized-word-error-rate.png) | Contraction-normalized WER | Same aggregation with contractions expanded |
| [03](png/03-first-output.png) | First recognizer output | Median of nine trials; from sample zero, not cursor display |
| [04](png/04-cpu-work.png) | CPU seconds / audio second | Median of nine per-trial CPU ratios; includes controller work |
| [05](png/05-memory.png) | Peak sampled process-tree RSS | Maximum across nine trials; MiB / 1024 = GiB |
| [06](png/06-completion-tail.png) | Completion after audio ends | Median of three trials on the 303.712-second recording; logarithmic seconds axis |
| [07](png/07-progress-at-audio-end.png) | Hypothesis word-count progress | Median percentage of final hypothesis word count at audio end; long recording |
| [08](png/08-prefix-revisions.png) | Completed-prefix revisions | Median count over three long-recording trials; excludes partial-word extensions |
| [09](png/09-update-gap.png) | Longest observed text-update gap | Maximum over three long-recording trials; can include legitimate silence |
| [10](png/10-model-load.png) | Model load | Median of nine adapter-reported measurements; OS cache uncontrolled |
| [11](png/11-warmup.png) | Warmup | Median of nine measurements; same separate 2.09-second public clip |
| [12](png/12-offline-decode.png) | Full-recording offline decode | Median of three long-recording trials, offline adapters only |
| [13](png/13-earlier-public-speech.png) | Earlier public-speech WER | Separate 40-speaker, 998-word corpus; four tested integrations |
| [14](png/14-earlier-app-stop.png) | Earlier app Stop-to-idle | Separate .34/NVIDIA vs .33/Whisper X11/GTK test; three completions each |

Values are rounded for display. [The CSV](data/metric-values.csv) and [metric definitions](data/metrics.json) preserve the recorded numeric precision, units, missingness and aggregation. Chart 06 labels sub-second values in milliseconds while plotting all points on a logarithmic seconds axis; equal axis steps are tenfold changes. Other metric axes are linear and start at zero. No missing value is plotted as zero.

## Why the main comparison is valid — and where it stops

Charts 00–12 use the final matched comparison, completed 14 September 2026. Seven pinned model/runtime configurations received the same three consented recordings: 33.184, 93.749 and 303.712 seconds, one speaker, 919 distinct written-reference word positions. Each configuration/recording pair was repeated three times, giving 63 selected successful trials from 64 attempts. A Whisper WAV-wrapper failure was corrected and rerun; the unsuccessful original is retained outside this media collection. These recordings had been used in previous development rounds. Repetition does not create additional independent speakers or unseen evaluation data.

All processing was CPU-only on an AMD Ryzen 7 PRO 8840HS. No NVIDIA GPU was used. Models were warmed before replay. The schedule was interleaved but not fully counterbalanced; runtime thread configurations differ, background desktop activity was not blocked, and a start-temperature gate did not hold temperature constant. The bundled configuration list identifies the tested adapters and settings; it is not an inventory of selectable VOCO products.

Nemotron balanced early output, CPU work, memory and competitive accuracy. Qwen 0.6B had fewer errors: six literal edits, or only two contraction-normalized edits, across the 919 distinct positions. The visual set preserves this result. The study does not establish universal model superiority.

## Preserve these distinctions when sharing

- **Offline versus streaming:** Parakeet TDT v3 and Whisper base.en were offline controls in the main study. Streaming first output, completion tails, progress, update gaps and revisions are unavailable for those adapters. Their offline decode durations are shown separately. This says nothing about every possible integration of those model families.
- **Historical cohorts:** the earlier public-speech and application charts keep separate denominators and implementation versions. No earlier values are substituted into the final seven-model study. Qwen and Parakeet are marked untested in those earlier cohorts. Moonshine app prototype failures are marked incomplete, not as successful completion times.
- **Accuracy versus progress:** WER ignores capitalization and punctuation; contraction normalization is a separate sensitivity score. Hypothesis word count and prefix revisions are not accuracy measures. No all-model punctuation or TypeSafe semantic benchmark exists in this evidence, so no corresponding scores are manufactured.
- **Runtime versus user experience:** recognizer callbacks, worker completion, app Stop-to-idle and visible cursor paint are distinct. Physical microphone, acoustic word-end and pixel-paint timing were not measured here. Model load is not full application startup.
- **Resources:** total CPU work is not energy or battery use. Process-tree RSS is sampled, can miss transient peaks and can count shared pages twice. Adapter load/warmup boundaries are not identical implementations.
- **Uncertainty:** the small corpus and descriptive statistics are engineering evidence, not population percentiles. The public NVIDIA–Moonshine Medium accuracy difference is not conclusive. No statistical significance is implied by color, order or decimal precision.

Personal recordings, transcripts and screenshots are excluded. Aggregate numbers and sanitized trial measurements are included. Keep the visible scope and footnotes with an image when publishing; cropping them away can change its meaning.

## Audit and reproducibility

The preparation audit compared **1,008 numeric fields** in the 63 selected trial rows against the retained per-trial JSON files, including the offline `decode_wall_s` field and explicit streaming-only applicability. Main summary values were recalculated and compared with the frozen aggregate report. Original file hashes are recorded in [source-hashes.json](data/source-hashes.json). Paths identify local retained evidence, not public download locations.

The [renderer](tools/render.py) consumes only the included numeric data. It requires Python 3, NumPy and Matplotlib (rendered with Matplotlib 3.11.2); it makes no network calls. [VERIFICATION.json](VERIFICATION.json) records numeric, image-dimension, privacy, link and export checks. [SHA256SUMS](SHA256SUMS) covers this collection except itself and its ZIP.

Captions and accessible descriptions are in [image-captions.json](data/image-captions.json). Full background and public source links are in the included [background methodology](BACKGROUND.md). Model names identify tested configurations and do not imply vendor endorsement.
