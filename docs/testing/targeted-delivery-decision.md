# Approved boundary: exact-field delivery

Status: approved by the project owner on 2026-09-05; implemented in the foundations worktree.
Automatic IBus mutation is suspended in both Rust and Python (protocol 5). Recording
and manual Copy remain available. The first exact-field integration is an explicitly
enabled Chromium tab, using a local native host and retained DOM-element operations.
See [the integration contract](../../integrations/chromium/README.md) and
[iteration 3 acceptance](foundations-iteration-3-2026-09-05.md) for current evidence.
The historical iteration 2 candidate remains blocked and must not be reused.

## Reproduction and why local patches cannot prove the destination

The native test consumes the shortcut in WebKit textarea A, then focuses B before
lease acquisition; the resulting commit mutates B and reports intact ownership.
Acquiring the lease first and switching before commit also mutates B. Both fields
share one IBus context. Their capabilities, purpose and hints match a valid GTK
entry in the same process, so a toolkit/client-name blacklist is not a reliable
boundary.

A second test gives A and B identical screen rectangles, empty contents and the
same caret location. It swaps their stacking order and focuses B, drains events
for 300ms, then dispatches. No cursor, focus or content callback reaches IBus before
mutation. Both races still redirect. Cursor geometry and surrounding-text hashes
therefore cannot establish widget identity; arbitrary delays cannot repair missing
information. The existing pipeline already has a real failing test for this case.

[WebKitGTK 2.52.6 source](https://raw.githubusercontent.com/WebKit/WebKit/webkitgtk-2.52.6/Source/WebKit/UIProcess/API/glib/InputMethodFilter.cpp)
corroborates the boundary: its input-method state does not carry the DOM element
identity through the focus-routed commit operation. The retained native evidence
is authoritative for the reproduced behavior in this environment.

## Recommended first action: suspend automatic delivery without widget authority

Keep the current microphone, recognition, formatting, recovery and explicit Copy
features. Consuming shortcut tokens still prove input-context origin, but must not
authorize text mutation by themselves. Reject unsupported automatic lease starts
at both the Rust service and Python engine boundary. Surface one clear reason:
recording is available, and the destination requires a verified integration before
automatic insertion. Update native acceptance to expect manual recovery for every
unqualified context, including GTK; a limited successful fixture cannot certify
all applications sharing those metadata.

This approved product change suspends automatic IBus insertion
until an exact-target adapter is present. It is the smallest principled way to
prevent the reproduced redirects while retaining useful dictation. The current
release gate must remain failing until the change or an equivalent proven fix is
implemented; neither warnings nor browser-name blacklists close the defect.

## Next action: local application adapters with mutation-time validation

An adapter must implement this contract inside the target application's execution
context, without resolving the currently focused field at dispatch time:

1. At the consumed trigger, capture an opaque widget reference, document/process
   generation, selection revision and a random session token.
2. On each proposed append, synchronously verify that the captured widget is still
   connected, eligible and focused, and that selection/content ownership has not
   changed. Focus loss, navigation, destruction, external edits or unknown state
   permanently invalidate that session.
3. Address that exact widget and perform the allowed edit in the same transaction
   as those checks. Do not fall back to synthetic global typing or clipboard paste.
4. Track session and sequence IDs plus exact committed-prefix receipts. Reject
   stale/replayed/mismatched messages. If an acknowledgment is uncertain, retain
   manual recovery and never retry the edit automatically.
5. State application editing/undo limitations explicitly and test supported plain inputs,
   textareas and rich editors separately. An adapter must report unsupported
   targets truthfully, rather than assume all editable-looking controls work.

A browser extension or editor integration can potentially supply this boundary.
The first supported application and permissions should be explicit. Local native
messaging is possible, but it adds installation, origin authentication, update and
permission responsibilities. Request the narrowest access required; do not add
telemetry, broad document extraction or persistent transcript storage.

An [AT-SPI InsertText call](https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi/method.EditableText.insert_text.html)
addresses a remote object but offers no atomic focus/selection precondition or
sequence receipt. Separate focused-state/caret reads cannot fill that gap. An
accessibility witness could add a veto, but cannot authorize the same transaction
contract. Inserting into a formerly focused object would be a different product
behavior requiring its own explicit decision.

## Verification before enabling an adapter

Use the existing native negative tests, adding same-position controls, A→B→A,
password transitions, destroyed/reused elements, navigation, app restarts, delayed
requests/responses, overlapping edits, repeated sequences, failed acknowledgments,
focus loss before the first mutation and between streaming checkpoints. Verify
zero wrong-target mutations and exact receipts independently. Include explicit
Copy recovery and all ordinary typing/shortcut pass-through journeys.

The user's Personal Codex Operating Framework reserves product behavior and
privacy/security tradeoffs for the user. Suspending automatic insertion and adding
application integrations crosses that boundary; choosing either is a required
product decision, not routine implementation approval. The earlier optional
accessibility question has not been treated as consent to activate any observer.
