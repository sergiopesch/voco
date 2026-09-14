# VOCO foundations: implementation and acceptance record

> Historical first-pass snapshot. See [iteration 3](foundations-iteration-3-2026-09-05.md)
> for the current candidate. [Iteration 2](foundations-iteration-2-2026-09-04.md)
> records the native failure that led to suspending automatic IBus mutation.

4 September 2026. Base: `6ab2b2c37f1fc9bdf0ad7b1a0ecbbfea65cd16ee` (2026.0.21).
Work is on `codex/foundations`. This is an uncommitted development candidate,
not a published release or a claim of complete Linux desktop acceptance.

The existing `ggml-base.en.bin`, English decoder, CPU execution profile and model
SHA-256 remain unchanged. No stronger speech model, new VAD model, cloud dictation
dependency, persistent recording history, or framework migration was introduced.

## Resulting behavior

### Delivery and recovery

- Every automatic text output mode acquires an IBus field lease during recording
  startup. Final-only, enhanced and assistant output now follow the same ownership
  boundary as canonical streaming. Missing or invalidated ownership retains output
  in VOCO for manual copying; there is no automatic global typing/paste fallback.
- Successful one-shot acknowledgments now count exactly the characters dispatched
  by the lease. This includes Unicode and preserved-tail results. Failed dispatch
  cannot claim the requested text was committed.
- Integration helpers expose `no-mutation`, `rejected`, and `uncertain` errors.
  Only a helper that never spawned permits another whole-transcript attempt.
  Successful helper exit means `dispatched`, not acknowledgment by a target app.
- Clipboard helper delivery leaves the transcript in the clipboard. Removing the
  delayed restoration prevents overwriting a newer copy and avoids claiming that
  generic command-line helpers can atomically preserve every MIME representation.
- Microphone track loss, sustained system mute, missing sample arrivals, wall-clock
  duration and a 128 MiB source-sample cap bound capture. Device-list changes refresh
  the UI; selected-device fallback is visible, including primed-stream use.
- A single recovery slot retains captured audio in memory after interruption or
  failed recognition. Completed canonical prefixes survive a failed tail. Retry
  resumes transcription for manual review and never replays text into a field.
  Starting another dictation cannot silently replace pending recovery.
- Raw recognition and transformed output are retained separately. Recovery can copy
  either when they differ. Copy/discard/retry controls explain that the target may
  already contain an acknowledged or uncertain prefix.
- Cancellation suppresses subsequent output while an in-flight operation settles.
  It does not retract a checkpoint already dispatched and is disabled once final
  delivery begins. Generation checks reject stale results after unmount. Teardown
  releases microphone tracks, callbacks, timers, graphs and pending owned preedit.

### Recognition transport and local processing

- Final, canonical and preview audio use a top-level Tauri binary body instead of
  nested typed-array JSON. `VCA1` frames carry bounded UTF-8 metadata and little-endian
  Float32 audio. Native parsing rejects malformed frames, oversize inputs and NaN/
  infinity before inference. A 30-second request has under 40 bytes of framing and
  empty-prefix metadata beyond its 1,920,000-byte audio payload.
- A conservative numerical-silence/DC gate prevents digital-silence hallucinations
  before decoder invocation. Its threshold is below PCM16 quantization. Brief or
  very quiet nonconstant signals pass; this is explicitly not a speech classifier.
- The optional local HTTP client disables proxy routing and redirects and pins
  `localhost` resolution to loopback. Transcript-bearing HTTP error bodies are not
  echoed into errors. Complete plain-text responses require `finish_reason: stop`;
  truncation, tool calls, refusal or missing completion proof preserve raw input.
- Formatting uses token boundaries, standalone commands, explicit inline `command`
  forms, quoted text protection and `literal` escapes. Ordinary phrases such as
  “new lines” and “code blocker” survive. An intentional empty `Scratch that.` result
  does not restore deleted wording or invoke an assistant.
- Optional helper processes drain stdout/stderr while supervising stdin, deadlines,
  output limits and child process groups. Large output cannot deadlock a pipe.

### Linux state and engineering structure

- Evdev tracks individual keys per device, exact Control/Super/Shift state, repeats,
  both Alt keys, disconnect/reopen identity and `SYN_DROPPED` resynchronization.
  Resynchronization does not fabricate fresh hotkey activation.
- Tray/readiness text describes verified targets and manual-copy availability for
  all output modes, without claiming that final-only output is live streaming.
- Single-instance guard teardown explicitly unlocks its own open file description.
  A concurrently forked helper cannot keep the guard's lock until its next exec.
- Capture health, recovery policy, binary transport, physical-key state, formatting,
  local HTTP processing, and process supervision now have focused modules and tests.
  The main recording hook still coordinates these responsibilities; this work does
  not claim to have replaced it with a complete native session controller.

## Verification

Fresh validation covers the working candidate, not the previously installed app.

| Check | Result |
| --- | --- |
| Rust unit and regression suite | 165 passed, including silence, transport, partial delivery, bounded pipes, device state and duplicated lock descriptors |
| Python ownership/protocol/engine tests | 81 passed: 17 ownership, 9 protocol, 55 engine; includes truthful one-shot acknowledgment |
| Private headless IBus lifecycle | Passing inside repository Bubblewrap isolation; no attachment to the active desktop |
| TypeScript, ESLint, production frontend | Passing |
| Frontend and script regressions | 205 frontend tests passed, 2 private captured-user-audio cases skipped; scoring, trace and configuration script suites passed |
| Rendered lifecycle tests | 19 scenarios passed with real React StrictMode, hook/store/recovery controls in Chromium; native, microphone and clipboard boundaries mocked explicitly; zero unexpected console messages |
| Existing-model speech gate | Eight predetermined LibriSpeech readers, 71.01 seconds, 160 independently supplied reference words; 4 errors / 160 words (2.50% normalized final WER) |
| Synthetic silence | 10/20/30-second final/canonical checks; preview checked only within its 0.7–20-second command limit |
| Dependency audit | Node: zero reported vulnerabilities. Rust: zero reported vulnerability entries, 17 unmaintained and 2 unsoundness warnings retained for tracking |
| Strict Rust lint and formatting | All targets and features passed Clippy with warnings denied; formatting passed |
| Release preflight and Debian build | Passed, including final package verification of desktop/AppStream identity, permissions, icons and exact IBus source payload |

The adjacent `foundations-evidence` directory contains the development package,
its SHA-256 checksum, source-file hashes, test logs, speech results and renderer
screenshots. See its `README.md` and `validation.json` for the delivery snapshot.
The workflows were updated and locally rehearsed; hosted CI was not triggered.

The speech set is a small regression floor, not a representative accuracy benchmark.
Its selection was fixed before inference. Public corpus references, authorship, license,
audio transformations and hashes are in [the fixture manifest](../../tests/fixtures/speech/manifest.json).
The runner records actual worker/model/manifest hashes and runtime/checkout identity.
CI and release workflows enforce both the speech and rendered-lifecycle suites.

`verify:cursor-acceptance` now fails closed on failures, unreconciled/copy outcomes,
incomplete later sessions and malformed evidence; an older successful session cannot
hide a failed or unfinished newer session. Diagnostic reporting remains separately useful.

## Remaining requirements before stronger models or broad release claims

1. **Resolve and verify first-trigger focus ownership.** The current lease identifies
   the field when IBus processes startup, not necessarily the field at the physical
   hotkey event. The passive `Alt+D` listener can conflict with browser address-bar
   focus. No authenticated trigger-time destination token or consuming portal backend
   was introduced without desktop proof. The [FOCUS-01–09 matrix](linux-e2e.md#first-trigger-focus-and-shortcut-acceptance)
   is mandatory; text reaching the wrong field is a failure even if its lease is valid.
2. **Measure installed application coverage.** Generic `FREE_FORM`/no-hint fields,
   unchanged metadata across focus changes, terminals and sensitive inputs remain
   ineligible. Do not relax that policy to manufacture a higher success rate. Establish
   GTK/Qt/browser/Electron/LibreOffice support with exact package and desktop versions.
3. **Collect independent microphone/quality evidence.** Add consented quiet/noisy,
   accented, conversational, numeric, technical and long-session recordings. Measure
   missed speech, hallucinations, correction cost and p95 latency. Noise/music VAD,
   polish semantic fidelity and WebKit/native IPC timings are not established by these
   synthetic and Chromium tests.
4. **Verify installed lifecycle behavior.** Real PipeWire restarts, suspend/resume,
   microphone unplug, scaling, keyboard navigation and screen-reader use need isolated
   desktop acceptance. Renderer restart clears volatile audio by design; persistent
   recovery would require a separate explicit privacy/retention decision.
5. **Track upstream maintenance.** Existing Rust warnings include
   `RUSTSEC-2024-0429` (`glib` 0.18.5, `VariantStrIter`) and `RUSTSEC-2026-0097`
   (`rand` 0.7.3, custom-logger reentrancy), plus GTK-related maintenance warnings.
   A clean vulnerability count does not resolve these warnings. Assess reachability
   and supported upstream migrations before any stack upgrade.

Crabbox remote desktop verification was unavailable because the configured cloud
provider credentials were absent. No live microphone/input injection, application installation,
service restart, commit, push or release publication was performed. Current automated
evidence supports a materially stronger candidate; it does not close the pending native
desktop matrix or substantiate a “best in the world” claim.

## Compatibility notes

- IBus eligibility now applies to all automatic text modes. Existing helper strategy
  configuration is preserved for integration compatibility; its misleading automatic
  dictation dropdown was removed.
- Inline spoken commands require `command …`; literal mentions can use `literal …`.
- Local model servers must report completed output explicitly; incompatible responses
  fall back to the raw transcript.
- After eventually installing a candidate with changed engine code, restart IBus in
  the isolated validation session. A previously resident engine may otherwise report
  an old one-shot acknowledgment and conservatively trigger recovery.
- Package metadata remains 2026.0.21 for this development candidate. Assign and verify
  a new release version before publishing; do not confuse this artifact with the
  already published 2026.0.21 package.
