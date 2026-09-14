> **Earlier combined laptop candidate checklist.** Versioned findings below are retained for provenance; use [current candidate gates](../release-candidate.md) for 2026.0.35 status and release authorization.

# Combined laptop testing — 2026.0.26

The 2026.0.26 candidate includes all the rounds below. Earlier version sections are
historical receipts; follow the latest installation status at the end of this file.

This local candidate includes the UI/UX work from the **Review VOCO branding** task,
the application foundations, and the metadata-only performance recorder. The
integration workspace is `foundations-application`; the older `branding-refinement`
workspace remains a preserved design source. Do not install its older backend package.

## Engineering checks

- [x] Integrate the selected Crystal Sidebar, silver microphone and eight settings pages.
- [x] Preserve default glass and OS accessibility fallbacks.
- [x] Preserve microphone/capture ownership, Copy, cancellation and recovery behavior.
- [x] Include unsaved settings protection and recording-start feedback.
- [x] Include opt-in bounded metadata-only performance logs and report command.
- [x] Finish packaged runtime checks for manual Copy, streaming, focus loss and Chromium.
- [x] Verify the installed app identity after administrator authentication; 2026.0.26 matches the tested GUI/helper hashes and is running with performance logging.

The delivery folder records commands, results, screenshots and package checksums.
A fixture or automated pass is distinct from the physical laptop tests below.

## Your laptop test sequence

- [ ] Open Overview, visit all eight pages, resize the window, and inspect readability.
- [ ] Change a text setting, try hiding, and exercise Keep editing, Save, and Discard.
- [ ] Check the microphone, change devices, and test permission/retry if applicable.
- [ ] Start/stop from the tray and the shortcut that the app reports as available.
- [ ] Dictate a short sentence, copy it, paste it, verify the words, then clear it.
- [ ] Try natural speech, pauses, punctuation, a longer passage, and rapid stop/restart.
- [ ] Cancel a recording; review the recovery, retry transcription, and discard it.
- [ ] Test Chromium direct delivery in an enabled plain text field, then switch focus.
- [ ] Test system reduced motion/increased contrast if used, and keyboard navigation.
- [ ] Note time, what you tried, expected/actual result, and perceived responsiveness.

For performance, compare cold and warm first text, stop-to-completion p50/p95,
recognition duration versus audio duration, failures/recoveries, input gaps, lost
log events, CPU and peak RSS. Resource samples cover the Rust process only; WebKit
and helpers are excluded. Accuracy requires a known reference and human correction
counts. UI quality and battery impact require separate observation or measurement.
No single log can establish that every feature works or the app is fully stable.

Use [laptop-performance.md](laptop-performance.md) for the exact recorder and report
commands. Keep a test note alongside logs without putting dictated text into telemetry.

## Improvement round — 2026.0.23, 13 September

The next local candidate is built and tested; the separately installed laptop app
remains 2026.0.22 until upgraded. Candidate and evidence:
`../../../testing-improvements-2026-09-13/` (from this document).

- [x] Separate browser delivery revocation from recording release; cancellation of
  writes preserves the original Stop token. Keep stale-field rejection unchanged.
- [x] Exercise revoke → repeated Stop, revoke → toolbar disable, final release →
  fresh trigger, and native idempotent Stop. Chromium: 203 cases passed.
- [x] Record fixed Start/Stop admitted/rejected categories, without token/text
  logging. Admission is phase/authorization validation, not a completed recording.
- [x] Run original long natural-speech browser gate with normal Alt+Shift+V Stop:
  recovery and next recording passed; 4 edits / 88 words (4.55% WER).
- [x] Run a second long fixture containing 16 repeated phrases: all 16 retained,
  64/64 words, no omissions or additions; Stop/recovery/next recording passed.
- [x] Verify packaged capture → transcription → actual Copy; no destination field
  mutations. Test audio and clipboard are private fixtures, not personal data.
- [x] Run 379 frontend tests (two existing skips), 303 Rust tests, 57 dictation
  renderer scenarios, 26 microphone/settings scenarios, type checks, lint, Clippy,
  version consistency, production build, and Debian package verification.
- [x] Refine first-paint diagnosis: isolated X11 panel is initially clipped, but
  paints fully after an additional 0.1-second wait without interaction. This is a
  transient paint issue; no UI fix or normal-Wayland verification is claimed.
- [ ] Reduce Stop latency with safe cancellation/prioritization of preview work.
  In one natural run, an in-flight preview continued for ~890 ms after Stop;
  final decoding began ~907 ms after Stop and took ~2.10 s. Do not remove the
  wait without preserving decoder/session ownership and late-result safety.
- [ ] Profile streaming resource cost: natural run median backend CPU ~483% of one
  core, peak RSS ~704 MiB. These include the short recovery test and exclude
  WebKit/Chromium. No performance reduction is claimed by this correctness fix.
- [ ] Verify first paint, physical microphone, suspend/resume, device changes and
  extended repeated usage on the normal laptop desktop.

Read the detailed metadata in `long-natural/performance-report.json` and
`long-repeated/long-accuracy.json` under the evidence directory. The old failed
Stop receipt remains in the 12 September review directory. The new packaged
executable and browser extension hashes are recorded with each native test.
Reload the matching unpacked extension and test tab when testing the new package.

## Core performance round — 2026.0.24, 13 September

Latest candidate and detailed evidence: `../../../performance-core-2026-09-13/`.
The installed laptop app remains 2026.0.22; these measurements use extracted
candidate packages in the private X11/Pulse/Chromium harness.

- [x] Reuse a preview only for identical session/generation/rate/source bounds;
  new audio still decodes. Stop, cancellation and discard clear the cache.
- [x] Use padded preview contexts up to 20 seconds, with one fallback through the
  original decoding policy if the smaller context fails. Preserve final/canonical
  settings and rejection safeguards.
- [x] Close an acceptance gap: a live-preview failure now fails the browser test
  even if the final transcript passes. Retain the rejected experimental receipt.
- [x] Compare two 2026.0.23 runs with two final 2026.0.24 runs on the same natural
  fixture and flow. Backend process CPU totals averaged 241.29 → 164.87 CPU-seconds
  (31.7% lower); first visible text averaged 1.684 → 1.246 seconds (26.0% sooner).
  Final accuracy remained 4 edits / 88 words (4.55% WER); no preview failures,
  dropped log events, sequence gaps, or unfinished native requests were observed.
- [x] Repeat the long test with 16 repeated phrases: all 64 words retained with
  zero edits, no preview failure, and successful Stop/recovery/fresh recording.
- [x] Verify final packaged capture → transcription → actual Copy on the private
  desktop; the correct fixture text reached the private clipboard.
- [x] Verify 305 Rust tests, 381 frontend tests (two existing skips), 57 dictation
  renderer scenarios, type checks, lint, Clippy, build and package verification.
- [ ] Further reduce Stop latency. Accepted natural runs took 2.087–2.098 seconds
  after Stop, compared with 2.188–2.962 seconds in the two baseline runs. Final
  decoding still dominates; this does not establish a universal Stop-time gain.
- [ ] Reduce peak memory with an accuracy-preserving, separately measured change.
  Peak RSS varied: baseline 655–687 MiB, candidate 605–679 MiB; no firm memory or
  battery-life improvement is claimed.
- [ ] Measure physical-microphone accuracy, difficult/noisy speech, long sessions,
  normal desktop behavior and whole-app/battery cost on the actual laptop.

The initial cache-only run saved only 0.3% CPU time. A subsequent short-context
experiment reduced CPU by stopping previews after a failure; that result is
**rejected**, not counted as a performance improvement. The accepted candidate
adds the bounded original-context fallback and passes the stronger preview gate.
The 11 eligible complete-phrase decoder fixtures showed unchanged canonical words;
one preview changed the valid spelling “honor” to “honour” (strict preview WER
8/191 → 9/191). The twelfth fixture is 20.22 seconds, beyond the preview limit.

## Diagnostics readiness round — 2026.0.25, 13 September

Evidence and candidate: `../../../diagnostics-review-2026-09-13/`.

- [x] Split reporting by recording/session epoch and native request outcome.
- [x] Measure reduced-context/fallback attempts, including failed attempts, without
  logging speech; distinguish missing observations from zero fallback use.
- [x] Instrument sequential Stop waits for checkpoint, preview and insertion work.
- [x] Report writer queue delay, CPU sample coverage and resource counter deltas.
- [x] Reject malformed payloads, exclude duplicate records and flag failed previews
  even when final output is correct. Reprocess both accepted and rejected old logs.
- [x] Specify workload, build/model identity, power/background conditions and
  independent accuracy/delivery gates before the next comparison; see
  [the required test inputs](laptop-performance.md#required-inputs-for-the-next-performance-comparison).
- [ ] Collect a broader matched test matrix and physical-microphone evidence with
  the new fields. Installed 2026.0.22 cannot emit 2026.0.25 diagnostics.

New diagnostics do not change recognition policy or UI direction. Their purpose is
to distinguish actual decoding cost, fallback cost, Stop blocking and incomplete
measurement before another performance change is accepted.

Fresh 2026.0.25 natural-speech qualification passed with all 56 native previews
reporting attempt metadata, both recordings reporting all three Stop waits, no
preview failure, and unchanged 4/88 final WER. A successful fallback exposed a
3.756-second preview: 3.171 seconds in its initial policy attempt plus 0.585 seconds
in the original-context fallback. Long Stop → final was 2.054 seconds, including
1.994 seconds in the frontend final-transcription path; prior-work waits rounded
to 0 ms. These are diagnostic observations, not a new performance improvement
claim. Tests: 307 Rust, 381 frontend (two existing skips), 57 rendered dictation
scenarios, and 11 report tests; type checks, lint, Clippy and packaging passed.

## Rounded UI and installation round — 2026.0.26, 13 September

Candidate and evidence: `../../../rounded-install-2026-09-13/`.

- [x] Apply shared window/control corner defaults; remove square settings-shell,
  readiness action, popover state, settings-row and nested-group overrides.
- [x] Clip the settings texture explicitly at the rounded boundary for WebKit.
- [x] Give checkbox controls rounded corners while retaining native semantics,
  Space activation, checked/disabled states and forced-colors visibility.
- [x] Audit 17 rendered states across eight settings pages, narrow layout, popover,
  recovery, three onboarding steps, configuration recovery, overlay and high contrast.
  No square visible audited controls or browser console errors remained.
- [x] Verify navigation, disclosure, keyboard focus and checkbox interaction.
- [x] Pass 381 frontend tests (two existing skips), production build, version and
  Debian package checks. Backend behavior is unchanged from 2026.0.25.
- [x] Verify exact packaged WebKit capture → transcription → actual Copy; inspect
  the packaged settings window on the private X11 desktop.
- [x] Pass the exact packaged long browser flow including focus loss, Stop,
  retained recovery and fresh recording. Natural final accuracy: 4 edits / 88 words
  (4.55% WER); no failed previews or dropped diagnostic events.
- [ ] Verify normal Wayland desktop appearance, physical microphone, hotkeys,
  device changes, suspend/resume and sustained use with the installed candidate.

The fixture run measured first text at 1.242 seconds and Stop → final at 2.056
seconds. These are one-run diagnostic observations, not a new performance gain.
Private X11 screenshots do not certify normal Wayland compositing. Desktop-owned
menus follow the system theme; the corner changes concern VOCO-owned surfaces.

For manual testing, follow the sequence near the top and note the time and test
category. Include a cold start, several short warm recordings, a longer passage,
rapid Stop/restart, cancellation/recovery, and switching field focus. Reload the
matching packaged extension and test tab before testing browser direct delivery.
The package update itself does not establish that a user's browser has enabled it.

Installation verified at 08:29 UTC on 13 September: Debian replaced 2026.0.22 with
2026.0.26; the old process exited and the new app is running on the normal Wayland
session. GUI, helper and packaged extension files match the tested candidate.
Settings and the model are unchanged. The user launcher enables performance logging.
The fresh log identifies 2026.0.26 and the exact tested GUI SHA-256, with frontend
initialization and hotkey-handler readiness observed. No physical recording was
made by this install check; `no_active_recording_observed` is expected until testing.

- [x] Install and launch the final tested 2026.0.26 package with local diagnostics.
- [x] Verify old process exit, exact running binary, configuration/model preservation,
  frontend startup and new-run diagnostic metadata. See `INSTALLED-AFTER.json` and
  `installed-performance-report.json` in this round's evidence directory.


## Physical manual review — Codex desktop editor, 13 September

The user dictated into this Codex desktop app, not a Chromium webpage. Two recordings
at approximately 09:33:42 and 09:35:20 BST completed recognition but both reported
cursor ownership unavailable and retained a manual transcript. The requested
end-to-end outcome **failed**: no words appeared in the editor. Native automatic
IBus mutation is explicitly disabled; installing or selecting its input source
does not enable it. The packaged Chromium adapter does not cover this editor.

- [x] Preserve and correlate both manual recordings with hotkey/lifecycle/decoder logs.
- [x] Distinguish recognition success from target delivery in the performance report;
  14 report tests and retained browser/native regression receipts passed.
- [ ] Deliver dictation automatically into the supported native Codex editor with
  a verified target-specific integration or a separately agreed native delivery
  contract. Re-enabling the known redirecting IBus path is not a validated fix.
- [ ] Remove the automatic transcript preview from the normal cursor flow. Keep
  recording status unobtrusive and non-focus-taking; recovery should be deliberate.
- [ ] Explain an unsupported target before the user speaks instead of implying the
  dictation will arrive there. Do not advertise app-wide cursor support prematurely.
- [ ] Verify physical speech reaches Codex's actual editable field, without automatic
  submission, and verify focus changes, replacement, Stop/restart and recovery.
- [ ] Add fixed metadata reason categories for early shortcut rejection and cursor
  unavailability, plus separate recognition-ready and target-commit timings.
- [ ] Repeat matched capture modes and workloads to assess decoding/Stop CPU cost.

See `../../../manual-review-2026-09-13/REVIEW.md` for exact times, evidence, diagnosis
and remaining measurement limits. At that review, 2026.0.26 remained installed; the report
improvement was a repository-side analysis change. The subsequent 2026.0.27
activation is recorded below.


## Native desktop delivery candidate — 2026.0.27

- [x] Remove the automatic transcript preview during dictation and processing;
  preserve the tray state and explicitly opened recovery/settings surfaces.
- [x] Prepare an opt-in final desktop-paste route with helper preflight, Unicode
  clipboard transport, no Enter key and no retry after uncertain dispatch.
- [x] Fix legacy Ubuntu ydotool chord compatibility before clipboard mutation.
- [x] Skip unused preview decoding for native final-paste sessions while retaining
  the browser exact-field flow and its focus-loss behavior.
- [x] Add honest paste-dispatch diagnostics, without claiming an editor receipt.
- [x] Verify 375 frontend tests (two existing skips), 308 Rust library tests,
  61 dictation renderer cases, 31 actual-App cases and 15 report tests.
- [x] Build and verify the Debian candidate; test packaged native capture/paste,
  current-focus switching and the existing browser delivery/recovery flow.
- [x] User approved clipboard/current-focus semantics; installed and enabled
  2026.0.27 on the normal laptop. Verified running binary identity, preserved
  settings/model, performance logging and hotkey readiness.
- [x] Correct the GNOME clipboard timeout in 2026.0.28; verify production paste
  code in native Wayland single-line/multiline controls with exact Unicode readback.
  Install 2026.0.28 plus the tested xclip dependency and verify startup diagnostics.
- [ ] Verify actual Codex and the user's other target applications. Broad
  paste compatibility is not universal application certification.

[Desktop-paste behavior and limits](desktop-paste.md) ·
`../../../desktop-delivery-2026-09-13/README.md` for package and evidence.


## Progressive dictation and automatic terminal paste — 2026.0.29

- [x] Review the six completed .28 manual tests, retaining content-free logs and
  separating user-reported editor acceptance from helper dispatch.
- [x] Route known terminal targets to Ctrl+Shift+V without changing Ghostty settings;
  verify exact Unicode through the production paste code in real Wayland Ghostty.
- [x] Queue speech phrases while recording, append once, flush only the tail at Stop,
  and retain recovery without retry after uncertainty.
- [x] Reject a 300 ms pause trial that lost recognition quality; validate the 450 ms
  setting against the same eight fixed reference clips and existing final decoder.
- [x] Verify packaged capture to Whisper to live target text before Stop, followed by
  the tail without duplication. Keep the hidden tray interface during dictation.
- [x] Verify 379 frontend tests, 64 hook renderer cases, 31 actual-App cases,
  310 Rust library tests and 16 performance-report cases.
- [x] Install and activate the verified .29 package; verify running binary identity,
  unchanged settings/model, progressive/paste/logging flags and hotkey readiness.
- [ ] Manually test progressive delivery in Codex, Brave and Ghostty; include natural
  pauses, continuous speech, quiet speech, numbers and cancellation after one phrase.
- [ ] Expand automatic compatibility beyond the tested targets, and improve delivery
  acknowledgement for editors with limited/inaccessible focus metadata.

- [ ] Profile WebKit idle activity separately from Rust: an eight-second .28 idle
  sample observed 4.75% of one CPU core in WebKit. The cause is not established.
- [ ] Reduce Wayland keyboard-dispatch overhead after matched measurements: one
  .29 Ghostty fixture measured 406 ms for the keyboard helper versus 5 ms clipboard
  writing. Target probing and preflight are additional costs.

Evidence and current installation receipt: `../../../streaming-review-2026-09-13/REVIEW.md`.


## Codex live-text correction — 2026.0.30

- [x] Confirm .29 paste works in Codex after Stop; isolate absent pre-Stop scheduling.
- [x] Add bounded periodic agreement-gated recognition during continuous speech.
- [x] Coalesce speculative work, prioritize finalization and preserve cancellation,
  uncertainty and recovery without automatic replacement of inserted text.
- [x] Correct audio ranges when a callback contains multiple phrase boundaries.
- [x] Add regression checks for continuous speech, final suffix, slow decoding,
  changed final wording, cancellation and repeated phrases.
- [x] Verify the final packaged continuous-speech test: text before Stop, 47/47
  reference words, no duplicated join punctuation, and untouched second field.
- [x] Install and activate .30; verify tested binary identity, unchanged settings/model,
  live-stream/paste/logging flags and hotkey readiness on the normal laptop.
- [ ] Retest physical speech in Codex; expect agreed text after decoder latency while
  still recording, then the remaining words after Stop. Keep the destination focused.
