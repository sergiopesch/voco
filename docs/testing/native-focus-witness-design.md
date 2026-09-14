# Optional local accessibility focus witness: feasibility and limits

Status: design/evidence only, 4 September 2026. No application accessibility
observer, setting, service, or additional automatic-delivery path is enabled.
A product/privacy decision is pending separately from this engineering study.

## Problem and measured evidence

Native WebKitGTK 2.52.6 reused one IBus input context for two distinct textarea
fields with identical content metadata. Switching A to B emitted no fresh IBus
focus or content-type callback. A context lease alone cannot distinguish those
DOM destinations.

In the private Xvfb/D-Bus desktop, `scripts/test-native-atspi.py` observed distinct
AT-SPI object paths for A, B, and the password input. A refocus returned the same
A path within that page lifetime. Uninstrumented runs recorded millisecond-scale observer arrival after the fixture's
A, B and password focus requests. The raw monotonic events provide exact timings;
this small set establishes feasibility, not a latency bound or synchronized
ordering guarantee. Paths and monotonic timestamps are retained in
`foundations-evidence/iteration-2/native/acceptance/atspi-focus.jsonl`; corresponding
fixture requests are in `native.json`. The fixture runs a separate observer process
and native browser process. All page data and labels are synthetic.

The test observer reads synthetic labels to correlate A/B in its report. A production
witness should not read those labels, accessible names/descriptions, surrounding text,
entry contents, document content, text changes, or selections. Labels can themselves
contain sensitive user content in real applications.

## Bounded proposed witness

If explicitly selected, an in-memory witness could observe focus state and opaque
accessible object identity, role and availability. Its identity must combine the
accessibility bus's unique owner, object path, and an owner-generation counter;
paths alone may be reused after a process or bus restart. Do not persist identifiers
or include them in routine logs. Do not automatically enable system accessibility
settings or fall back to whole-desktop tree/content scanning when unavailable.

At an already authenticated consuming input-method trigger, capture the current
witness revision and target. Treat focus loss, focus transfer, object destruction,
owner loss, accessibility bus reconnect, ambiguous identity, denied access, timeout,
or password/protected role as invalidation. Once invalidated, a lease must not become
valid again when focus returns to the same path. Each checkpoint and final dispatch
would require the same still-current target and generation, with a bounded timeout.
An unsupported or stale witness retains manual-copy recovery.

This can veto stale IBus ownership inside a shared input context. It cannot create
an eligible IBus context, authorize generic or sensitive fields, or replace the
existing content-purpose/hint policy. Corrected independent tests capture WebKit
shortcuts and deliver Unicode. A lease acquired in textarea A then committed after
focus moved to B actually redirected output into B, confirming the safety gap.
Earlier shortcut-unavailable claims were invalid because a previous GTK session
was not canceled between harness cases.

## Ordering and safety boundary

AT-SPI signals and IBus messages arrive over different connections, with independent
queues and process scheduling. A focus transition may already have happened in the
application while the observer still reports the previous field. Even a synchronous
focused-state query does not lock focus: it can change after the query but before an
IBus commit. Two successful reads or a short debounce cannot prove atomic ownership.

Therefore a focus witness is an additional veto, not a sufficient authorization to
claim zero possible wrong-target delivery for shared-context browsers. Closing that
claim requires a target-addressed application/IME operation that authenticates the
same field at mutation time, or an equivalent platform transaction. Whether a browser
integration can provide that boundary requires a separate design/product decision;
this study does not authorize introducing one. Avoid calling generic AT-SPI text
mutation or clipboard actions a drop-in solution: they have different cursor/preedit
semantics and need their own explicit privacy, behavior and delivery contract.

## Verification before any runtime activation

Use the existing isolated fixture to introduce controlled delays independently in
focus delivery and IBus processing. Check A→B with unchanged metadata, switch and
return, fast A→B→A, browser navigation, destroyed/recreated elements, password entry,
application and accessibility bus restart, missing accessibility support, locked
session, observer disconnect and timeout. Assert no text extraction by the witness
and no log persistence. Verify availability separately for GTK, Qt, WebKit, Chromium,
Electron, GNOME Wayland and KDE Wayland. Record false rejections as lost automatic
coverage; never relax failure behavior to improve the reported delivery rate.

Even all those tests would establish tested behavior, not remove the cross-process
check/commit race. Broad browser safety claims remain gated on the mutation-time
identity boundary above.

## Cursor geometry is not a field identity

The isolated `webkit-identical-cursor-proof` case positions two distinct textareas
at the exact same DOM rectangle `(40,40,206,86)` and swaps their z-order during
focus transfer. Both are empty before each race. The copied diagnostic engine
receives cursor rectangle `(43,411,1,18)` for A. After focus moves to B, neither
cursor, focus nor content callbacks arrive before the explicit dispatch marker,
after 300 milliseconds of event processing. Both token-before-switch/start and
lease-before-switch/commit then mutate B. The next cursor callback reflects the
already inserted wrong-target text.

`VOCO_NATIVE_TRACE=1 VOCO_NATIVE_OVERLAP=1 scripts/test-native-desktop.sh`
reproduces this failing acceptance case with ordinary isolated harness variables.
Cursor callback instrumentation exists only in the disposable engine copy. A
geometry-change veto may catch separated controls but cannot establish identity
or resolve this regression; equal rectangles do not imply equal destinations.
