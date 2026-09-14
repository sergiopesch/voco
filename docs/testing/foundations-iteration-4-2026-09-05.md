# Foundations iteration 4 — 2026-09-05

**Speech qualification remains a strict failure: 108 of 114 unique canonical cases pass and six fail.** The repeated-speech recovery fixes improve the measured cases without upgrading the model. They do not establish universally accurate dictation, complete Linux desktop coverage, or a “world best” application.

This report identifies the final packaged source and separates speech evidence from the platform/browser results below, including the remaining platform gaps. Evidence is retained outside the checkout under `../foundations-evidence/iteration-4/` (paths in the tables below are relative to that evidence root). The earlier `production-evaluation/` run is superseded and is not final acceptance evidence.

## Final artifact and source identity

| Artifact | SHA-256 |
|---|---|
| Release replay worker | `8867eb0f6d4e30d5f3cb968ffb5a5f89583228a6ca29050c1bed83202b09035e` |
| Latest packaged application | `52f78c8f17a2a15ba31653750af2b967cbaa7694f3ee150c295a538fbe68b7ca` |
| Packaged browser host | `e225cd4f8c9c49e99dde4fa7ebdb0826fd1bc956543f13bc5d6136b9e6cdfbab` |
| `transcribe.rs` snapshot | `2742672cd3030e40d424aad28a5fb2958339669e078e1d1d46520ae1b5291da4` |
| Latest Debian package | `4bdea6ab523f385f6ff5d9ca4ca45e668c3d34792dda2bf9fce501bad6602a75` |
| Unchanged `ggml-base.en.bin` | `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002` |

`package-acceptance-wayland/manifest.json` records the release profile, `custom-protocol` feature, executable/package verification, source inventory and Cargo lock hashes. The package was not installed by these checks. The recorded checkout HEAD is `6ab2b2c37f1fc9bdf0ad7b1a0ecbbfea65cd16ee` with intentional uncommitted changes; HEAD alone does not identify the tested source.

The latest package rebuild contains the Wayland interactive-window repair. Its replay worker rebuilt **byte-identically** to the worker used by `production-evaluation-final/`; the transcription source, browser host and speech model also retain their recorded hashes. The 114-case speech results therefore carry forward by exact worker identity, not a new inference run. They remain **108 passing cases and six strict failures**. The qualification set was not rerun.

The earlier `package-acceptance-final/manifest.json` remains a distinct artifact: application SHA `de67d3e3838f3f4c5a687bb0ec76e2da19e9d2f5506be01d7c09132870adaf65`, Debian SHA `e44dee0b808709ace97bced1e1d3c563f2729794e9df135a0d9b2d056fdb6ef7`. The four `platform/final-browser-*` invocations identify that earlier GUI. The final `platform/remap-browser-*` and native acceptance below were run separately against the rebuilt GUI; earlier proof is retained under its original identity.

The clipping cause was reproduced with a native GTK Wayland surface: resizing a tiny still-mapped window could retain the compositor's previous small allocation. The reviewed repair deliberately hides an idle interactive window before resizing, positioning, showing and requesting focus. It uses the actual lowercase runtime session label, preserves request cancellation, restores visibility after a current request's failed transition, and limits blur suppression to the deliberate remap until actual focus is observed. Subsequent real blur remains dismissible. Recording/processing guards refuse Open and Settings, so the supported capture journey tests a prior idle remap and refusal of Open during recording; it does not force an unsupported active-recording remap.

The frontend suite records **227 passing tests and two skipped tests** in `package-acceptance-wayland/npm-test-final.log`, including transition ordering, superseded requests, failure recovery and focus-guard behavior. Source and targeted checks are retained in `platform/wayland-remap-fix/`. These tests establish controller behavior; the separate rebuilt-package native acceptance below also passes geometry, blur dismissal, visible Copy and synthetic capture continuity. [The surface acceptance protocol](wayland-surface-acceptance.md) fixes its synthetic waveform checks and distinguishes pre-Copy screenshots from post-action observations.

The existing whisper-rs 0.14.4 / whisper-rs-sys 0.13.1 / whisper.cpp 1.7.4 stack is pinned to reviewed local sources. No stronger speech model, new VAD or lexical correction was added. [Vendor provenance](../../vendor/README.md), pristine archives, individual patches and the aggregate patch remain in `vendor/provenance/`. The 485-file owned-source inventory SHA is `589c23293395bffd5e2e9ccbefc8d4e48b5ef0299b047121eb6a545cc467509a`; final Cargo lock SHA is `27c2a0929b566eb47041046e13c49f92df8b0a4923ab4344ef324cd62340ec55`. Source identity verification is not recognition acceptance.

The speech-source release build's recorded checks pass: 222 Rust library tests, 18 browser-host tests, 18 fixture tests, Clippy, application formatting and Debian verification. These checks complement, rather than replace, the failing speech gates below.

## Recognition behavior and privacy boundary

The ordinary decoding path retains its original audio and decoder parameters. Selected low-confidence rejection or final selected-decoder failure can admit one bounded pause-based recovery pass. Adjacent existing pause ranges are coalesced up to eight seconds; only eligible decoder-failure retry windows use audio context 512. No new acoustic cuts, recursive retries or transcript selection by output length are introduced. Tail-only and bracketed mixed-level recovery retain their separately verified conditions. Original capture audio remains available to the caller.

A retry that still reports terminal failure or low-confidence rejection returns an error before its text is published as successful recovery. Native API errors also propagate. Completed-window diagnostics remain available, and the next request clears earlier decisions. All 16 initially flagged decisions in the final 114 cases had eligible recovery and were retried. An initial native failure without eligible recovery ranges still returns the original result; that unmeasured policy boundary was not changed and is not covered by the failed-retry guarantee.

The first packaged candidate retained recognized strings in `DecodeDecision.retryPreviewSegments`, which could outlive user Clear/Discard. It was superseded before the untouched qualification set ran. The final source stores `retrySegmentBoundsMs` as numeric pairs only; strings belong to the returned transcript/live-preview payload, not retained diagnostics. The final audit checks 153 serialized diagnostic objects and permits only fixed reason labels plus numeric, boolean or null metadata. It passes with no transcript strings. Timing bounds establish observed segment coverage, not which words were spoken.

## Frozen canonical suites

The three worst original timing cases improve as follows on their exact fixed PCM:

| Case | Original word errors / 52 | Final word errors / 52 |
|---|---:|---:|
| 500 ms leading silence | 52 | 1 |
| 250 ms onset crop | 52 | 0 |
| 500 ms onset crop | 47 | 0 |

The first result ends with “Go. Do you?” and retains one deletion against the
unchanged full reference. These fixed 30-second windows can truncate boundary
speech; scores still count every reference word. Recovery of the large omission
does not make that remaining error disappear. The separate complete-utterance
boundary suite avoids that truncation and passes all 12 cases.

All plans preserve their selected PCM, references and thresholds. Each speech case requires nonempty lexical output. Every speech family independently requires aggregate WER ≤ 0.25; a passing family cannot waive an individual case failure. Pure non-speech controls require zero lexical words. The final production run executes independent suites even after a preceding failure.

| Suite | Individual gate | Passing cases | Strict result | Final evidence |
|---|---|---:|---|---|
| Development 58 | Phase/pause WER ≤ 0.25; natural/quiet/unseen ≤ 0.5; non-speech zero words | 58/58 | PASS | `production-evaluation-final/development58/report.json` |
| Boundary 12 | WER ≤ 0.5 | 12/12 | PASS | `production-evaluation-final/boundary12/report.json` |
| Mixed-volume 6 | WER ≤ 0.25 | 6/6 | PASS | `production-evaluation-final/mixed6/report.json` |
| Repetition generalization 12 | WER ≤ 0.25 | 8/12 | **FAIL** | `production-evaluation-final/generalization12/report.json` |
| Matched-noise negative 6 | WER ≤ 0.25; observed zero errors on all six | 6/6 | PASS | `production-evaluation-final/negative6/report.json` |
| Untouched qualification 20 | WER ≤ 0.5 | 18/20 | **FAIL** | `production-evaluation-final/qualification20/report.json` |

These are **114 unique canonical cases: 108 pass, six fail**. The first 94 canonical outputs are byte-identical in `chunkText`, `canonicalText` and `appendText` to their accepted evidence candidates. No measured word-error count worsens against either those candidates or the measured original baselines. This comparison does not include the previously untouched 20 cases.

The final qualification plan was frozen before candidate inference and ran exactly once, after development 58 and boundary 12 passed and source hashes were rechecked. Its SHA remains `311bf10c1fd7ab499d1e699ca46f0ec71b0cd3f5d82835ab17bdedd3a36705f7`. No source, reference, model or threshold was tuned against its results; no qualification rerun occurred.

### Six strict failures

- Speaker 777 repetition offsets 0/175/500/750 each have 17 errors across 45 reference words: 16 substitutions, zero deletions and one insertion, WER 0.37778. The reference repeats `ALL IDEALISATION MAKES LIFE POORER` nine times. All four remain above the fixed 0.25 limit.
- `qualification-natural-2078-142845-0000` and its 40 dB-noise counterpart reference `KIRKLEATHAM YEAST` and return `Kirkley Thim Yeast.` Each has one substitution, zero deletions and one insertion: WER 1.0 against the fixed 0.5 limit. Initial low-confidence and terminal-failure flags are false, the near-end offset is absent, and neither case retries. No original-baseline replay of these cases was performed; their pre-existing status is unverified.

Qualification family averages pass (natural 0.07538, noisy 0.08040, pauses 0.04310), as does the repetition family average (0.11602). The six individual failures still fail their suites. `production-evaluation-final/FINAL-SPEECH-REPORT.json` preserves every failed raw reference, hypothesis, S/D/I count and native decision.

## Preview, multi-mode baseline and continuity

- Preview 37 passes. Exactly the four prospectively allowed objects change: faint noise loses a hallucinated word, and three already-correct tail previews receive bounded, monotonic rebased timestamps. The other 33 complete preview objects remain baseline-identical. Evidence: `production-evaluation-final/preview37/report.json`.
- The eight-fixture full/canonical/preview baseline passes its unchanged per-fixture WER ≤ 0.5 and aggregate WER ≤ 0.25 gates; aggregate full-mode WER is 0.025. Preview is exercised only within its supported duration range. Evidence: `production-evaluation-final/baseline8.json`.
- Continuity 72 passes its unchanged WER ≤ 0.15 gate at 4/72 = 0.05556, with canonical prefixes preserved. This is not exact repetition-count recovery: the final transcript has 76 words, including four insertions. Evidence: `production-evaluation-final/continuity72.json`.

Retained iteration 3 continuity evidence uses the same derived WAV SHA, model, recipe and sample windows. The second window's `chunkText` **and** `appendText` are byte-identical historically and now: a three-word phrase tail plus six full four-word phrases. The physical second window contains only the tail of repetition 13 plus five complete repetitions (14–18). The extra second-window phrase is therefore directly evidenced as pre-existing, rather than inferred from unchanged code.

The first window changes from 44 words / 11 phrases to 52 words / 13 phrases. The unchanged six-phrase second append yields 17 total phrases historically and 19 now, versus 18 in the recording. Earlier first-window omissions masked the extra second-window phrase, changing the aggregate error classification from four net deletions to four net insertions. The final insertions remain errors; this explanation is not a metric waiver. Raw comparisons and sample geometry are in `production-evaluation-final/continuity-history-diagnosis/comparison.json`.

## Rejected approaches retained in evidence

- Unconditional 15-second splitting and global pause partitioning caused new natural-speech errors or invented words. They were not adopted globally.
- Upstream max-token variants did not preserve quiet/held-out speech; variants produced truncation or repeated `No` output.
- Global zero-edge trimming lost held-out speech despite retaining all nonzero samples. Completion-margin and padding experiments did not provide a safe general repair.
- One-second padding inside selected retries worsened six of 12 fixed cases and improved none.
- Retry beam search introduced nine errors in a previously correct phase case. Default retry encoder context caused new deletions in two speaker 777 cases. Neither replaced the accepted context-512 recovery policy.
- Original unconditional pause isolation improved quiet long passages but changed `lover` to `Luffer` in previously correct controls. Its causal evidence informed a narrower separately tested mixed-level path, not global splitting.

Rejected outputs, source snapshots, worker/model hashes and fixed plans remain under `evaluation/`, `decoder/` and `platform/`. Failed cases were not removed and thresholds were not loosened.

## Measurement and desktop limits

The recorded speech environment is Linux x64, kernel `6.17.0-1032-oem`, 16 logical CPUs, Node `v24.20.0` and Rust `1.94.0`. Runs were serialized to avoid competing speech decoders. Unrelated host activity and lightweight startup checks still preclude isolated hardware benchmark claims. The original three problematic 30-second cases took 6.475/6.441/6.578 seconds in the final release worker; these timings exclude microphone capture, native IPC and destination delivery.

The corpus and deterministic transformations are bounded regression probes, not representative coverage of every accent, language, proper name, microphone, noise source or Linux machine. Direct worker recognition cannot establish desktop insertion safety or browser exact-field ownership. Native diagnostics do not prove lexical completeness. No installed application, private microphone recording or live host input session is qualified by these speech results.

### Packaged platform and browser acceptance

The following results use the rebuilt GUI `52f78c8…` and the exact packaged host and extension. They are private namespace checks, with synthetic audio where capture is requested. They do not qualify installed GNOME/KDE or physical microphones.

| Acceptance track | Result | Evidence under the iteration 4 root |
|---|---|---|
| X11 manual Copy: final-only, streaming and focus switch | PASS, three actual capture/Copy cases; zero target mutations | `platform/remap-x11-{copy,streaming-copy,focus-copy}/` |
| Headless and nested Wayland startup | PASS, two Open/Quit cycles per backend, GTK 3/4 mapping and verified model cache | `platform/remap-{headless,nested}-startup/` |
| Original nested Wayland capture/Copy | PASS without dismissing the foreground target; Copy enabled and showing, exact clipboard phrase, zero target mutations | `platform/remap-wayland-capture/` |
| Extended nested Wayland surfaces and capture | PASS, both Copy controls visibly painted before action; fresh clipboard replacement, waveform continuity and real blur/reopen | `platform/remap-wayland-painted-journey/` |
| Chromium short final-only and streaming | PASS, direct delivery, focus-loss recovery, actual Clear and a fresh recording | `platform/remap-browser-{short-final,short-streaming}/` |
| Chromium long repeated and natural capture | PASS at the fixed full-reference gates, acknowledged prefix retained after focus loss, empty second field, actual Discard and fresh recording | `platform/remap-browser-{long-repeated,long-natural}/` |

The native extension opens a visible idle panel, uses actual Hide to tray, starts recording through the private Unix socket, and confirms Open is refused during recording. After stop it verifies normal Copy, Settings, reopening, dismissal when a real GTK target acquires focus, and another Copy after reopening. Each Copy must replace its own verified private clipboard sentinel. The extended scenario explicitly dismisses its initial fixture target; the separate original scenario above succeeds without that step. Neither claims physical shortcut testing.

The synthetic reference is 33440 samples / 2.09 seconds. The final painted journey records 52663 samples / 3.29144 seconds including leading/trailing capture time. A single global alignment gives whole-fixture correlation 0.999986 and all active-quarter correlations above 0.99998, against prospectively fixed 0.90 gates. The reference, original captured WAV, checksums, duration and quarter scores are retained. These are digital transport observations, not acoustic quality or sample-perfect capture guarantees.

The first extended attempt is retained as a failure: it sent one shortcut while the panel was open, which the existing product deliberately handles by hiding the panel without starting recording. The corrected harness uses the real visible Hide control. Failure traces/debug files are now retained in all exits. The corrected functional pass also retained a black screenshot before the second Copy despite accessibility reporting it as showing. That image is not visual proof; a separate stronger paint gate requires a painted control and fresh accessibility state before each action. The final `remap-wayland-painted-journey` passes both paint checks before the actual actions. Both retained screenshots show the full panel and Copy control; the reopened screenshot was also inspected directly. The gate uses the explicitly configured private 1280×900 Weston kiosk geometry, the actual 420×660 application frame and fresh accessibility bounds. It does not pretend Wayland supplies a reliable global window origin. Eight pure helper tests include black-frame, blank-button and interior-audio-loss rejection. Earlier attempts remain preserved.

All four rebuilt browser result files identify the exact new GUI and unchanged packaged host/extension. Full-reference scores are:

- Repeated playback: 37.44 seconds, 64 reference words, zero errors in both canonical and final text. Its delivered 52-word prefix remains exact after focus loss. Fixed WER limit: 0.15.
- Natural playback: 39.755 seconds, 88 reference words, six errors in both canonical and final text (4 substitutions, 1 deletion, 1 insertion), WER 0.06818. Fixed WER limit: 0.25. The earlier GUI run had five errors on a different captured waveform. The additional `are` is already present in the new first canonical chunk; the second chunk and append are unchanged. This error remains counted. Different input PCM and a byte-identical decoder do not isolate a causal effect of the window change.

`platform/REMAP-BROWSER-REPORT.json` retains the exact run hashes, both captured-input hashes for the natural comparison, scores and observed stop-to-idle durations. The eight short takes range from 724 to 1069 ms; the two long takes record 1336 and 1476 ms. These are single-host trace observations with a small sample count, not physical-device latency benchmarks or a reliable p95.

The browser harness grants `http://127.0.0.1/*` only in its disposable extension copy. It verifies the tested plain-field integration under X11; it does not qualify arbitrary sites, rich editors, confined browser packages, browser-native undo or Wayland Chromium. Native IBus automatic mutation remains suspended. The original failed Wayland clipping runs are preserved separately from the successful rebuilt package.

Overall speech release acceptance remains **FAIL**. The [physical microphone protocol](physical-microphone-qualification.md) and [Linux environment matrix](linux-e2e.md) remain unrun for their named physical/installed targets. No installation, commit, push or publication was performed.

## Evidence and reproducibility entry points

- Consolidated final speech report: `production-evaluation-final/FINAL-SPEECH-REPORT.{md,json}`.
- All 94 prequalification candidate/baseline comparisons: `production-evaluation-final/candidate-comparison.json`.
- Persistent metadata audit: `production-evaluation-final/diagnostic-privacy-audit.json`.
- Exact final package/source manifest and archived source: `package-acceptance-wayland/manifest.json` and `source-before-build.tar.gz`.
- Serialized suite commands/statuses: `production-evaluation-final/{plan.json,statuses.json,completed.json}`. Overall orchestration exits 1.
- The six invoked runner/helper snapshots and hashes are retained in `production-evaluation-final/runner-snapshots/`, before later fail-fast harness hardening. Historical runner identity is not silently replaced by current source.

See [the evaluation protocol](speech-adversarial-evaluation.md) for preparation, immutable plan handling, scoring, timeout bounds and source attribution. Reproducing a known strict failure must still return failure; inventory, unit tests and family averages do not waive it.
