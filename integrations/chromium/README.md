# Chromium extension

VOCO Exact Field is an optional Manifest V3 extension for Google Chrome and
Chromium. In a tab where you turn it on, `Alt+Shift+V` starts dictation and VOCO
writes each new phrase into the focused plain text field instead of pasting it.
The package installs it in `/usr/share/voco/chromium/`, to load unpacked, and
registers the native messaging host `com.voco.exact_field` in
`/etc/opt/chrome/native-messaging-hosts/` and `/etc/chromium/native-messaging-hosts/`.
See [Install VOCO](../../docs/install.md), [Everyday use](../../docs/everyday-use.md)
and [Security](../../docs/security/README.md#chromium-extension).

## How it works

Its fixed key gives the ID `dohnphckdenppjhdafmhefhomomodgcc`, the only origin
the host accepts. It asks for `activeTab`, `scripting` and `nativeMessaging`,
with no host permissions and no automatic content script.

1. **Toolbar click.** `background.js` connects to the host, which Chromium starts
   as `/usr/libexec/voco-browser-host` to relay frames to VOCO's socket,
   `$XDG_RUNTIME_DIR/voco-browser/exact-field.sock`. If VOCO answers within a
   second, it injects `content.js` into the top frame and shows **ON**.
   Otherwise the tooltip reads "Start VOCO, then click again", or "VOCO cannot
   access this page" where Chromium blocks extensions.
2. **Key press.** `content.js` takes a trusted `Alt+Shift+V`, notes the focused
   field, its value and its caret, and sends a trigger with a random token.
   VOCO cancels the trigger if it is busy or its window doesn't respond.
3. **Claim.** Before it opens the microphone, VOCO claims the field for up to
   600 seconds. The claim must come within 2 seconds, with focus, value and
   caret unchanged.
4. **Append.** Each new phrase carries the count of characters VOCO has written
   so far and a 1.5-second deadline. `content.js` checks the field, dispatches a
   cancelable `beforeinput`, checks again, inserts at the caret with the
   built-in `setRangeText`, dispatches `input`, and answers `applied`,
   `rejected` or `uncertain` with the new count. VOCO waits 2 seconds for it.
5. **Stop.** `Alt+Shift+V` anywhere in the tab, VOCO's shortcut or **Stop** ends
   the recording, and VOCO releases the field, which closes the session. Each
   append already had its receipt, so VOCO doesn't check the field again after
   the last one, just as it never checks a desktop paste. Words the field
   didn't take go to the clipboard, or to Review if the copy fails.

## When the field stops taking text

VOCO never repeats text the field didn't confirm. A `rejected` or `uncertain`
receipt, no receipt or a wrong count stops delivery: VOCO notifies "VOCO
stopped typing", keeps listening, and copies the rest at Stop. `content.js` also
ends delivery when focus leaves the field or the window, when the page changes
the field's value, selection or caret, when the field or an ancestor is removed
or changes `type`, `readonly`, `disabled`, `autocomplete`, `data-voco-private`
or `inert`, and when a handler cancels `beforeinput` or changes the value during
`input`. Closing or navigating the tab, clicking the button again or losing the
connection to VOCO stops the recording too. While one tab takes dictation, VOCO
cancels triggers from other tabs.

## Fields it accepts

`content.js` accepts a `textarea`, or an `input` of type `text`, `search`, `url`
or `tel`, in the top frame of a tab outside incognito, with a collapsed
selection. It refuses disabled and read-only fields, fields inside `[inert]` or
`[data-voco-private]`, and fields whose `autocomplete` names a password, a
one-time code, a card (`cc-`) or a transaction. Before any change it rejects
text the field can't hold exactly: a carriage return, a newline outside a
`textarea`, text past `maxlength`, and leading or trailing whitespace in a `url`
input, which Chromium would trim.

## Protocol

Protocol 1 carries JSON in native messaging frames of up to 1 MiB, and VOCO
refuses unknown fields. Tokens, one per key press, and document IDs, one per
page, are 48 random lowercase hexadecimal characters. The claim is sequence 0
and each append takes the next number. Counts are Unicode scalar values, as in
`Array.from(text).length`. An append carries at most 100,000 UTF-8 bytes, and a
field session 1,000,000 bytes in 1,000 requests. The page refuses a request
whose `expiresAt` has passed or lies more than 2 seconds ahead, and answers a
repeated request with its first receipt. VOCO closes the connection on a
receipt that doesn't match its pending request. The page sends back only
identifiers, sequence numbers, outcomes, reasons and counts, never addresses or
field contents. The host exits when either side closes.

## Files and tests

Here, `manifest.json`, `background.js` and `content.js` are the extension, and
`packaging/chromium/com.voco.exact_field.json` registers the host. In
`apps/desktop/src-tauri/src/`, `bin/voco-browser-host.rs` is the host,
`browser_broker.rs` holds sessions, `browser_protocol.rs` and `browser_socket.rs`
define frames and the socket, and `browser_event_delivery.rs` passes triggers to
the window and holds each Stop until the window acknowledges it.
`apps/desktop/src/lib/browserStreamDelivery.ts` is the renderer's side.
[Testing](../../docs/testing/README.md) lists every suite.

- `npm run test:chromium-exact-field`, in CI, runs `scripts/chromium-background.test.cjs`
  and `scripts/chromium-content-lifecycle.test.cjs` against a mock `chrome` API
  in Node, then `scripts/test-chromium-exact-field.mjs` in Playwright's Chromium
  or `CHROMIUM_PATH`, where a test-only grant for `http://127.0.0.1/*` replaces
  the toolbar click. `--native` adds the real host and broker, from
  `VOCO_BROWSER_HOST_BINARY` and `VOCO_BROWSER_FIXTURE_BINARY` or these builds:

  ```bash
  cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin voco-browser-host --example browser_broker_fixture
  node scripts/test-chromium-exact-field.mjs --native
  ```

- `npm run test:browser-full-app` runs the `voco` named by `VOCO_NATIVE_APP_BINARY`
  in bubblewrap, with private X11, D-Bus and PulseAudio and no network, and
  plays speech fixtures into a virtual microphone. It checks delivery, focus
  loss, and that navigation, tab close and host loss stop the capture.
  `VOCO_BROWSER_LONG_CAPTURE=1` adds a recording of at least 37 seconds.
- `scripts/test-browser-toolbar-app.sh` checks delivery and focus loss through
  the real toolbar button, clicked through the accessibility tree. CI runs both
  against the release build, through `scripts/test-private-ibus-engine-hosted.sh`.
- `scripts/verify-deb-package.sh` checks the packaged files, that the key yields
  the host's allowed origin, and that the host refuses any other.
- `npm run test:browser-delivery` tests pasting into Chromium without it.

## Known limits

- It isn't in the Chrome Web Store. Browsers that read native messaging hosts
  from other folders can't reach VOCO, and one browser profile connects at a time.
- `beforeinput` and `input` are untrusted events, so editors that need trusted
  events or rich text don't work, and undo may not remove dictated text.
- The page can read what VOCO writes, as it can read typing, and eligibility
  follows the field's type and attributes, not its purpose.
- The tests use simple local pages, synthetic audio and a private session.
