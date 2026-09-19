# Capture admission and local recovery

Accepted scope: the owner approved the bounded reliability milestone on 19 September
2026. Public 2026.0.39 is frozen; this implementation is candidate 2026.0.41.

## Problem

The default NVIDIA route could start automatic delivery after AudioWorklet setup
failed, even though the ScriptProcessor fallback could not establish complete
capture. Explicit recovery then used unbundled Whisper, so a clean offline install
could dictate normally but fail when recovery was needed most.

## Decision

Capture admission is a typed startup outcome: pending, automatic, or manual-review.
Only automatic admission creates the NVIDIA delivery queue. Fallback samples stay
available for explicit review/retry; legacy preview guards remain in force too.

`NvidiaRecovery` recognizes retained source samples at their recorded rate. It owns
one UUID and ordered bounded requests, never a target or paste callback. It publishes
only the finish result. Cancellation returns the UI to recovery immediately while
the current native request settles; subsequent retry waits for cleanup. Discard or
renderer replacement cannot be overwritten by a late result.

`recover_stream` reuses the native worker supervisor, pinned Python runtime and
model in a private recovery slot. It validates operation, identity, sample rate,
finite samples and total limits. A new explicit Start may supersede abandoned
recovery, while stale push/cancel cannot disturb that replacement. Finish, failure
and cancellation reap the recovery worker. The ordinary live worker stays separate.

The tradeoff is a temporary second model process during recovery. Sharing the live
slot would save memory but couple recovery cancellation and replacement to live
recognition ownership. Reusing the bounded supervisor avoids a second protocol or
recognizer implementation. Model, context, thread count and normal streaming cadence
remain unchanged. Browser/legacy routes retain their Whisper contract.

## TypeSafe guidance applied

The [TypeSafe building guide](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
recommends keeping known rules/control flow in code and using narrow structured
judgments only where semantic interpretation is required. Capture completeness,
session ownership and permission to paste are observed facts and policy, so no AI
judgment is inserted into those gates. The [confidence guide](https://docs.typesafe.ai/confidence)
also motivates keeping uncertainty explicit instead of presenting an uncertain
operation as successful. Typed interfaces alone do not guarantee correct behavior;
the tests must exercise consequences.

No TypeSafe API, credential, cloud transcription or new dependency is introduced.
Semantic evaluation against synthetic/public reference transcripts remains a
separate optional experiment, not a requirement for this reliability milestone.

## Required evidence

- Worklet module and construction failure on default NVIDIA: no automatic inference
  or paste, original audio available, explicit local retry with no insertion.
- Healthy Worklet/native and browser/legacy compatibility regressions.
- Recovery cancellation, transport failure, retry, disposal, late response, malformed
  response and stale native-session cleanup; source sample/rate preservation.
- Complete source checks including the existing Whisper accuracy gates.
- Complete pinned-runtime Debian package and its exact hashes; isolated normal
  delivery and worker-failure recovery without a Whisper cache or network.
- Physical microphone/default compositor/owner applications remain a distinct
  acceptance step. Isolated X11 evidence cannot substitute for that acceptance.

No publication, installation on the owner desktop, retagging or hosted Release
workflow activation follows from passing these checks.

## Candidate packaging guard

The qualification build exposed host-native Whisper cache settings in the current
build path. Restore the existing portable CPU CMake include and invalidate only
Whisper release objects before packaging. The candidate baseline remains AVX2,
FMA and F16C; this is not a promise of support for every x86 CPU. Frozen public
artifacts and source cuts are untouched.
