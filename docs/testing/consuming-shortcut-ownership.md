# Consuming shortcut origin and input-context ownership

Current foundations candidate, 5 September 2026. IBus protocol version 5.

The optional IBus engine consumes native recording shortcuts while a current
app registration and renderer heartbeat exist. Its tokens identify an input
context, which may contain multiple application widgets. They do not authorize
text mutation. Both Rust and Python public commands reject mutation, and the
engine's actual mutation sinks are guarded too. Lifecycle resets cannot emit
preedit updates. Native recording ends in a completed transcript for manual Copy.

The passive evdev observer cannot prove which editor received a physical shortcut.
Consuming input-method keys improves recording shortcut behavior but cannot fix
the separate destination-identity defect. Automatic output now requires the
[exact-field Chromium adapter](../../integrations/chromium/README.md), with its
own consumed Alt+Shift+V and token/document/sequence contract.

While a consuming poll is in flight or its monotonic authority lease remains
current, native passive events are suppressed and competing X11 plugin grabs are
released. Confirmed unsupported contexts explicitly disarm the engine and restore
the manual-copy fallback. Both backends use one atomic admission gate, so
concurrent events cannot independently pass the same debounce window.

A failed poll that may have reached the engine retains authority for the engine's
one-second arm lifetime, measured conservatively from the failure response.
Connection failures before sending a poll do not extend that lease. This prevents
transient IPC failures from enabling a passive toggle while the engine can still
consume the same press, while allowing manual fallback once the lease expires.
Renderer heartbeat loss stops renewal; it does not falsely claim immediate engine
disarm. Applications that intercept shortcuts before IBus filtering remain a
platform-dependent coverage boundary. Passive observations never authorize
automatic delivery. No installation or active-desktop input-source change was
performed during this validation.

IBus deduplicates equal transport capabilities across contexts. The engine now
retains this transport capability cache across real context changes while still
requiring fresh content metadata for every focus epoch. Fake desktop proxy
capabilities cannot replace the last real transport capabilities. Isolated GTK
widgets previously failed eligibility because the application incorrectly erased
capabilities that IBus would not resend; the capability cache is retained for shortcut eligibility. All IBus text delivery is now rejected.

## Proof boundary and release gate

An IBus input-context ID is not universally a widget ID. The isolated WebKit
harness reuses one GTK input context across distinct DOM textareas with identical
metadata and does not emit focus/content callbacks for that switch. Neither the
new token nor a surrounding-text hash proves continuity between identical empty
fields. Corrected native tests capture WebKit shortcuts and reproduce wrong-target
commits both after token capture and after lease acquisition. Identical-position
controls also redirect without any focus/content/cursor callback before dispatch.
Earlier unavailable-shortcut classifications were caused by an uncanceled prior
test session and are invalid. Iteration 2 correctly failed on the demonstrated bug. The current gate requires
all IBus mutations to reject and verifies both GTK/WebKit fields remain unchanged.

The approved [delivery boundary](targeted-delivery-decision.md) suspends automatic
IBus output. The Chromium adapter is tested separately; it does not make GTK,
Electron or embedded WebKit automatic delivery safe. No process-name blacklist or
universal Linux field-identity claim is used.

Validation includes protocol/engine regression tests, the private headless IBus
lifecycle suite adapted to consumed triggers, and isolated native GTK XTest
shortcut/zero-mutation/context-switch journeys. See the iteration evidence for exact
versions and outcomes. Protocol version 5 intentionally rejects an incompatible resident engine; no
compatibility path restores automatic IBus mutation.
