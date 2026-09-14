# Physical microphone qualification protocol

Status: **not run**. This protocol is a plan, not evidence of physical microphone,
installed GNOME/KDE, or acoustic-quality acceptance. It does not authorize recording
by itself. The current automated evidence uses private virtual sources; see
[Wayland checks](wayland-isolated.md) and [iteration 4](foundations-iteration-4-2026-09-05.md).

## Consent and target

A participant must explicitly agree to the selected device, read-aloud material,
recording duration, retained files and deletion date. Use only their voice and a
room without unconsented bystanders. They may stop immediately or decline retention.
Use a disposable test installation/session or an explicitly authorized target; do
not change the active user's groups, global device permissions, services or browser
profile to make a failed test pass. A VM without explicitly consented physical-device
passthrough tests virtual transport, not the microphone. Human participation and
physical-device selection are required; the namespace harness cannot perform them.

Record before each session:

- Candidate `.deb`, extracted GUI and replay-worker SHA-256; source revision plus
  dirty-source snapshot/patch hashes; decoder dependency versions and parameters.
- Existing model SHA-256, fixed at
  `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002` for base.en.
- Distribution/version, desktop/compositor/version, X11 or Wayland, kernel,
  PipeWire/PulseAudio version, installation method, CPU and power mode.
- Consented device label/model, connection type, selected input in app/desktop,
  input gain, reported sample rate/channels, physical distance and room/noise notes.
  Use a local device alias; serial numbers and persistent identifiers need not be shared.
- Participant alias, self-described accent/language and speaking style if consented;
  no inferred demographic labels. Freeze references and case order before recognition.

Confirm the candidate is actually running. Use the app's microphone selection/test
controls where available; if selection is unavailable, record the desktop default
and that limitation. Record permission prompts and outcomes. Do not invent a device
selection API or silently substitute a different device.

## Fixed read-aloud cases

The following newly written test text contains no private data. Pauses in brackets
are instructions, not words in the reference. Keep failed takes and deviations;
annotate the words actually spoken from the recording before comparing hypotheses,
without changing a reference to match recognition. Run three takes per speech case.

| Case | Exact text/instruction | Purpose |
| --- | --- | --- |
| Brief | “Go. Do you hear?” | Initial/final consonants and short capture. |
| Quiet | “Please place the small blue cup beside the window.” Speak comfortably quietly at the recorded distance. | Quiet speech; do not replace with digitally attenuated audio. |
| Repetition | Read “Go. Do you hear?” thirteen times, with a natural short pause between repetitions. | Count every real repetition; no deduplication credit. |
| Long pause | “The first number is seven.” [Remain silent five seconds.] “The second number is nine.” | Speech after a pause and retained tail. |
| Boundary | “We will review the notes, check the dates, and send the final list tomorrow morning.” Repeat this sentence at a natural pace until more than 35 seconds has elapsed, completing the last sentence. | Actual 30-second checkpoint and final tail; record the exact repetition count. |
| Noise | Repeat Brief and Quiet with a stable fan or other consented nonverbal room noise. Record source, position and level setting. | Acoustic noise, separate from synthetic white-noise controls. |
| Silence | Record ten seconds without speaking in the same room. | False lexical output; reference is empty, report word count rather than WER. |
| Clipping | Repeat Brief with a separately recorded higher input gain only in the disposable target; stop if uncomfortable and restore the prior gain. Do not shout. | Observe clipping/recovery; call it a clipped case only if saved PCM shows saturation. |

Do not crop failed onsets/tails, normalize away clipping, or remove pauses from the
original recording. Any derived/resampled WAV must retain its original checksum,
conversion parameters, resulting checksum and full duration. Record requested and
actual device/gain for every take. Acoustic levels without a calibrated meter are
qualitative observations, not measured dB SPL.

## App journeys and lifecycle

Use **final text only** first, then **stable cursor streaming** for the long case.
Native IBus automatic mutation is suspended: text must remain out of GTK/Qt/editor
fields and appear as **Transcript ready to copy**. Copy through the actual control,
manually paste into an empty local scratch document, and compare exact text. Clear
only after preserving the result. Record empty output, wrong words, missed tails,
duplicate text and unavailable Copy as failures; do not silently repeat until success.

For the separately enabled Chromium adapter, use its actual toolbar permission flow
and Alt+Shift+V in supported plain fields. First prove one correct destination; then
switch fields during recording. The new field must remain unchanged, any acknowledged
prefix must remain exact, and remaining text must be recoverable. Use actual recovery
Copy/Discard, then start another recording. Do not infer adapter coverage from native
manual Copy. Rich editors and confined browser packages remain separate cases.

While idle, disconnect/reconnect a removable microphone; verify the displayed/current
selection and a new Brief take. Separately disconnect during a take: record whether
VOCO signals capture loss and retains recoverable text/audio. Reconnect and explicitly
start a new take; do not accept silent fallback to another microphone. Record built-in
microphones as “not applicable” for physical unplug, not as a pass. Suspend/resume and
lock/unlock require a human on the disposable desktop, with the recording stopped
first; recheck selection, shortcut and Brief afterward. A lock-during-recording test
requires separately agreed expected behavior and participant consent.

Measure stop-to-idle from the participant's actual stop action to visible completion,
and stop-to-copy-ready separately. Use a consented screen recording or observer timer;
state frame/timer resolution. Retain each latency, then report median, p95 and maximum
with sample count; three takes are not a reliable p95 estimate. App trace timestamps,
when explicitly enabled in test state, supplement rather than replace visible proof.
Do not run competing inference while collecting baseline latency.

## Executable offline session import

`scripts/prepare-physical-speech-session.py` prepares a private, local session without
opening any audio device or invoking recognition. Start with an unapproved template:

```bash
umask 077
mkdir /absolute/path/to/private-session
python3 scripts/prepare-physical-speech-session.py template \
  --output /absolute/path/to/private-session/session.json
```

A human fills the participant alias, explicit local-import/evaluation consent,
timezone-qualified consent and deletion times, selected device/gain observations,
environment and actual candidate hashes. Acceptance thresholds are intentionally
blank: freeze them before recognition. The template provides five original text
cases; add separately identified takes/noise/boundary cases from the table above.
Leave unrecorded cases as `not-run`, or `not-applicable` with a reason. They will
remain unrun in the output ledger rather than silently becoming passes.

Recording is still a human step using the approved device and recorder. For each
completed take, set `status` to `recorded`, supply the untouched original WAV path
(relative to the session file or absolute), its `sha256sum`, actual capture notes,
and the verified spoken reference plus its provenance. Check the words against the
recording before viewing a recognizer's hypothesis. This declaration is recorded;
the tool cannot independently verify consent or what the participant said.

Replay requires mono 16kHz PCM16 WAV. If the recorder produces a different format,
retain it unchanged and explicitly convert a **derived** file using a locally
available tool. Record the complete conversion command in `conversion`, the derived
path in `replayWav`, and its checksum in `replaySha256`. For example, if FFmpeg is
already available, a full-duration conversion can use:

```bash
ffmpeg -i original.wav -ac 1 -ar 16000 -c:a pcm_s16le derived.wav
sha256sum original.wav derived.wav
```

Do not trim, suppress silence, denoise or normalize for the primary comparison.
The importer does not perform sample-rate conversion itself. It validates WAV
format and checksums, preserves the original file bytes, and emits a simple replay
header around every unchanged derived PCM byte. Conversion correctness remains
separate from original capture qualification.

```bash
python3 scripts/prepare-physical-speech-session.py import \
  --session /absolute/path/to/private-session/session.json \
  --output-dir /absolute/path/to/private-session/frozen
```

The new output directory is mode 0700; originals, plan, references/metadata and
combined replay WAV are mode 0600. Existing outputs, symlinks/FIFOs, checksum
mismatches, expired consent, duplicate identifiers and unverified references are
rejected. Input type is checked on a nonblocking, no-follow opened descriptor,
so replacing a validated path cannot redirect the read to a different file or block
on a FIFO. Reads remain bounded if a file grows. Retained original, derived and
emitted per-case WAV bytes together are limited to 512 MiB before output creation;
this includes recorder metadata, not only decoded PCM. `status.json` reports imported
cases as `imported-not-evaluated`. The
retention deadline is recorded but **no deletion automation is scheduled**; the
participant/operator remains responsible for the agreed deletion of all copies,
including derived evaluation reports. Do not add participant recordings to Git.

`plan.json` uses the existing **legacy canonical replay** evaluator schema. This preserves the historical comparison and does not exercise current production hybrid full/VCA2 ownership. With a previously built worker
whose hash matches the declared candidate, replay serially and keep the output
private:

```bash
umask 077
VOCO_MODEL_PATH=/absolute/path/to/existing/ggml-base.en.bin \
  env -u PYTHONOPTIMIZE python3 scripts/test-speech-adversarial.py evaluate \
    --plan-dir /absolute/path/to/private-session/frozen \
    --worker /absolute/path/to/provenance-matched/preview_replay_worker \
    --output-dir /absolute/path/to/private-session/evaluation
```

The evaluator verifies the model/audio hashes and records the actual worker hash;
compare that hash to the session declaration before accepting the run. This command
performs local inference and requires the normal serialized compute slot. Importer
tests use only the public fixture and run no inference. For matched system comparison,
map each emitted case's `sha256` to `audioSha256`, its exact `reference` unchanged,
and `(endSample-startSample)/16000` to `durationSeconds` in the
[comparative report contract](comparative-dictation.md). Original capture provenance
stays in the private session manifest. Import/replay cannot mark any installed
desktop, physical device or shortcut matrix row as passed.

## Existing offline replay and scoring

There is no generic physical-recorder command in this protocol. Recording/export is a
human step using an explicitly selected device and consented local recorder or the
app's deliberately enabled test diagnostic capture. Never enable diagnostic audio in
the user's normal configuration implicitly. Replay tests engine output, not capture,
permission, tray, compositor or destination behavior.

The existing **legacy** `preview_replay_worker` accepts a consented WAV and `--full`; that option still calls the legacy full API, even in a current build. It requires
mono 16 kHz PCM16 RIFF/WAVE with the simple 44-byte header layout; arbitrary recorder
metadata/channels/rates may need an explicitly documented conversion first. It does
not enforce the pinned model checksum itself. From the repository root, after
setting paths to an already built, provenance-matched worker and consented WAV:

```bash
export VOCO_MODEL_PATH=/absolute/path/to/existing/ggml-base.en.bin
WORKER=/absolute/path/to/provenance-matched/preview_replay_worker
WAV=/absolute/path/to/consented-16000-mono-pcm16.wav
sha256sum "$WORKER" "$WAV" "$VOCO_MODEL_PATH"
# Stop if the model hash does not equal the pinned hash above.
"$WORKER" "$WAV" --full > hypothesis.txt 2> replay.stderr
```

Create `reference.txt` with the full agreed spoken reference. Score it with the
existing word-error implementation; this command reads files and performs no capture:

```bash
node --input-type=module <<'JS'
import fs from 'node:fs';
import { scoreTranscript } from './scripts/speech-score.mjs';
const reference = fs.readFileSync('reference.txt', 'utf8');
const hypothesis = fs.readFileSync('hypothesis.txt', 'utf8');
console.log(JSON.stringify(scoreTranscript(reference, hypothesis), null, 2));
JS
```

Keep original punctuation/case output as well as normalized WER. Report substitutions,
deletions, insertions and reference word count per case; zero-reference noise/silence
requires zero lexical output. Compare the same retained WAV against baseline and
candidate workers serially. Freeze any WER/latency acceptance limits before evaluation;
do not inherit the synthetic corpus's limits as a physical-product quality guarantee.
The fixed-corpus preparation scripts do not import arbitrary consented recordings;
the explicit session importer above provides that separate provenance-preserving path.

## Unrun target matrix

| Target | Session | Physical capture | Copy/recovery | Device lifecycle | Latency |
| --- | --- | --- | --- | --- | --- |
| Ubuntu 24.04 GNOME | Wayland | Not run | Not run | Not run | Not run |
| Ubuntu 24.04 GNOME | X11 | Not run | Not run | Not run | Not run |
| Kubuntu 24.04 KDE | Wayland | Not run | Not run | Not run | Not run |
| Kubuntu 24.04 KDE | X11 | Not run | Not run | Not run | Not run |
| Debian GNOME reference target | Wayland | Not run | Not run | Not run | Not run |

Record each desktop's actual available session rather than forcing an unsupported
choice. Qt/LibreOffice/Electron scratch destinations, browser packaging and physical
keyboard shortcuts need explicitly named rows when run. Local Weston headless and
Xvfb results never change these physical-session rows to Pass. No current matrix
completion, microphone recording, host policy change or publication is implied.

## Current application adapter status

The [physical evaluator v2](../../../foundations-evidence/iteration-13/application-integration/physical-adapter-proposal/SOURCE-READY-v2.json) is now independently reviewed as a ready evidence proposal: complete full/VCA2 response and coverage checks, per-case and aggregate thresholds, silence handling, complete failure denominators, and consent-before-private-data validation are implemented. The [independent review](../../../foundations-evidence/iteration-13/application-integration/physical-adapter-proposal/DECODER-FINAL-REVIEW-v2.json) verified all 156 bindings and passed 10 Python and 19 JavaScript tests. The [source-bound Rust planner comparison](../../../foundations-evidence/iteration-13/application-integration/audits/capture-physical-planner-oracle-lock.json) covered 168 public/generated inputs: 164 valid inputs with 290 receipts and four rejected inputs. This bounded comparison does not prove every possible input. No actual physical recording, consent/session declaration or execution authorization is established by this readiness evidence. A transport-complete run alone cannot satisfy physical qualification. Do not substitute a new application worker into a frozen legacy session declaration. Freeze the actual prepared plan and evaluator provenance separately before an authorized evaluation; readiness does not supply consent.
