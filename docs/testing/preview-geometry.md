# Preview timestamp geometry

Historical design record for the retired snapshot-preview decoder. The current
Nemotron path uses the bounded append-only stream in `dictationRecording.ts` and
`benchmarkPhraseQueue.ts`. The obsolete preview modules and their exclusive tests
were removed during the September 2026 release-readiness audit. The scenarios
below explain the earlier design and do not describe current execution.

A live preview is decoded from a fixed audio snapshot. Capture can continue while resampling and inference are pending, so the current capture count at response time is not the extent of the decoded audio.

Before async preparation, the hook retains the collected source endpoint. The prepared 16 kHz sample count and original source count/rate define the bounds used for sealing. Every segment must have finite, nonnegative, ordered, nonoverlapping timestamps within both extents. The existing millisecond-to-source conversion must also remain inside the source snapshot. A valid window advance uses this fixed endpoint, never audio that arrived during inference.

When geometry fails, the hook keeps the returned text provisional and refuses new sealed confirmation or audio-window advancement. It preserves already confirmed text and leaves the native response untouched; it does not clamp timestamps or relabel a defective response as valid. Canonical processing remains authoritative. Repeated invalid previews may remain provisional longer.

The regression fixture records a real preview with 16,384 prepared samples (1,024 ms) but a returned segment ending at 2,000 ms. Tests supply matching prior text and additional capture while the response is pending to demonstrate the reachable unsafe advancement. This constructed history does not claim that the observed recording actually skipped audio, nor that the returned words were acoustically correct.

`livePreviewWindow.geometry.test.ts` checks geometry and provisional preservation. `useDictation.previewGeometry.test.ts` calls `createLivePreviewRunner` and executes collection, deferred resampling, deferred inference, and sealing. It checks nonzero source anchors, 16/44.1/48 kHz rates, late capture preservation, and normal valid sealing. These tests mock native inference and owned-preedit delivery; they do not qualify native timestamp accuracy or real desktop insertion.
