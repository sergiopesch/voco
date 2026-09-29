> **Current contract (2026.0.60).** The first two sections describe current
> desktop paste and its regression suites. The dated notes after them are retained
> historical records: their Ctrl+V and Ctrl+Shift+V routing, AT-SPI focus metadata,
> focus tokens, sampled field readback, opt-in launcher flags, Whisper limits and
> planned work belong to earlier releases, not current status. See
> [current architecture](../architecture/README.md) and [candidate gates](../release-candidate.md).

# Native desktop paste

## Current contract — 2026.0.60

Each chunk goes to whatever has keyboard focus when it is ready. There is no
destination token, accessibility query or per-application route.
`insertion.rs::desktop_paste` copies the chunk to CLIPBOARD, then PRIMARY, and
sends one Shift+Insert gesture. GTK, Qt, Chromium (including its address bar),
Firefox and Electron apps paste CLIPBOARD on Shift+Insert; most terminals,
including VTE terminals, Ghostty and xterm, paste PRIMARY. A PRIMARY failure only
logs a warning, because some compositors do not provide it. X11 uses xclip and
xdotool; Wayland uses ydotool with wl-copy, or xclip through XWayland on GNOME.
Wayland keys need a running `ydotoold`, normally VOCO's `voco-ydotoold.service`;
until one runs, desktop setup reports paste unavailable and names that service.

A single leading joining space is sent as its own Space key before the paste,
because the Chromium address bar trims a pasted leading space; the selections
omit it. Legacy ydotool needs a literal space argument, not xdotool's `space`
keysym. ASCII controls, including line endings, become spaces, so a chunk never
presses Enter, submits a form or runs a command. A paste first waits until 150 ms
after the previous one, so that recipient can read its selection. On Wayland it
then waits at most 1.5 seconds for released shortcut modifiers, from evdev or the
GNOME companion's `ModifiersClear`; unknown state does not block, and a timeout
sends no keys. On X11, VOCO's passive grab receives every key while the shortcut
is held, the paste keys included, so a paste waits for the shortcut's release, at
most 1.5 seconds after the press.

`no-mutation` means no key was sent, `rejected` means a prerequisite failed, and
`uncertain` means a helper started but its result is unknown; `clipboardChanged`
reports whether the selections were replaced. Only `no-mutation` text is retried,
with the next hypothesis or up to three 250 ms retries at Stop. An uncertain or
rejected paste stops automatic delivery for the rest of the recording while
recognition continues. At Stop, `copy_desktop_text` puts the text not dispatched,
including an uncertain chunk, on both selections without sending keys, and VOCO
notifies "Dictation copied to clipboard"; after an uncertain chunk it asks the
person to check the app first, because those words may already be there. When the
copy fails too, the dictation's text moves from the crash journal into tray Review
("Dictation saved in Review"); if the journal could not keep it either, Stop
reports the dictation as interrupted.

A dispatch is not a receipt. VOCO cannot confirm that the recipient displayed the
text, detect a password field, prompt or read-only mode, or retract text. Apps
that remap Shift+Insert, remote desktops and virtual machines may not accept it.

## Regression suites

Two suites paste synthetic text with the production gesture into real
applications and read the result back from the application itself.

| Suite | Local command | Hosted mode | Cases |
| --- | --- | --- | --- |
| Applications | `npm run test:application-delivery` | `--application-delivery` | GTK 3, GTK 4 and WebKit fields; GNOME Text Editor; GNOME Terminal with Bash and nano; optional Ghostty, Firefox and VS Code |
| Browser | `npm run test:browser-delivery` | `--browser-delivery` | Chromium input, textarea, rich editor, placeholder, selection replacement, non-ASCII text, focus change and address bar |

`scripts/test-application-delivery.sh` runs either suite in bubblewrap with no
network, no `/dev/input`, a private Xvfb `:0` and a private D-Bus session.
`VOCO_DELIVERY_SUITE` selects `applications` (default) or `browser`.
`VOCO_DELIVERY_PLATFORM` selects `x11` (default), where the applications use the
Xvfb with no window manager, or `gnome-wayland`, where they are clients of a
nested GNOME Shell drawn on the Xvfb, with XWayland for X11 clients. CI passes
the hosted modes to `scripts/test-private-ibus-engine-hosted.sh` on both
platforms and, because it does not build Rust, uses the replica paste.

`scripts/fixtures/focused-paste.py` performs every paste. By default it replays
the X11 helper commands of `desktop_paste`: xclip for both selections, then
`xdotool key --clearmodifiers [space] shift+Insert`. On `gnome-wayland` xclip
writes to XWayland, and the keys go to the Xvfb, which the nested Shell passes
to its focused window. Set `VOCO_FIXTURE_PASTE_BINARY` to the voco library test
executable from `cargo test --no-run` to paste through production
`desktop_paste` instead, via the ignored
`insertion::tests::paste_fixture_text_into_the_focused_application` test. On
`gnome-wayland` production copies with xclip through XWayland, as it does on a
GNOME login, and presses the keys with `/usr/bin/ydotool`. The sandbox mounts
the test-only `scripts/fixtures/nested-ydotool.py` there: it accepts only the
paste keys and sends them to the Xvfb. This mode needs an installed ydotool
package for the mount point. Each `results.json` records the platform and
`"paste": "production"` or `"replica"`.

- `VOCO_DELIVERY_EVIDENCE_DIR` receives `results.json`, logs and failure screenshots.
- `VOCO_DELIVERY_BROWSER` selects a Chromium executable by absolute path instead
  of Playwright's.
- `VOCO_DELIVERY_OZONE` selects Chromium's Ozone platform: `x11`, or `wayland`
  on `gnome-wayland` only. It defaults to the delivery platform.
- `VOCO_GHOSTTY_BINARY`, `VOCO_FIREFOX_BINARY` and `VOCO_VSCODE_BINARY` need
  absolute paths because the sandbox resets `PATH`. Unset cases are recorded as
  `unavailable`, never passed.
- `VOCO_APP_CASE` runs only application cases whose name contains its value.
- `VOCO_NATIVE_DEPS` names an extra native dependency prefix (default `/usr`).
- `PLAYWRIGHT_BROWSERS_PATH` locates the Playwright browser cache.

The Release workflow also runs the whole built app with `--full-application`
(`scripts/test-native-full-app.py`, described in
[isolated native acceptance](native-isolated.md#full-application-with-virtual-microphone)):
a public speech fixture, Alt+D to start and stop, and each chunk pasted into the
focused GTK field, including a focus change between two utterances.

The nested GNOME Shell is not a login session: keys reach it through its window
on the Xvfb instead of a kernel input device, no real ydotoold runs, and the
VOCO companion and shortcuts are not exercised. Neither platform covers a
physical keyboard, and passing cases do not certify other applications.

## Native paste introduction — 2026.0.27

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
