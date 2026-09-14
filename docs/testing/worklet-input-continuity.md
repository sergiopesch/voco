# Worklet input continuity

WebKit capture distinguishes digital silence from an absent input channel. Empty process
calls before the first nonempty input are allowed. Once input has arrived, a missing or
zero-length channel interrupts that recording. Present zero-valued samples remain valid
audio; amplitude, repeated values and wall-clock callback intervals do not decide continuity.

On an observable interruption, the worklet seals the received prefix and reports the
interruption before transferring its buffered remainder. Resumed input is not concatenated
across the missing interval. The dictation hook cancels automatic output, retains received
audio, and offers the existing manual Retry/Discard controls. Retry cannot recover missing
audio and does not insert its result automatically. The interruption notice remains visible
after Retry, including when a later flush acknowledgment is also missing.

A normal flush seals the producer before transferring the final buffer and reports
`{type: "flushed", complete: true}`. An interrupted producer reports `complete: false`.
Missing completion status does not confirm a healthy capture. Repeated flush requests do
not duplicate samples, and process callbacks after sealing cannot append audio or introduce
a false interruption. Current worklet/session identity guards reject stale messages.

Run `node --test scripts/audio-worklet-capture.test.mjs` for the real worklet's input and
transfer contract. This suite is included in `npm test`. Run `npm run test:dictation-renderer`
for the actual hook, store and recovery components with native/media mocks and a bridge
executing the same worklet source. Keep evidence outside the checkout using
`VOCO_RENDERER_EVIDENCE_DIR`. These checks cover exact received-prefix retention, valid
silence, Stop/flush and stale-session behavior, manual recovery and late local operations.

This contract detects an absence explicitly delivered to the worklet. It cannot establish
upstream microphone completeness or detect plausible nonzero duplicated/shifted samples
delivered by a browser. The five-second liveness watchdog and ended/mute handling remain
separate. Full-wave installed WebKit continuity, native raw/ACK/renderer qualification and
consented physical-microphone testing retain their own gates. No speech model, resampling,
backend default, device permission or destination eligibility rule changes here.
