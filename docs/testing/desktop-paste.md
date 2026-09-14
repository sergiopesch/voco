> **Current contract (2026.0.35).** Native desktop paste and streaming are enabled
> by default unless their launcher flags are `0`. NVIDIA Nemotron provides continuous
> English streaming; the older Whisper 30-second preview limit below belongs to an
> earlier path. Clipboard replacement, no Enter, no uncertain replay, terminal chord
> selection and best-effort focus guards remain. A focus token is not exact-widget
> ownership; protected fields are not universally detected. No automatic whole-message
> rewrite or physical Wayland/application-wide qualification is claimed. See
> [current architecture](../architecture/README.md) and [candidate gates](../release-candidate.md).
>
> The dated implementation notes below are retained historical records. Their statements
> about installation status, opt-in defaults and planned work are not current status.

# Native desktop paste candidate

The 2026.0.27 candidate adds an explicitly enabled native paste path for ordinary
applications that accept Ctrl+V. It is separate from the Chromium exact-field
adapter and does not re-enable the disabled IBus mutation path.

## Original final-only flow — 2026.0.27

Start from the tray or configured shortcut, speak, then Stop. VOCO remains in the
tray during dictation and processing; it does not open a transcript preview.
With native desktop paste enabled, it performs final transcription, places the
text on the clipboard and sends Paste once. It never presses Enter, submits a
message or retries an uncertain dispatch automatically. The transcript remains
available inside VOCO, and failed dispatch exposes recovery.

The destination is the field focused when the paste reaches the application.
It is not pinned to the original field; keep the intended editor focused until
insertion finishes. The transcript replaces the clipboard and remains there.
Clipboard managers may keep it according to their own settings. VOCO does not
attempt delayed clipboard restoration, which could overwrite a newer copy or
race a slow recipient.

## Activation and compatibility

The candidate requires explicit acceptance of those clipboard/focus semantics.
Set `VOCO_DESKTOP_PASTE=1` in its launch environment only for that chosen policy.
Without it, the existing exact-field/manual-Copy policy remains active. The
user approved this policy on 2026-09-13. The laptop now runs 2026.0.30 with
`VOCO_DESKTOP_PASTE=1`, `VOCO_DESKTOP_STREAM=1` and `VOCO_PERFORMANCE_LOG=1`
in its user launcher. Installed binary identity, unchanged configuration/model,
startup and hotkey readiness were verified in `INSTALLED-AFTER.json` and
`installed-performance-report.json` under `../../../codex-stream-fix-2026-09-13/`.
See the continuous-speech correction below for the current behavior.

Wayland requires `ydotool` and a compatible running `ydotoold` service.
Starting with 2026.0.28, GNOME with an XWayland display uses `xclip` for clipboard
ownership and still uses `ydotool` for the paste gesture into Wayland applications.
Other Wayland environments use `wl-copy`. This selection happens before clipboard
mutation; an uncertain operation is never retried through another transport.
X11 requires `xclip` and `xdotool`. Missing or unsupported helpers fail preflight
before microphone capture. The helper detects legacy named-chord versus modern
numeric-key syntax before changing the clipboard. The Debian package includes
`xclip` as a dependency; diagnostics report the selected helper, and run metadata
records `desktop_clipboard_helper`.

This is broad paste compatibility, not every-application certification. Read-only,
protected, custom or remote fields may reject paste; terminals and some editors
require a different shortcut. The generic route does not identify protected fields.
Native shortcut backends can be non-consuming, so choose a chord that the target
app does not reserve (Alt+D is used by browser address bars). The native route is
not a guarantee that a shortcut cannot affect the foreground app.

Browser-origin sessions keep their exact-element adapter. They do not fall back to
native desktop paste when focus/ownership is lost, even when desktop paste is enabled.

## Diagnostics and verification

`desktop_paste_enabled` records the run policy. Per-recording lifecycle events
identify desktop-paste selection, failed preflight, dispatch request, dispatch
completion and failure. `dictation_desktop_paste_dispatched` measures the helper
transaction; it is not a receipt from an arbitrary editor. The report marks it as
requiring target verification and does not label it `final_output_completed`.

The candidate passed actual packaged WebKit microphone capture, pinned Whisper and
clipboard/keyboard paste into a private GTK field. A separate focus-switch test
confirmed that the newly focused field receives the final paste, illustrating the
policy boundary. Unicode clipboard/Paste tests passed in GTK single-line/multiline
and WebKit plain/rich-text controls. Actual-App tests confirm no dictation overlay;
hook tests cover preflight, one final paste, uncertainty without retry and late
cancellation. These private X11 tests do not prove the normal Wayland/Codex journey.

Evidence: `../../../desktop-delivery-2026-09-13/` from this document. Before wider
claims, verify actual Codex, browser rich editors, office editors, non-Latin text,
rapid Start/Stop and recovery on the normal laptop. Record unsupported targets and
shortcut conflicts explicitly. Do not call unverified dispatch successful insertion.

## GNOME activation correction — 2026.0.28

The initial normal-desktop test found that `wl-copy` timed out before paste on this
GNOME session. Native GTK single-line and multiline controls received exact Unicode
through the XWayland clipboard bridge and Wayland keyboard helper. This addresses
the reproduced clipboard blocker; it does not certify Codex or every application.
Evidence is retained under `gnome-fix/` and `wayland-xclip-proof/` in the delivery
folder. The helper-only fixture does not exercise microphone capture.

## Progressive native delivery — 2026.0.29

With `VOCO_DESKTOP_PASTE=1 VOCO_DESKTOP_STREAM=1` and enhancement off, the native
route recognizes and appends completed speech phrases while recording. A 450 ms
quiet boundary after sufficient audio queues the next source range. Ranges remain
ordered and disjoint. Stop drains microphone capture, waits for the queue and
recognizes only the remaining tail; it never repastes the complete transcript.
Words are not speculative rewrites. Continuous speech without a suitable pause
can still wait until Stop. Enhancement-enabled sessions keep final-only delivery.

The transcript on the clipboard is the most recent inserted phrase; the assembled
transcript remains inside VOCO. Cancel suppresses later queued delivery; it cannot
undo a paste already dispatched. A failed or uncertain phrase stops subsequent
queue output and retains recovery. Complete captured audio remains available for
explicit transcription recovery; users must review any already inserted text.

VOCO reads AT-SPI focus metadata, not field text, window titles or clipboard data.
Known terminal applications and exposed terminal roles select Ctrl+Shift+V;
ordinary/unknown targets retain Ctrl+V. No application configuration is changed.
Terminal payloads replace ASCII control characters and embedded line endings with
spaces, so dictation does not send command-control sequences or line submission.
The Debian package supplies the AT-SPI introspection dependency.

When a focus token is available at Start, progressive delivery checks it before
each paste and rejects changed/unavailable identity. The token may identify only
a window when an editor does not expose its field; unknown targets lack this
protection. It is not atomic ownership or a promise that typing/focus cannot race
paste. Keep the intended field focused and avoid editing during delivery. Customized
shortcuts, inaccessible surfaces and unrecognized terminals remain compatibility gaps.

New events identify phrase queueing/recognition, first phrase dispatch, Stop flush
and stream failure. Separate durations measure target probing, helper preflight,
clipboard writing and keyboard dispatch. Fixed terminal/standard route categories
show which gesture was selected without identifying the application. Reports count
paste dispatches separately from confirmed visible text. Tokens, application names,
titles and dictated text are not performance fields.

Actual production paste passed normal Wayland Ghostty input without config changes.
The packaged capture/Whisper/GTK test read the first phrase before Stop and the second
after Stop with no duplicates. Eight read-English reference clips preserved the
baseline 4 errors / 160 reference words with the 450 ms setting; the earlier 300 ms
trial increased errors and was rejected. This small corpus is not conversational,
noise, accent or universal application qualification. Evidence:
`../../../streaming-review-2026-09-13/`.


## Continuous speech correction — 2026.0.30

A Codex manual retest confirmed .29 inserted text after Stop but queued no phrases
while speaking. Paste transport was functioning; pause-only scheduling did not
meet the live-text expectation. The logs do not establish whether missing pauses
or microphone background energy prevented boundaries.

The native stream now requests an expanding audio snapshot every two seconds
within the current phrase. Two successive recognition results must agree on a
word prefix before it is appended. Quiet boundaries still finalize a phrase;
Stop transcribes the outstanding phrase and appends only its remaining suffix.
It does not rewrite existing target text. If final recognition revises words
already inserted, automatic delivery stops and the full recognized text/audio
remain available for review. Word agreement is an operational gate, not a proof
that recognition is correct.

Only one recognition job runs in this queue. At most one pending speculative
snapshot is kept, newer audio replaces it, and finalization removes the pending
snapshot. An in-flight decode is awaited; its result cannot paste after Cancel.
The current phrase's periodic snapshots stop after 30 seconds without a quiet
boundary, to bound repeated decoding cost. A later boundary or Stop finalizes
that audio. Recognition now happens during speech and adds CPU cost compared
with final-only operation; no battery or total-CPU reduction is claimed.

Snapshot request/recognition/failure, agreed-prefix dispatch and the 30-second
limit have separate fixed diagnostic categories. The performance report flags
speculative failures and a wait for a phrase boundary without calling these
confirmed editor failures. The clipboard/paste, terminal routing and focus guard
remain the same as .29. No Codex or Ghostty settings are changed.

Also fixed the phrase range's third argument to be its length rather than its
absolute end offset. Multiple boundaries delivered in one capture batch now
produce disjoint audio requests instead of overlapping later phrases.


## Streaming foundations candidate 2026.0.31

Desktop live hypotheses use the existing preview decoder through a dedicated
30-second desktop IPC contract; the owned-preedit preview retains its 20-second
limit. Final phrases retain the full quality path. The first
snapshot is due after 800 ms, then every 500 ms; one pending snapshot coalesces
newer audio. These are scheduling thresholds, not visible-word latency promises.
The 30-second unsettled-phrase cap remains; bounded rolling audio is not qualified.

Agreement compares complete words with case and edge punctuation ignored. It
retains internal apostrophes, decimal points, signs and hyphens, and rejects word
revisions. Finalization discards queued previews and suppresses delivery from an
obsolete in-flight preview. Existing target text is never rewritten by this path.

For VOCO's single leading join space, delivery sends a Space key followed by the
normal paste gesture in one ordered helper invocation. This preserves separators
in Chromium address bars, which trim each clipboard paste. Other whitespace is
left verbatim. Rich contenteditable editors can represent a natively typed trailing
space as U+00A0; field-readback tests preserve this observation and compare its
visible word separator separately. Clipboard contents omit the separately typed
join space; the complete transcript remains in VOCO. Focus guards, terminal
control-character filtering and no-retry handling remain active.

This candidate does not provide automatic whole-message polishing after Stop,
owned-range replacement in arbitrary editors, or universal app qualification.


### Foundation task status

- [x] Separate live and final recognition; preserve the pinned model.
- [x] Fix punctuation/case stalls, stale-preview delivery at Stop, and browser join spaces.
- [x] Add local queue/withholding diagnostics and verify the packaged capture-to-field flow.
- [x] Bound speculative desktop decoding and report expired previews separately; verify final transcription after native aborts.
- [x] Reduce first-word withholding and verify startup timing at three recording-to-speech delays with the packaged app.
- [ ] Advance bounded audio windows through long continuous speech.
- [ ] Establish a verified owned text range before whole-message refinement.
- [ ] Qualify final formatting, native Codex/Ghostty/Wayland targets and physical microphone conditions.

Candidate evidence: `../../../first-words-2026-09-13/REVIEW.md` from this
document, with prior comparisons at `../../../performance-round-2026-09-13/REVIEW.md`
and `../../../foundations-speed-2026-09-13/REVIEW.md`.
The tested .33 package is staged; system installation remains .30 until
administrator authentication is available. No manual test is required to reproduce
the isolated evidence recorded for this milestone.


## Desktop preview scheduling budget (2026.0.32)

Desktop previews now share one wall-clock budget across their initial decode and
any recovery attempts: `clamp(500 + audioSamples / 400, 600, 1700)` milliseconds
for 16 kHz audio, capped at 30 seconds. Native computation checks a scoped deadline;
expired output is never published. The next snapshot can use newer captured audio.
The ordinary preview route and final transcription keep their existing recovery
policies and do not inherit this deadline. Decoder state is still released after
each native call; no new model or persistent state cache was introduced.

This is a soft scheduling deadline: callbacks run at native computation checkpoints,
and thread scheduling/IPC can add overhead. Slower or busy hardware may skip more
live previews; final transcription remains available. No sub-second guarantee is
made, and the 30-second continuous-phrase ceiling remains unchanged.

## First-word startup scheduling (2026.0.33)

The desktop scheduler no longer sends the initial sub-second snapshot: the pinned
decoder returns no hypothesis below one second. It requests usable audio near
one second, keeps the original regular snapshot clock, and adds midpoint checks
about 250 ms after regular decodable snapshots until the first successful live
delivery. Startup additions end after five seconds of each phrase even if no
words have been delivered. The 500 ms steady schedule, one
coalesced pending preview, decoder budget, 30-second ceiling and two-hypothesis
word agreement remain. Large capture batches do not trigger catch-up bursts.

Preserving the later clock matters: an earlier experiment shifted all later
windows and regressed one reference fixture. Its rejected results are retained
with the candidate evidence. These scheduling thresholds are relative to captured
phrase audio, not physical speech onset or a promised first-word latency.

A shorter new hypothesis can corroborate complete leading words from the previous
hypothesis. The comparison no longer rejects it merely because its speculative
tail shrank. Changed leading words and an unfinished final token still prevent
those words from being committed; final reconciliation remains fail-closed when
previously delivered text is revised.
