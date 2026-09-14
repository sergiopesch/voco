# Foundations iteration 6 — capture integrity and causal decoder diagnosis

This iteration closes a false-success path in legacy audio capture, adds reviewed
offline qualification tools, and narrows the remaining repetition defect. It does
not solve the remaining recognition failures or establish worldwide superiority.
The base.en model, native decoder source, production decoding parameters and
speech acceptance thresholds remain unchanged.

Evidence is retained in `foundations-evidence/iteration-6` beside this checkout.
The starting 796-file source matched iteration 5's delivered inventory exactly;
its archive SHA-256 is
`ea93463c239939e931294560bd96c3c9b04b2c8b48c8a1da02e27468ec0d2d68`.
No host installation, commit, publication or physical recording was performed.

## Capture defect and implemented behavior

Stopping ScriptProcessor capture previously disconnected the graph and treated
received callbacks as complete audio. A real Chromium graph with an 18,000-sample
generated source delivered only 14,336 source samples before immediate teardown:
the final 3,664 were missing. This is a synthetic audio-graph experiment, not a
measurement of microphone latency.

A proposed callback-timestamp drain also failed. With a fixed 700 ms main-thread
stall it acknowledged completion while the same 3,664 samples were still absent.
A separate generated MediaStream graph lost 208 source samples even without that
stall when its source was disconnected at the generator's end. Raw callbacks,
source snapshots and rejected heuristics remain in `script-processor-probe.*`
and `evaluation/scriptprocessor-review/`. The Web Audio
[AudioProcessingEvent contract](https://www.w3.org/TR/2021/REC-webaudio-20210617/#AudioProcessingEvent)
describes output playback time; it provides no input-tail acknowledgment.

The application now handles this uncertainty explicitly:

- If AudioWorklet initialization fails, the fallback captures received audio and
  displays a manual-review notice. Live previews and automatic checkpoints are
  disabled before connecting it.
- Stop throws the existing typed incomplete-capture error, closes the graph and
  tracks, and preserves received audio for Retry or Discard.
- Retry transcribes locally for explicit copying. The completeness notice stays
  visible. It cannot recover audio that was never delivered.
- Delayed target ownership cannot authorize output. Discard and a subsequent
  healthy AudioWorklet session restore normal operation.

This changes the compatibility path deliberately: every ScriptProcessor recording
requires manual recovery. The normal AudioWorklet path retains its acknowledged
completion behavior. Neither path's message accounting proves physical microphone
fidelity or that recognition contains every spoken word. See
[speech recovery](../architecture/speech-recovery.md) and
[troubleshooting](../troubleshooting.md).

The original failing renderer attempt is retained in `fallback-before-fix.log`:
the old hook transcribed and committed automatically rather than exposing recovery.
An initial new test incorrectly summed overlapping canonical requests; its failure
is retained in `renderer.log`. The corrected assertion checks the established
0–30 and 29–31 second ranges, with no production overlap change.

## Decoder diagnosis: experiment rejected

Frozen probes inspected the existing continuity second window, a natural
speaker-777 utterance, and a quiet natural-speech control. They did not rerun or
tune against iteration 5's new 20-case qualification set.

Removing timestamp conditioning produced the correct repeated words in the
13.12-second continuity window, but the native decoder still rejected that result.
Log-only instrumentation proved why: at all six existing fallback temperatures
it reached genuine end-of-text, then failed the entropy threshold (1.872408 versus
2.4). No EOS bookkeeping defect was found. The incorrect timestamped output
passed the entropy check and retained four inserted words; confidence alone also
failed to distinguish the error.

The earlier 30-second timestamp-free experiment remains a rejection: after a
token-loop failure and entropy rejection, a later temperature accepted only a
short fragment. A flag-only recovery rule would also miss the current incorrect
baseline because it carries no failure flag. No supported completeness guard was
established, so no parameter change or failure suppression was promoted.

A separately built pristine whisper.cpp 1.7.4 then ran exactly three frozen
baseline calls. All accepted segment/token rows matched the patched engine's
retained output byte for byte, including reported token probabilities:

| Existing development case | S / D / I in both engines |
| --- | --- |
| Continuity second window | 0 / 0 / 4 |
| Isolated speaker 777 | 1 / 0 / 0 |
| Quiet natural speech, speaker 1462 at gain 0.01 | 3 / 1 / 0 |

This establishes that these particular errors also occur without VOCO's native
patches. It is an engine-level causal comparison, not an app benchmark or proof
of a model's fundamental accuracy ceiling. Upstream's unavailable VOCO diagnostic
flags are null, not false. Plans, source and model hashes, build identity, native
logs and comparisons are in `decoder/`; no failed hypothesis was discarded.

## Reviewed qualification tools

[The comparative importer](comparative-dictation.md) binds supplied measurements
to a frozen model, plan, audio and system artifact identity. It retains every
planned attempt, separates S/D/I, enforces declared name/numeral occurrence
counts, and reports completed-only latency with censored counts. Missing RSS
cannot satisfy a resource-capped qualification. Human correction measurements
remain distinct from a minimum-word-edit proxy. The importer does not authenticate
the supplied measurements or enforce an application's runtime resource limits.

[The physical-session importer](physical-microphone-qualification.md) accepts
already-consented WAVs and explicitly declared provenance. It preserves original
bytes privately, checks derived audio duration and retains an unrun-case ledger.
It does not record, convert, upload or transcribe audio. Its retention deadline is
metadata; no automatic deletion job is claimed. Eight prospective original text
cards are frozen separately and have no recorded audio or accuracy result yet.

Independent review fixed path-swap and cumulative input-size problems in the
physical importer, and FIFO hangs, invalid integrity settings bypassing validation,
and nonfinite derived metrics in the comparative importer. Both suites run through
`npm test` and DevOps verification. Retained reproductions and review records are
under `evaluation/importer-review/` and `platform/comparison-review/`.

## Verification and artifact identity

- 49 renderer scenarios pass, including fallback recovery, delayed ownership,
  cancel/discard/restart, device lifecycle cases and a real generated Chromium
  AudioWorklet graph. Native IPC, clipboard and ordinary microphone scenarios use
  explicit mocks; no physical capture is implied.
- The full npm suite passes: 230 frontend tests, with the same two private-audio
  tests skipped; 16 physical-import and 12 comparative-import tests pass alongside
  the existing helper suites.
- TypeScript, ESLint, DevOps preflight, the release Debian build and package
  verification pass. The
  existing vendored `unused_mut` build warning remains unchanged.
- The exact packaged GUI passes actual isolated GNOME Shell/Mutter and
  KWin/Plasma capture, Copy, Settings, blur/reopen and two lifecycle cycles each.
  Real AudioWorklet use and cross-process clipboard text are observed. Whole
  fixture waveform correlations are 0.997985 and 0.999800 respectively; scored
  quarters exceed 0.9969. These are private synthetic-device sessions, not
  physical microphones or installed-distribution qualification.
- The first GNOME attempt completed capture/Copy but failed on a transient null
  accessibility child during restart. Both harnesses now skip disappeared
  children within the unchanged readiness deadline. The original failure remains
  in `platform/package-desktops/`; complete successful journeys and native paint
  witnesses are in `platform/package-desktops-guarded/`.
- The packaged Chromium toolbar integration passes three short journeys:
  delivery, focus-loss recovery and a fresh recording after clearing recovery.
  The long repeated fixture preserves all 16 phrases and 64 words exactly. The
  long natural fixture passes its declared bound with 4 substitutions, 1 deletion
  and 0 insertions across 88 reference words (5.68% WER), matching the previous
  observed error counts. Canonical and final text are scored separately; focus
  loss preserves the existing target prefix and leaves the tail for recovery.
  These private X11/synthetic-audio runs preserve the shipped extension manifest
  with no harness-only host grant. They do not waive the separate failing
  18-phrase continuity gate. Raw plans, outputs and statuses are retained in
  `platform/chromium/`.

Debian package SHA-256:
`09e71a1234b8424f824e79c6f602f91185724c71216a4669545f119889ce7c94`.
Extracted GUI SHA-256:
`3a498cca9bbf920693dbba847d4fbb29d4274527c9997bad33ab4ac9824f9154`.
The browser host remains byte-identical to iteration 5:
`e225cd4f8c9c49e99dde4fa7ebdb0826fd1bc956543f13bc5d6136b9e6cdfbab`.
`package-acceptance/package-manifest.json` and the final delivery manifest bind
the package, recoverable source and evidence.

## Open acceptance

The six historical per-case WER failures, two supplemental qualification word
integrity failures and strict 18-phrase continuity failure remain open. Their
iteration 5 results are historical evidence on unchanged recognition source, not
a fresh qualification campaign. The three new diagnostic comparisons above do
not replace those gates.

Physical microphones, installed desktop sessions, hardware shortcuts, lock/suspend
and complete peer-app correction/time measurements still require observed
qualification. No participant audio was available for this iteration. The quality
goal remains open; internal test counts and isolated virtual-device journeys do
not establish the best Linux dictation application in the world.
