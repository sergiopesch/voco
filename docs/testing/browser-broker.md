# Exact-field browser broker acceptance

The Chromium integration uses a separate native-messaging executable,
`voco-browser-host`, and the desktop's private Unix-socket broker. It does not
make IBus context IDs into field identities. Only the extension's captured DOM
object and synchronous mutation checks authorize a browser write.

The native host accepts only
`chrome-extension://dohnphckdenppjhdafmhefhomomodgcc/`. Browser registration uses
`com.voco.exact_field`. Both endpoints verify kernel `SO_PEERCRED` user identity;
the runtime directory and socket must belong to that user and exclude group/other
permissions. Symlink directories, regular files and public sockets are rejected.
This boundary excludes other users, not compromised processes already running as
the same user. There is no network transport.

Protocol 1 messages use bounded native-endian, 32-bit-length JSON frames (maximum
1 MiB). The broker accepts one live browser connection, rejects stale or repeated
trigger tokens, and binds each request to its connection generation, document
nonce, token, request ID, sequence and committed Unicode scalar count. It allocates
its own monotonically increasing session IDs; renderer reloads cannot reuse a
prior native session by resetting a local counter.

A fresh trigger lasts two seconds. `claim` uses sequence zero and requires an
actual recipient receipt before the app receives a successful lease. Appends
require the exact previously acknowledged prefix, at most 100,000 UTF-8 bytes per
append and 1,000,000 bytes cumulatively. Sessions last at most ten minutes and
1,000 sequences. A final receipt preserves its known committed count even if the
browser subsequently disconnects. Stops carry their original token and are
explicit stop events; an early stop cancels a pending trigger before claim. Terminal
recording cleanup releases the exact trigger token even when its claim failed. A
frontend that declines an event sends that token a cancel; a competing tab cannot
revoke the already active owner. Stale release calls cannot cancel a newer session.

Delivery cancellation sends `revoke`: the recipient rejects further writes but
retains the recording token for Stop, including repeated shortcuts and toolbar
disabling. Only terminal recording release sends `cancel`. This separation fixes
long streaming recordings that lost focus before the stop shortcut. A rejected
write never authorizes a different field, and duplicate Stop messages remain
idempotent. Use the matching 2026.0.23 app and extension for qualification; reload
the unpacked extension and its test tab when replacing an older copy.


Every claim/append includes `expiresAt` 1,500 milliseconds ahead of dispatch;
the broker waits at most two seconds. The recipient checks expiry immediately
before mutation, including after page `beforeinput` handlers. This rejects delayed
queued work under the shared host clock assumption. It does not claim protection
against arbitrary host clock rollback. Timeout, mismatched receipts or transport
loss mark delivery uncertain and disable automatic retry; the broker never
replays a mutation to infer whether it happened.

Focused verification:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --bin voco-browser-host
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --bin voco-browser-host --example browser_broker_fixture -- -D warnings
```

The native socket tests cover Unicode checkpoints/finalization, every receipt
identity/count field, focus invalidation, token replay, stale triggers, renderer
session reuse, early stop, competing connections, disconnect uncertainty, expiry
and private filesystem/peer checks. These tests exercise real Unix socket pairs,
not browser DOM mutation; the extension's actual Chromium tests cover the latter.

`browser_broker_fixture` is an unbundled Cargo example for isolated browser tests.
It binds the real broker in a private `XDG_RUNTIME_DIR`, waits for a browser trigger,
claims the field and sends only the synthetic string `Native café 🦀 你好.`. Its CLI
is `OUTPUT_JSONL [DELAY_MS] [rejected]`. It does not capture a microphone or interact
with the current user's browser profile.

The Debian build gets the native-host executable path from Cargo's actual
compiler-artifact report, supporting custom target directories. It packages the
host at `/usr/libexec/voco-browser-host`, unpacked extension sources at
`/usr/share/voco/chromium`, and static native host registrations at the official
[Chrome and Chromium system locations](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).
It does not force-install or activate an extension. The package verifier checks
manifest-key-derived extension identity, origin allowlist, permissions, source
payloads and untrusted-origin rejection by the extracted host executable.
