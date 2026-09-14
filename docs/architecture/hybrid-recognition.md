# Hybrid recognition and audio ownership

The application uses the existing local base.en model. `transcribe_audio` invokes
`WhisperState::transcribe_hybrid_full`; stable cursor checkpoints use the strict
`transcribe_hybrid_chunk` VCA2 command. Both execute the same native planner, bounded
decoder recovery and seam-aware text join. Legacy `transcribe`, VCA1 canonical calls
and provisional previews remain available with their prior contracts.

## Prepared audio and recognition coverage

Canonical source preparation keeps its original first 30-second block and subsequent
29-second blocks, including the existing DC-removal and resampling profile. Ordinary
full-capture preparation retains its separate profile. Neither path changes gain,
re-quantizes samples or adapts an earlier prepared block to later audio.

The planner examines at most 480000 prepared samples. A closed, frame-aligned numerical
plateau of at least 200 ms can provide a midpoint with at least 1.5 seconds on either
side. This is a numerical boundary rule, not a speech detector. Otherwise it consumes
the full horizon and retains 16000 samples as context. Once that overlap cadence begins,
later windows keep it. Initial and disjoint results append literally; overlapping results
use the existing canonical overlap join. Repeated words are not globally deduplicated.

`previousDecodedEnd` records successfully consumed audio; `nextInputStart` includes any
required overlap. They must not be interchangeable. A receipt can consume less than the
offered horizon. At exactly 30 seconds, a complete fallback receipt already covers the
input even though its next input start points one second backward. Stop must not decode
that context alone. One additional sample requires a 16001-sample final request.

## Request and state ownership

VCA2 is an eight-byte header (ASCII magic and little-endian metadata length), strict
UTF-8 JSON metadata, then finite little-endian f32 PCM. Metadata is limited to 1 MiB,
each request to 1..480000 samples, and absolute session coverage to 9600000 samples.
Unknown or duplicate fields, unsafe numeric identities, impossible restored progress,
invalid finality and inconsistent payload lengths are rejected before model loading.
The checked restoration constructor establishes numerical possibility; it cannot prove
the caller's history or destination ownership.

The frontend owns immutable pending PCM, prior recognized text and planner progress.
Each attempt has a separate positive request sequence. Successful planner sequence
advances only after receipt, identity and exact prefix/append validation. A failed
attempt retains the same private bytes; retry cannot silently substitute newly prepared
audio. The returned metadata and packets cannot alias caller-mutable storage.

Resampling allocation and the preprocessing ledger use the same exact ceiling of
`sourceFrames * targetRate / sourceRate` for integer rates. For example, 6,021 frames
at 48 kHz produce 2,007 frames at 16 kHz; computing duration first can incorrectly
request 2,008 through floating-point rounding. Fractional ledger metadata retains
its previous arithmetic. This count correction preserves the current WebKit filter
and DC-removal policy; it does not establish anti-aliasing quality. The isolated FIR
resampler remains outside this application because its natural-speech comparison
showed per-recording regressions despite aggregate parity.

The canonical session owns one recognition state, a separate preprocessing ledger and
target acknowledgment. A preparation ticket is captured before resampling and checked
against the current ledger before synchronous PCM publication. Every actual cache clear
or drain invalidates its generation and ledger. Completed transcript ownership survives
a successful drain; a released cache cannot accept more preparation or decode work.

Preview anchors map actual decoded coverage through observed source/prepared block
extents. If a 30-second lookahead first decodes only seven seconds of silence, the
remaining speech stays available to preview and final decoding. Mapping is nominal
sample-coordinate coverage, not a claim about a resampling filter's physical support.

## Recovery and target delivery

A valid local result commits before any target-operation await. Cancel stops output
while allowing a valid same-session local operation to finish. Discard, unmount and
replacement sessions reject late results. Failed or uncertain target delivery never
rewinds recognition, acknowledges unproven text or authorizes replay into another field.
An unconfirmed capture flush retains its notice even when received audio is recovered.

Full calls reset diagnostic state once, preserve ordered per-window decisions and retain
earlier low-confidence rejection flags. Repetition-history observations remain separate
fields in those decisions. Persistent numeric diagnostics do not retain transcript text.
The optional corroboration pass preserves the original baseline when an alternate differs
only in whitespace and per-character lowercase spelling; punctuation is retained by this
veto. It can forgo a valid spacing correction and does not claim semantic equivalence.

The source integration has unit and renderer coverage. Production-API corpus parity,
new held-out generalization, package/desktop qualification and physical-microphone tests
are distinct gates. Passing numerical coverage tests does not establish word accuracy,
and the current evidence does not establish worldwide superiority.
