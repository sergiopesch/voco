# Foundations iteration 5 — 2026-09-05

**Recovery and acceptance are stronger; recognition qualification still fails.** This iteration closes an incomplete-decoder success path, retains received audio when AudioWorklet completion is unconfirmed, and fixes cancellation and late-callback handling. It keeps the existing `base.en` model and decoder parameters. It does not establish worldwide superiority or physical Linux desktop qualification.

The implementation was reviewed by three GPT-6 Astra specialists alongside the primary agent. Independent review complements the recorded tests; model agreement is not empirical proof. Evidence paths below are relative to `../../../foundations-evidence/iteration-5/` from this document's directory, or `../foundations-evidence/iteration-5/` from the checkout root. The [iteration 4 report](foundations-iteration-4-2026-09-05.md) remains historical evidence.

## What changed

### An incomplete native decode cannot silently succeed

When the native decoder reports terminal failure or low-confidence rejection and no eligible automatic recovery exists, the controller now returns an error before publishing the output as success. This applies to empty and nonempty results. The existing frontend recovery keeps available audio and transcript for explicit Retry or Discard; a repeated failure cannot insert text into a destination automatically.

Unflagged successful results and the digital-silence fast path are unchanged. The flags describe a failed decoder operation, not a guarantee that speech exists in the input. A nonspeech input that exhausts the decoder can therefore produce a recovery error. Numeric/static diagnostics retain no transcript strings, and the next request clears prior decisions.

Two new Rust tests cover short, ordinary and maximum-duration inputs, each native failure flag and both empty/nonempty outputs, unchanged successful output, silence reset, and absence of recognized strings in retained diagnostics. Rendered tests exercise the exact production error, failed-to-failed-to-successful explicit Retry using the same samples, canonical-prefix retention and tail-only Retry, and Discard followed by a fresh recording.

### AudioWorklet completion needs an acknowledgment

The old 80 ms flush timeout resolved as success even without the worklet's `flushed` message. A retained failing reproduction shows transcription starting despite missing acknowledgment. The new typed flush operation resolves only on that message. Timeout, message-port failure or cancellation rejects it; a late acknowledgment cannot reverse failure.

The hook disconnects the capture graph and tracks even after failure, retains samples already received, stops automatic output and exposes a persistent notice: the recording's end could not be confirmed, so Retry can transcribe only received audio. A successful Retry preserves that notice. This does not reconstruct a missing tail or prove physical microphone capture quality.

The 80 ms deadline bounds the flush wait, not all cleanup before the recovery panel appears. Cleanup can still await an in-flight native delivery operation; production browser receipts and owned-preedit socket operations have their own finite timeouts. There is no separate frontend watchdog for a completely wedged native IPC/runtime.

### Waiting for recovery can be cancelled safely

Retry waits for existing canonical, preview and delivery operations before reopening output. The wait has its own identity token. Cancel returns immediately to recovery without discarding received audio; a later native completion cannot restart that cancelled attempt. A subsequent Retry still waits behind the original work. Discard and unmount invalidate the wait.

Testing this lifecycle exposed another defect: a callback from an old session could set a shared deferred flag after a new recording began, suppressing its checkpoints. Canonical catch and pump effects now check their originating session. The renderer verifies a new 31-second recording still receives its first canonical checkpoint after an old response completes. Cancelling the wait does not abort the native decoder itself.

The final frozen hook passes **42 rendered scenarios**, including actual generated Chromium AudioWorklet behavior, delayed/missing acknowledgment, port failure, repeated cancelled waits, late completion, unmount and new-session isolation. These use explicit microphone and Tauri mocks; they are not native WebKit or hardware proof. See [speech recovery architecture](../architecture/speech-recovery.md) and `decoder/flush-audit/` for source snapshots, the original failing reproduction, review and final results.

## Recognition results and rejected changes

The release replay worker ran the existing 114 canonical cases again. **Every complete response object, including diagnostics, is structurally identical to iteration 4: 108 pass and six fail.** All 37 preview objects also match. The eight-fixture full/canonical/preview baseline passes, with aggregate full-mode WER 0.025. These are measured current results, not an inference from unchanged source.

The six previous failures remain four speaker-777 repetition cases and two versions of `KIRKLEATHAM YEAST`. This iteration replayed the latter two exact waveforms through the original worker: it also returns `Kirkley Thim Yeast.` Both proper-name failures are now demonstrated to predate these changes. Their references and thresholds remain unchanged.

### New qualification, frozen before inference

Eight additional speakers were selected with deterministic rules excluding all previous baseline, adversarial and qualification speakers. The plan contains eight complete natural utterances, the same eight with seeded 40 dB white noise, and four complete-utterance placements. References, PCM, model, worker and scoring requirements were frozen before the single candidate run. Previous qualification is now diagnostic evidence; the new plan was not tuned or rerun after results.

| New 20-case result | Count |
|---|---:|
| Original per-case and family WER gates | 20 pass, 0 fail |
| Supplemental zero-deletion/zero-insertion and boundary-word integrity | 18 pass, 2 fail |
| Exact normalized transcription | 8 of 20 |

Both supplemental failures are versions of a 27-word speaker-5338 passage: two substitutions and one deletion, WER 3/27. `TULLY VEOLAN` becomes the single token `Tuleveylon`, and `WAVERLEY` changes spelling. First/last-word checks pass; the zero-deletion requirement fails. The native failure flags are false. This token-alignment deletion does not by itself prove an acoustic span was dropped. No original-baseline replay of these new cases was performed.

Across all 134 unique canonical cases, **128 meet the original WER gates and six fail**. The two supplemental failures remain separate. This heterogeneous read-speech and synthetic collection is not a representative real-world accuracy benchmark. Full references, hypotheses, S/D/I counts, identities and failures are in `evaluation/CANDIDATE1-EVALUATION.{json,md}` and `evaluation/qualification-candidate1/`.

### Repeated speech must preserve the actual sequence

The unchanged 42.12-second continuity fixture contains 18 four-word phrases. Its old 15% WER gate allowed the candidate's 19 phrases to pass. The test now requires exact normalized sequence and count as a separate condition. **The candidate still produces four insertions: WER passes, integrity fails, and the command exits with failure.** Prefix consistency and plausible segment timestamps do not prove lexical accuracy.

The Chromium long repeated fixture independently contains 16 complete phrases / 64 words. Its helper now enforces that exact sequence and count alongside its unchanged 15% WER limit. Natural-speech browser scoring retains its separate 25% WER limit. Tests include added and missing complete phrases that the old WER gate accepted. Neither source WAV nor reference was shortened.

CI and release workflows now finish all three independent baseline, continuity and adversarial commands before returning a combined failure. A failed continuity check cannot prevent the other diagnostics from being collected; it also cannot become a pass. No remote CI/release run is claimed. The integrity CLI refuses mismatched plan/worker/model identities, missing or duplicate cases, failed original suites and overwriting existing reports.

A predeclared pause-boundary experiment improved the repeated fixture from four insertions to one, still failing exact integrity. On its paired natural control it increased errors from 17 to 30, including 14 additional deletions. It was rejected without changing production window geometry. Raw second-window output already contains the extra phrase; text deduplication or timestamp clamping has no demonstrated basis for removing it safely. No safe repair was established by the tested alternatives. Failed experiments and their exact inputs remain under `decoder/`.

## Packaged platform acceptance

The final package passed the [actual Chromium toolbar journey](chromium-toolbar-acceptance.md) in private X11: correct plain-field delivery, zero mutation of either field after focus loss, actual Discard recovery and a fresh successful recording. Each of the three cases used a new real activation through Chromium's visible Extensions menu. The packaged extension manifest, content script and background script were unchanged; there was no harness-only host permission grant. The pre-action permission menu and resulting intended-field text were inspected visually. Evidence: `platform/chromium-toolbar/final-short/`.

Two separately frozen long toolbar journeys then passed on the same package:

| Browser playback | Canonical and final accuracy | Other acceptance |
|---|---|---|
| 37.44 seconds, 16 complete repeated phrases | 0 errors / 64 words; exact sequence and count pass | Committed prefix retained after focus loss, second field empty, actual Discard and fresh recording |
| 39.755 seconds, natural speech | 4 substitutions, 1 deletion, 0 insertions / 88 words; WER 0.05682 meets unchanged 0.25 bound | 401-character committed prefix unchanged after focus loss, second field empty, actual Discard and fresh recording |

Evidence: `platform/chromium-toolbar/final-long-{repeated,natural}/`, with a prior frozen plan and runner snapshots under `long-plan/`. Both modes run independently; a repeated-case failure cannot suppress natural testing. The natural error remains counted. The passing 16-phrase captured waveform is different from the failing 18-phrase worker fixture and does not waive that failure.

These local fixtures do not qualify arbitrary websites, rich editors, extension-store installation, confined Chromium packages, Wayland browser UI or physical microphones. Earlier permission probes and their harness failures remain under their original package identities.

The same packaged GUI passed the extended [GNOME/Mutter journey](gnome-isolated.md): two process-bound model-ready Open/Quit cycles, synthetic WebKit capture, refusal to expose the idle panel during recording, normal Copy, Settings, reopen, real blur dismissal and a second Copy. Each clipboard operation replaced a separately verified sentinel with `Go! Do you hear?`; target mutation remained empty. Evidence: `platform/final-gnome-scrollto/`.

The private GNOME Shell 46 / Mutter 46.2 session uses the real Ubuntu appindicator extension, whose watcher PID must equal the Shell PID. It maps both GTK 3 and GTK 4 WebKit surfaces. Tray actions invoke the app's actual registered DBusMenu method, not pointer clicks on the tray menu. Recording starts through the private app socket, not a physical/global shortcut. A test-only Shell extension reports native PID, window generation, frame, visibility and focus; it is copied only into the disposable data directory.

The 800×600 nested desktop constrains the app to 420×568. Initial wheel and PageDown attempts did not reveal Settings and remain failed runs. A separate real WebKit overflow fixture demonstrated supported AT-SPI `scroll_to`; the final journey uses that action, then requires the entire control inside the current frame, stable focused native geometry and a painted control before activation. The pre-action Copy, Settings and reopened-Copy images were inspected directly. A blank initial paint observation correctly waited for a painted frame; post-teardown screenshots are not acceptance proof.

The digital capture contains 52,756 samples including leading/trailing time, against a 33,440-sample reference. A single alignment yields whole-fixture correlation 0.99855; all scored active quarters exceed 0.9978 against the unchanged 0.90 gate. This is transport evidence, not sample-perfect or acoustic microphone quality. The raw lifecycle rows retain a `decoderLoaded: false` placeholder from their cache-only check; that field is inaccurate as an after-capture claim. Actual decoding is separately established by the capture trace and resulting transcript. The raw report is preserved; no qualification rerun was performed to change the label.

The same package also passed the complete [KDE/KWin journey](kde-isolated.md), with real KWin 5.27.11 and Plasma in a private 1280×900 session. The real kded StatusNotifierWatcher module is activated through its observed interface, and its owner PID is checked. Both GTK/WebKit generations map native Wayland surfaces. Two model-ready Open/Quit cycles, synthetic capture, recording-time Open refusal, painted Copy and Settings, blur/reopen and fresh clipboard replacement pass with zero target mutations. Evidence: `platform/final-kde-capture/`; the separate no-inference lifecycle run remains in `platform/final-kde-lifecycle/`.

A bounded read-only KWin script reports the actual app PID, internal window identity, frame and focus. It does not move or activate windows. Pre-action images require stable native geometry and contained controls; all three final images were inspected visually. The first Settings paint observation failed and remained retained before the later painted frame passed. Digital capture contains 52,710 samples and has whole-fixture correlation 0.99819, with scored active quarters above 0.9972. The phrase and two separate clipboard sentinels match the GNOME protocol. These are observations from this host, not a hardware latency or acoustics benchmark.

The KDE runtime consists of checksum-verified public distribution packages extracted privately; nothing was installed on the host. Earlier attempts lacking desktop data, using an unsupported kded argument or missing watcher activation remain failed harness attempts. This is real compositor execution with private services, not a complete installed Kubuntu login, lock screen or hardware session.

Two test metadata issues were corrected for future runs without changing acceptance rules or rerunning capture: cache-only lifecycle rows inaccurately labeled the capture cycle as having no decoder/inference, and the dark Settings button's threshold dictionary described the light Copy branch. The accepted raw reports and invoked source snapshots remain intact. Independent reviews verified the actual branch conditions and result identities; neither inaccurate label supplies proof. Current helper tests cover both button appearances and offscreen rejection. Earlier GNOME baseline probes retain their iteration 4 package identity and do not substitute for the final-package run.

## Artifact identity and verification

| Artifact | SHA-256 |
|---|---|
| Debian development package | `eaed5c0f26dd0432a8ef83dc78093eef47e57ff6c11798017e4bd0a72da0e31f` |
| Packaged GUI | `0783700482cdfee9808efbce80c4c8ce8ccdba4608be200411a14ed7c0b2e631` |
| Packaged browser host | `e225cd4f8c9c49e99dde4fa7ebdb0826fd1bc956543f13bc5d6136b9e6cdfbab` |
| Candidate replay worker | `72ac6387a721af894f0c0f5c5a08c24a04eb45e5f644d2634e08ae6a451e65ba` |
| Transcription source | `259d688b9a74148dffef778b1127477329d27c4491a91f7513e828ab226ac19a` |
| Final recording hook | `baf92c41a284d7b1dda80bd2f1de5d8c76f61e5fcfb54ecaefa268cb22ee957f` |
| Unchanged base.en model | `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002` |

The build uses the release profile and `custom-protocol`. The pre-build source archive is SHA `579ecc0baea6e1a6420aca195472a5a8bcc401a08c9e0b5daa6132a409b4dec4`; its inventory records 794 files. Build and Debian content/permission verification pass. Test harness changes after that snapshot do not alter packaged application inputs. HEAD remains `6ab2b2c37f1fc9bdf0ad7b1a0ecbbfea65cd16ee` with intentional uncommitted foundations work; HEAD alone cannot identify this package.

The release replay worker remaining in the final build target is byte-identical to the frozen candidate used for speech evaluation, and the transcription source is unchanged. No extra qualification inference was needed after the frontend package build. The debug-profile worker is a different artifact and was not substituted.

`source-delivered.tar.gz`, `source-delivered.json` and `DELIVERY-MANIFEST.json` under the iteration 5 evidence root identify the final recoverable checkout, package, accepted platform runs and failed recognition gates. `tracked-delivered.patch` contains the complete tracked diff against HEAD; `iteration-5.patch` isolates this iteration's text changes against the retained starting archive. The full source archive also includes untracked source files. The package remains an unpublished development artifact with the existing version number.

Current recorded checks pass: 224 Rust library tests and 18 browser-host tests; 230 frontend tests with two existing private-audio tests skipped; 42 rendered scenarios; TypeScript, ESLint, Clippy across all targets/features, formatting, DevOps checks and local release rehearsal. Additional scoring checks cover integrity (13), continuity (7), browser long accuracy (13) and native waveform/control helpers (9). Rust's default test invocation does not run the separate fixture example's tests; their previous iteration result is not relabeled as current. The unchanged vendor build-script `unused_mut` warning remains recorded.

The initial replay-worker build omitted the required `custom-protocol` feature and correctly failed its compile guard. The corrected command passed. Both logs remain under `validation/`; the missing-feature invocation is not an application regression.

## Remaining qualification

Strict recognition failures above remain open. The additional integrity checks expose omissions and repetitions; they do not repair recognition or establish a lexical-completeness detector for unknown speech. A model with stronger recognition remains a later phase, as requested.

Physical microphones, acoustic noise, unplug/replug and device switching, suspend/resume, lock/unlock, installed-distribution upgrade behavior, screen-reader usability and physical shortcuts need separate qualification. Private synthetic audio and real compositor processes do not fill those rows. Crabbox's cloud provider is unavailable because credentials are absent; local namespaces are the explicit fallback, not equivalent cloud VM evidence.

The next release decision needs the fixed failing speech cases, consented spontaneous and read-aloud microphone samples with measured correction burden, and installed GNOME/KDE application journeys. Direct native insertion remains suspended; generic simulated typing is not a substitute for verified destination ownership. This package was neither installed on the active workstation nor published.
