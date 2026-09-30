# VOCO's event-driven X11 shortcut actor patch

This directory vendors crates.io `global-hotkey` **0.8.0**, upstream commit
`2a620bf3852008b568f6d36c2baedcc3dd0822f2`. The original Apache-2.0 and MIT
licenses, normalized/original manifests, platform implementations and examples
are retained. `VOCO-UPSTREAM.json` records the downloaded crate archive checksum
and original file hashes. Cache marker `.cargo-ok`, upstream CI/changelog-tool
configuration and Renovate configuration were omitted; application builds do not
use the vendored examples or their development dependencies.

Both VOCO and tauri-plugin-global-shortcut must resolve to this single patched
copy; `scripts/verify-shortcut-backport.py` rejects a split graph. The crate's
public API is upstream's.

The actor waits on the X11 connection fd and a nonblocking UnixStream command signal
with `libc::poll`; idle operation has no periodic wakeup. Command senders queue
before signaling, and the actor rechecks the queue after draining bounded wake
bytes. A full signal buffer is already readable. Buffered x11rb events are drained
before any fd wait; X events therefore do not wait for a 50 ms timer. The actor
schedules no wait deadline, and fd error/hangup closes the actor. The direct libc
dependency is pinned to the application's existing locked 0.2.183, with no library
version upgrade.

Event draining is bounded so a continuous backlog cannot starve command handling
indefinitely. Registration/unregistration propagate actor send or reply-channel
failure instead of reporting success after actor shutdown.

Modified upstream files: `Cargo.toml` and `src/platform_impl/x11/mod.rs`. New
production module: `src/platform_impl/x11/wake.rs`. The X11 actor's
bulk-registration response now sends one terminal result, avoiding a bounded
reply-channel deadlock on a partial registration failure. Unregister checks all
server replies before reporting success, so a buffered write cannot report a
false success. Original platform code outside X11 is unchanged.

Tests live beside the new module and in the X11 actor.
