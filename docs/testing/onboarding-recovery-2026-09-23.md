# Onboarding handoff and interrupted dictation review — 23 September 2026

## Findings and changes

1. **Done presented an unnecessary Ready window.** `ControlPanel.prepareFirstDictation`
   explicitly requested the popover. It now requests the existing hidden surface
   after successful test, desktop readiness and configuration save. Window sync
   records `onboarding_handoff_hidden`; the native allowlist matches. The regression
   checks completion without another show/focus request, and explicit launcher
   activation still opens the idle app.
2. **A failed paste also stopped recognition.** `BenchmarkPhraseQueue` used one
   failure latch for delivery and recognition. Capture could continue while later
   samples were no longer transcribed, then Stop surfaced the old error. Delivery
   failure now permanently disables insertion for that session while healthy
   recognition receives every subsequent sample and the Stop tail. Worker/protocol,
   prefix-revision, backlog and capture failures remain bounded failures. There is
   no automatic retry, target rebinding or replay of uncertain text.
3. **Recovery interrupted the user's work with a window and duplicate errors.**
   The first retained-recovery transition now notifies and uses the hidden surface.
   Active delivery interruptions notify promptly; failures first detected during
   Stop produce the saved-dictation notification only. Tray/launcher review remains
   explicit, and a blocked recording restart only reminds the user. Explicit
   recovery/retry keeps its requested panel open. That panel uses “Dictation saved,”
   keeps copying/recovery actions, and puts the reason under “What happened” instead
   of duplicating it in a separate error banner. Audio-retention and partial-delivery
   warnings remain visible. Notification bodies contain no dictated text or raw errors.

## What the owner-session inspection establishes

The installed package was **2026.0.56**. The same application process remained alive
across the reported incident. No matching crash dump, OOM or process-restart evidence
was found. This supports a handled recovery event, not a confirmed application crash.
The installer-launched process had stdout/stderr directed to `/dev/null`, and optional
performance traces were absent. The exact error and destination application could
not be recovered from that session; the queue regression is **not proof of the exact
historical trigger**.

Manual corrections are not model prefix revisions. Desktop delivery prepares a fresh
bounded observation for each insertion. Editing during an outstanding paste/readback
can make that receipt uncertain; destination checks must not be weakened to suppress
that error. The optional Chromium exact-field route deliberately invalidates its
lease on external edits. The fix preserves subsequent local recognition in either
case without replaying output over edits.

## Regression evidence

Baseline: `f8bba08ed0d9e8537bcd6497b47cb5f88f7e734f`; local branch
`fix/onboarding-handoff-review`. Existing release assets and the installed profile
were not changed. Evidence is retained in the private `onboarding-stop-review-2026-09-23`
run directory; it includes original attempts and failures, not just final successes.

- The onboarding regression failed with actual `popover` versus expected `hidden`
  before the production change. A prior attempt labeled red accidentally ran the
  unchanged fixture; its correction note is retained and it is not counted as a red.
- The delivery regression failed before the change because only the initial phrase
  was observed. The candidate recognizes later audio, including a partial final
  packet, makes no further paste attempt and retains the original rejection.
- Renderer coverage exercises actual React hooks, store and components with explicit
  native/media/recognizer doubles. It includes a five-minute simulated stream and a
  delivery rejection at two minutes followed by another three minutes of audio plus
  a 701-sample Stop tail. These are accelerated sample-volume tests, not physical
  microphone or native-model inference trials.
- Onboarding: **19 passing cases**; full native-capture renderer: **57 passing cases**.
- Dictation/recovery renderer: **17 passing cases**, including hidden recovery,
  notification counts, explicit panel review, cancellation, retained capture warnings,
  uncertain browser receipt, no automatic retry and a blocked restart.
- TypeScript check, ESLint, frontend build: passed. Frontend tests: **393 passed**.
- Rust library tests: **281 passed**, one fixture-export test explicitly ignored
  because it requires a dedicated export environment. Clippy with warnings denied:
  passed for project code; existing vendored GLib warnings remain dependency output.
- Focus-cache and delivery-observation tests: **79 + 63 passed**.

The first native test build failed because `libpulse.pc` was unavailable on the host.
The successful rerun used the existing local release development dependency bundle;
no host packages were installed. A private desktop application trial could not start
because Xvfb was missing. It is **unavailable, not passed**.

## Sustained real recognizer trial

A separate subprocess used the installed pinned model/runtime, four CPU threads and
100 ms packets. A pinned short public speech fixture was looped with silence;
this is a duration/protocol trial, not a natural long-speech accuracy evaluation.
No microphone, clipboard or destination was opened. One session sent **330.0438125 seconds** including
a partial final packet, followed by a second short session in the same worker.

The first real-time-paced trial overlapped compilation and ran at lower scheduling
priority. It completed both sessions, retained append-only hypotheses and finished
in approximately 103 ms, but its maximum ingress age was **17.4 seconds** (288 packets
exceeded three seconds). The harness can queue longer than production: this is a
contention result, **not a clean pass of VOCO's three-second backlog contract**.
The original failure/exposure is preserved; it must not be hidden by a later rerun.

The repeat without build contention completed the same 330.0438125 seconds and
second session with **zero prefix revisions**, **8.9 ms maximum ingress age**,
**108.7 ms maximum push latency** and **97.7 ms finish latency**. No packet exceeded
three seconds of ingress age. Maximum sampled worker RSS was **965.3 MiB**. The worker
exited cleanly after EOF in both runs. This qualifies the installed worker at this
fixture boundary, not the changed desktop package or the owner's manual-editing flow.

## Remaining boundaries

- A recording is still bounded to **ten minutes** and at most **33,554,432 source
  samples** (128 MiB); unusually high capture rates can hit the memory limit earlier.
  This does not explain a reported two-to-five-minute event. Unlimited continuous
  dictation would require bounded session rotation and capture/worker/lease
  qualification, not removal of these guards.
- A healthy model cannot guarantee paste receipt during simultaneous manual edits,
  focus changes, recipient stalls or unsupported editors. Recovery never proves
  text reached its destination and must not automatically replay it.
- Notifications depend on desktop notification availability; the tray and launcher
  remain the review entry points. Retained audio/text is in memory and is lost on exit.
- No end-to-end owner microphone/editing reproduction or newly packaged WebKit test
  was performed in this review. Public **2026.0.56** remains unchanged. A new release
  still needs a version, complete package qualification, required CI and signatures.
