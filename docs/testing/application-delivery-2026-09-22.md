# Application delivery qualification — 22 September 2026

**2026.0.55 candidate, not a published release.** The owner's installed .54 app,
profile and recovery remain unchanged. Tests use synthetic public text/audio,
private profiles, clipboard, displays and buses, with physical input/audio devices
absent. No test types into the owner's open applications.

## Cause and correction

The owner identified Brave's address/search bar. A matching .54 reproduction
pasted the first character correctly, then returned `changed`: Brave emitted an
entry focus-loss followed by suggestion focus-gain while the entry still held
keyboard focus. Replacing the retained entry with that list item invalidated the
receipt. Codex's successful owner session did not exhibit this sequence.

The candidate recognizes a suggestion only through bounded, reciprocal
`POPUP_FOR`/`CONTROLLER_FOR` relationships to a fresh, focused editable controller
in the same process and active window. An unresolved loss or actual field
roundtrip invalidates ownership. There is no Brave-name exception, longer paste
sleep, unguarded fallback or automatic replay.

The wider matrix also reproduced WebKit marking its scroll container, document
and input focused simultaneously. A noneditable focused container is now a
bounded search root; discovery must reach a focused input. Unfocused descendants
and password roles still reject. Separate regression tests failed before this
change and pass afterward.

Cold-start qualification exposed another failure: a new helper could spend all
128 discovery slots inside hidden suggestion contents before reaching the address
bar. Discovery now prioritizes cached focus/visibility across its queue, retaining
fresh admission checks and the same object/deadline bounds. In native GNOME,
visible browser chrome could still consume the bound with suggestions open;
cold lookup now also follows the same reciprocal popup-owner relation and
revalidates its active-window ancestry. A regression starts
the exact stdin subprocess protocol used by Rust, before suggestions, with a first word and after a complete sentence. The final browser matrix passes all 17 cases on Brave X11, Brave
native Wayland and Chromium X11; the eight-application matrix also passes. The unchanged 800 ms helper deadline remains in force.

The earlier [empty HTML placeholder correction](first-run-follow-up-2026-09-22.md)
remains necessary for page editors, but did not explain the owner's address bar.
An additional regression checks that visiting an unfocused terminal pane cannot
change a normal editor's paste shortcut. Terminal classification now uses the
focused destination (or known terminal process), rather than unrelated nodes.
A full-app focus stress test also moved the caret while paste preparation was in
flight and a short fragment reached the new field before readback rejected it.
Rust now revalidates the bound target and shortcut scope after the clipboard helper
returns, before starting the keyboard helper. The transaction regression failed
before this guard; a native fixture holds the clipboard helper, moves focus, then
releases it to test that exact boundary. The earlier unguarded package demonstrably
pasted into the second field at this seam.

**A keyboard gesture is still not atomic with another application's focus.** A
move during the gesture itself can redirect a fragment; readback and recovery
cannot retract it. Stop dictation before changing fields. Controlled pre-dispatch
rejection must not be presented as universal prevention of mid-gesture delivery.
Recognition and audio processing are unchanged; uncertain text is never replayed.

## Application matrix

| Environment | Checked surface | Result and evidence scope |
| --- | --- | --- |
| Brave 153.1.95.104 / Chromium 153.0.8010.53, X11 | Address bar with suggestions, selected URL, repeated chunks; plain and nested HTML editors | 17 cases pass using real accessibility, clipboard and native key gestures |
| Same Brave binary, nested GNOME 46 native Wayland | Same 17 cases | Pass; real private Xwayland clipboard bridge and nested compositor key delivery |
| Repository Chromium 153.0.8010.12, X11 | Same browser cases | 17 cases pass |
| Firefox (repository Playwright binary), X11 | Address/search bar, two consecutive chunks | Exact text/caret observations pass |
| VS Code (installed Snap executable, private direct launch), X11 | Plain-text editor, including with the integrated terminal open | Four exact observations pass after dismissing the fresh-profile welcome dialog |
| GTK 3 controls, X11 | Entry, text view and password entry | Three deliveries pass; password rejected before mutation |
| GTK 4 controls, X11 | Entry, text view and `Gtk.PasswordEntry` | Three deliveries pass; password rejected before mutation |
| WebKitGTK 4.1 controls, X11 | HTML input, textarea and password | Three deliveries pass; password rejected before mutation |
| GNOME Text Editor, X11 | Repeated text and new sentence | Three exact observations pass |
| GNOME Terminal / Bash and nano, X11 | Two chunks in each application | Correct terminal paste chord, stable destination and independent screen readback pass; no Enter sent |

Browser cases also cover expected-text rejection, focus departure and no replay.
Terminal screen assertions belong to the test harness: the product reports
**dispatch**, not an exact-field receipt, for terminal output. This distinction
must not be presented as atomic command-line ownership or proof of shell execution.

Run the reproducible tests:

```sh
npm run test:delivery-observation
npm run test:rich-editor-delivery
npm run test:application-delivery
# A different installed browser, always with a disposable profile:
VOCO_RICH_EDITOR_BROWSER=/absolute/path/to/brave npm run test:rich-editor-delivery
VOCO_RICH_EDITOR_PLATFORM=wayland \
  VOCO_RICH_EDITOR_BROWSER=/absolute/path/to/brave npm run test:rich-editor-delivery
# Optional application binaries, again without existing profiles:
VOCO_FIREFOX_BINARY=/absolute/path/to/firefox \
  VOCO_VSCODE_BINARY=/absolute/path/to/code npm run test:application-delivery
```

The application suite needs GNOME Text Editor, GNOME Terminal, nano, GTK 3/4,
WebKitGTK 4.1, AT-SPI, Xvfb, xdotool, xclip and Bubblewrap. The Wayland browser
suite additionally needs GNOME Shell and Xwayland. CI exercises the six native
application/toolkit cases and Chromium; local Brave/Firefox/VS Code runs are
recorded separately. `VOCO_RICH_EDITOR_EVIDENCE_DIR` retains receipts and logs.

## Verification in progress

The focus/readback regression gate passes **55 + 63 cases**. Frontend tests pass
449 cases; typecheck, lint, production build, Rust's 258 application + 19 host + 7
GLib tests and Clippy pass. One pre-existing fixture-export Rust test is ignored.
An initial assembled .55 package passes all 12 private GNOME X11 onboarding,
rich-editor, tray, Stop and recovery cases. The final combined candidate must
repeat package qualification before it replaces this initial-build evidence.

## Preserved failed attempts and limits

- Rejected cold-search experiments are retained: breadth-first traversal found
  the address bar but failed page-editor discovery; increasing a depth-first
  bound to 256 still failed with suggestions. Globally prioritizing visibility
  passes both paths without increasing the production bound.
- The released .54 helper fails the matching Brave address-bar sequence on X11
  and native Wayland. Earlier page-editor tests could not establish this fix.
- An early nested Wayland fixture omitted the compositor's Xauthority file.
  xclip reported an authentication error that the fixture mistook for readiness.
  The corrected harness supplies the actual private authorization file and
  requires its clipboard ownership message. Those failed trials are retained.
- VS Code's first-run sign-in modal and a private keyring prompt were correctly
  refused as destinations. The fixture dismisses welcome and uses a private basic
  password store with no accounts or credentials. That setting is not applied to
  the owner's VS Code. A transient Firefox startup attempt also failed before the
  field settled; the completed matrix and isolated repeat are separate receipts.
- A GTK 4 `Gtk.Entry` with visibility disabled still reports an ordinary editable
  text role on this host. `Gtk.PasswordEntry` correctly reports password. This
  matches [GTK 4.14's role mapping](https://github.com/GNOME/gtk/blob/4.14.5/gtk/a11y/gtkatspiutils.c#L297-L310).
  VOCO cannot promise password detection when an application exposes no protection
  metadata. The failed masked-entry assertion is retained; it is not counted as
  the dedicated password control's passing test. No test payload was sent there.
- Directly launching a binary from a Snap mount does not test Snap confinement.
  A nested compositor is not the owner's physical GNOME session. Physical
  microphones, perceived motion, other compositors, terminal bindings, custom
  widgets and apps without usable accessibility need their own qualification.

These tests establish specific working paths. They do not certify every Linux
application, protected input or desktop combination. A changed or unobservable
recipient must continue to stop safely and retain recovery.
