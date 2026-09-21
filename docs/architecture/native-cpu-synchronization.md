> Historical implementation, retired in .51. The current single-engine stream and explicit recovery contract are described in [Architecture](README.md#startup-and-recognizer-selection). Paths and decoder behavior below refer to earlier commits.

# Native CPU synchronization

The pinned Whisper decoder uses GGML CPU graphs. The owned native patch changes how graph workers synchronize and stop; speech weights, decoder parameters, recovery admission and output boundaries remain unchanged.

On Linux without OpenMP, workers spin briefly at a computation barrier and then wait on a dedicated condition variable if their peers have not arrived. The last arrival advances the generation and wakes registered waiters. The generation predicate and sequentially consistent waiter registration prevent a lost wake; spurious wakes recheck the predicate. Synchronization objects are initialized before workers start and destroyed after every worker has joined. Failed optional initialization retains the previous spin behavior. Other platform/OpenMP barrier primitives remain as before.

Cancellation records the first graph node to skip. A worker leaving the preceding node must still execute the current node and meet its peers before stopping. A shared Boolean could let it skip that node and strand the other workers at a barrier. One final graph-completion barrier ensures all workers have made their exit decision before the caller resets graph state, changes the participant count or releases graph resources. The callback still requests stopping after the current node.

The diagnostic candidate passed a fixed 16-condition speech comparison and an uninterrupted 115-recording consumed regression set with exact semantic parity. A native graph test reproduced the old cancellation hang, then passed exact arithmetic, cancellation, subsequent reuse, changing thread counts and state destruction with the fix on both four-core and single-core layouts. This ordinary application composition requires separate qualification before delivery. These findings do not establish physical-microphone quality, universal Linux performance or a worldwide ranking.

The source uses ordinary disposable GGML worker pools. Optional encoding-cache and state-owned-pool experiments remain outside this application candidate. Source reconstruction is documented in `vendor/README.md`; preserve exact executable/model identities with subsequent validation. ThreadSanitizer could not start in the current host environment, so no complete race-detector qualification is claimed.
