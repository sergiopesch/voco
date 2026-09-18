# Preview scheduling and cancellation

Audio arriving during a recording must not postpone an existing preview deadline
when there is no canonical work to perform. Previously, every no-work canonical
pump still created a promise whose finalizer replaced the preview timer. Frequent
2048-sample capture batches could therefore prevent previews from running at
44.1 and 48 kHz, and stall later previews at 16 kHz.

The pump now checks the two existing planners before taking ownership. With no
work, it leaves the preview timer alone. Actual canonical work retains its existing
pause, wait and resume behavior. Planner errors still enter the original
asynchronous deferred-checkpoint error path.

A preview also checks its session token after asynchronous resampling and before
queuing native recognition. Stop, Cancel or a canonical checkpoint can invalidate
the token while preparation is pending. Such work must not enqueue a stale native
request. The existing post-inference token check remains necessary for recognition
that was already running when invalidation occurred.

## Regression checks

```bash
npm run test -w apps/desktop -- src/hooks/useDictation.previewScheduling.test.ts src/hooks/useDictation.previewCancellation.test.ts
npm run test -w apps/desktop
npm run lint -w apps/desktop
npm run build:frontend -w apps/desktop
```

The focused tests call `createLivePreviewSchedule` and `createLivePreviewRunner`
with controlled timers, deferred preparation and session state. They cover initial
and subsequent deadlines at 16, 44.1 and 48 kHz, canonical work, source-block
preparation, planner errors, invalidation before and after native enqueue, normal
delivery, and retained audio. They require no microphone or new public hook API.

Mounted verification additionally exercised the unchanged audio processor and the
browser resampler. The six-second input was paced against elapsed time, with full
sample coverage and measured batch arrival intervals. All three rates reproduced
the original starvation and passed with the fix. Earlier high-rate probes were
stretched by browser timer limits and are retained separately from this result.

## Qualification limits

These fixes restore legitimate preview work; they do not make native inference
interruptible or guarantee decoder latency. Stop still drains an already running
preview before canonical inference. A separate mounted test of an isolated
recognition candidate with the pinned model missed the first-text target while
passing its subsequent-update gap target; that decoder candidate is not part of
this frontend change.
Neither mocked owned-preedit acknowledgements nor DOM frame observations establish
actual Linux destination visibility. Physical microphone, desktop, complete capture
and comparative quality qualification remain required.
