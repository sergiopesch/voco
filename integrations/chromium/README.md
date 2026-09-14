# VOCO Exact Field for Chromium (development integration)

This Manifest V3 extension is an explicitly enabled, local-only recipient adapter.
Click its toolbar action on the desired tab, then focus a plain text field and use
**Alt+Shift+V** to start or stop. The separate browser chord avoids VOCO's native
Alt+D shortcut. Opening a new document requires enabling that document again.
Click the toolbar action again to disable the current tab. An active browser
recording receives a stop request and its recipient authorization is revoked;
any undelivered text remains available for manual recovery.
The application and `com.voco.exact_field` native messaging host must be running
and registered. This directory is an unpacked development extension, not a
published store listing. Its fixed ID is `dohnphckdenppjhdafmhefhomomodgcc`.

Permissions are only `activeTab`, `scripting`, and `nativeMessaging`. There are no
host permissions, content-script automatic injection rules, storage, telemetry,
or network requests. Existing field values remain inside the content script;
they are never exported to the native host. Dictation text travels locally from
VOCO to the selected recipient. As with typing, the page can read text inserted
into its own field. This adapter is not a defense against a deliberately malicious
page copying authorized text elsewhere.

## Supported contract

Only top-frame textarea and text/search/url/tel inputs with a collapsed selection
are eligible. Password, rich text, disabled, readonly, inert, explicit
`data-voco-private`, and sensitive autocomplete fields are rejected. This is not
semantic detection of every potentially private field: enable only a tab where
you intend to dictate. Incognito tabs are rejected by the worker. Iframes and
closed shadow editors are not supported.

A consumed shortcut captures an exact element and document nonce. A native claim
must arrive within two seconds while its focus, value, and caret still match.
Every append checks these again synchronously, dispatches a cancelable
`beforeinput` veto, checks again, and calls the captured element's native
`setRangeText`. It never redirects insertion through `activeElement` or simulated
paste. Focus leaving and returning, navigation, replacement, ordinary input,
selection changes, changed eligibility, and disconnection invalidate ownership.
A second shortcut stops the original session even after focus was lost; it does
not acquire a different target. No delivery is retried after uncertainty. Claim and append carry a mandatory
1.5-second `expiresAt` deadline, checked again after page veto handlers and before
mutation, before the broker waits two seconds. This assumes browser and native
host share the same machine clock; wall-clock discontinuities remain a timing
limitation. A queued request cannot ordinarily write after timeout recovery.

The exact element operation **does not promise browser-native undo history**.
Beforeinput/input are synthetic events; editors requiring trusted events or rich
editor transactions are unsupported. A page that rewrites or detaches the field
in its input handler produces an uncertain result. Carriage returns and newlines
in single-line fields are rejected before mutation; textarea linefeeds are
supported. URL leading/trailing ASCII whitespace that Chromium would trim is
rejected before mutation; whitespace inserted inside a URL remains supported.
Maxlength is respected. Invisible programmatic edits that restore the
identical value/caret before any event are not observed, but cannot change the
exact object addressed by this operation.

Protocol 1 uses 48-character lowercase hex token/document IDs, claim sequence 0,
append sequences 1+, and scalar-value character counts (`Array.from(text).length`).
Appends are limited to 100,000 UTF-8 bytes and a session to 1,000,000 bytes,
1,000 journal entries, and ten minutes. Duplicate matching requests return their
journaled receipt without another write; conflicts reject. Completed-session
journals remain available for read-only queries for one minute, with at most 16
retired journals. Empty final appends are allowed. A receipt acknowledges the
mutation at that moment; it cannot promise that page code will preserve text
indefinitely afterward.

## Verification

Run `npm run test:chromium-exact-field`. Set `CHROMIUM_PATH` to a full Chromium
binary to override Playwright’s installed Chromium. `--native` additionally tests
the actual Rust native host and `browser_broker_fixture` binaries in
`$CARGO_TARGET_DIR/debug` (default `apps/desktop/src-tauri/target/debug`); build these from the desktop Cargo project. Override with `VOCO_BROWSER_HOST_BINARY` and `VOCO_BROWSER_FIXTURE_BINARY` if testing packaged binaries.

Tests create and remove a temporary browser profile and native host manifests.
They run production extension code in its actual isolated world. A **test-only
localhost host grant** replaces a physical toolbar click, so this harness proves
recipient logic and native messaging, not the visual toolbar permission prompt.
No installed browser profile is changed. Tests cover Unicode checkpoints/final
receipts, replay, field switching, reentrant page handlers, navigation, selection,
password/rich rejection, repeated shortcuts, expiry, and disconnect/re-arm.

`npm run test:browser-full-app` additionally runs the actual VOCO GUI, WebKit
microphone capture, pinned base.en model, and Chromium recipient inside private
Bubblewrap/Xvfb/PulseAudio namespaces. Set `VOCO_NATIVE_APP_BINARY`,
`VOCO_NATIVE_MODEL`, `VOCO_BROWSER_HOST_BINARY`, `VOCO_BROWSER_EXTENSION_DIR`, and
`VOCO_BROWSER_EVIDENCE_DIR` to the candidate artifacts and evidence destination.
`VOCO_NATIVE_OUTPUT_MODE=stable-cursor-streaming` tests canonical output;
`VOCO_BROWSER_LONG_CAPTURE=1` concatenates existing speech fixtures in manifest order until at least 37 seconds
(250ms gaps), waits for a real checkpoint receipt, changes focus, and verifies
that finalization preserves the committed prefix and retains recovery without
writing to the other field. This is synthetic regression coverage, not a
representative speech-quality benchmark. Hosted Ubuntu CI can use
`scripts/test-private-ibus-engine-hosted.sh --browser-application`; its temporary
user-namespace policy adjustment is restricted to ephemeral GitHub runners.

The original repeated-phrase stress remains a separate failed existing-model
quality probe: certain 30-second phase offsets produce empty results in the
unchanged decoder. `VOCO_BROWSER_LONG_FIXTURE=repeated` reproduces that synthetic
source; it is not substituted silently into the natural-sequence delivery gate.
