# VOCO's scoped X11 shortcut patch

This directory vendors crates.io `global-hotkey` **0.8.0**, upstream commit
`2a620bf3852008b568f6d36c2baedcc3dd0822f2`. The original Apache-2.0 and MIT
licenses, normalized/original manifests, platform implementations and examples
are retained. `VOCO-UPSTREAM.json` records the downloaded crate archive checksum
and original file hashes. Cache marker `.cargo-ok`, upstream CI/changelog-tool
configuration and Renovate configuration were omitted; application builds do not
use the vendored examples or their development dependencies.

The 0.8.0 refresh carries the existing focus lease and event-driven actor patch
onto the new upstream release, including its F13-F24 X11 mappings and Windows
release-loop fix. Both VOCO and tauri-plugin-global-shortcut must resolve to this
single patched copy; `scripts/verify-shortcut-backport.py` rejects a split graph.

The Linux-only public addition is:

```rust
let lease = global_hotkey::acquire_focus_lease(registered_shortcut_id)?;
// Retain through the complete cursor dictation session and final queue drain.
let still_scoped = lease.is_active();
let degraded = lease.is_degraded();
lease.finish()?;
```

It locates exactly one existing manager that successfully registered the shortcut,
then asks that same actor to move the configured key and its existing lock-mask
variants from root to the exact X input-focus window. It preserves the upstream
parser, key mapping, callbacks and pressed-key state. A root grab cannot remain
alongside this scoped grab: X11 gives the ancestor grab precedence.

The session is bound to a unique actor/registration generation/lease nonce. Root
scope is restored on explicit finish, best-effort Drop, a real X focus departure,
window unmap/destruction, registration changes or a fixed 650-second watchdog
(600-second recording limit plus 50 seconds for finalization). These limits do not
extend any delivery observation deadline. Request waits are bounded to 500 ms;
timed-out acquisition queues a nonce-bound cancellation and a dropped acquisition
reply also causes actor rollback. Connection/actor failure and automatic restore
failure remain observable through the original lease completion state. Successful
automatic restoration is no longer an active session lease; check `is_active()`
before further session writes, alongside the application's unchanged focus guard.

The actor waits on the X11 connection fd and a nonblocking UnixStream command
signal with `libc::poll`; idle operation has no periodic wakeup. Command senders
queue before signaling, and the actor rechecks the queue after draining bounded
wake bytes. A full signal buffer is already readable. Buffered x11rb events are
drained before any fd wait; X events therefore do not wait for a 50 ms timer.
The only scheduled wait deadline is the current lease's original 650-second
expiry. Interrupted waits recompute that deadline; fd error/hangup closes the
actor and marks any active lease degraded. The direct libc dependency is pinned
to the application's existing locked 0.2.183, with no library version upgrade.

Event draining is bounded so a continuous backlog cannot starve cleanup
indefinitely. The watchdog depends on a responsive actor/X connection; caller
timeouts and strict receipt checks remain necessary. Registration/unregistration
propagate actor send or reply-channel failure instead of reporting success after
actor shutdown.

The root shortcut is briefly unavailable in another window between an actual focus
departure and actor restoration. Event-driven waiting removes the former
artificial 50 ms polling ceiling. The remaining asynchronous interval must be
measured and covered by integration tests; this patch does not promise uninterrupted shortcut
consumption across arbitrary focus changes. Another X client can claim a root
binding while it is scoped; failed restoration is an error, never a ready claim.

No focus helper, target token, clipboard receipt rule, keyboard shortcut preference
or Wayland behavior is relaxed. Exact-window grabbing still generates X11 focus
notifications; the isolated GTK proof shows that GTK/AT-SPI retain field focus in
this case. Other toolkits and default compositors require their own qualification.

Modified upstream files: `Cargo.toml`, `src/lib.rs`, `src/platform_impl/mod.rs`,
and `src/platform_impl/x11/mod.rs`. New production modules:
`src/platform_impl/x11/focus_lease.rs` and `src/platform_impl/x11/wake.rs`. The X11 actor's bulk-registration response
now sends one terminal result, avoiding a bounded reply-channel deadlock on a
partial registration failure. Unregister checks all server replies before reporting
success; the isolated actor test caught the former buffered-write false success.
Original platform code outside X11 is unchanged.

Tests live beside the new module. In this workspace the isolated focused harness
is under `stop-delivery-review-2026-09-15/shortcut-unit`; it compiles this exact
library source without downloading upstream GUI example development dependencies.
The private GTK proof uses the real vendored actor and independent X clients.
Retain their raw failures, fixture/binary identities and final receipts separately
from passing application tests; a mechanism proof is not full-app acceptance.
