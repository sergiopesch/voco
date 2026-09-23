# Brave address-bar Stop correction — 23 September 2026

Source candidate only. The installed and public release remains **2026.0.57**.

## Reproduction and cause

On native Wayland, the passive evdev listener observes Alt+D without consuming
Brave's address-bar shortcut. Brave selects the existing dictation; the final
stream suffix then replaces that selection. A real .57 app reproduction changed
`Go do you hear` into `?`. The same browser under X11 retained the phrase because
its shortcut was consumed. This was a shortcut collision plus selection admission
error, not a transcription reset or crash.

The minimized regression uses the real helper, native Brave, AT-SPI, clipboard and
keyboard delivery. Its snapshots show the original text, an unchanged value with
all characters selected after Alt+D, and only `?` after the final paste. The
before/after comparison uses the same public audio and disposable browser profile.

## Correction

- A continuation cannot replace selected text. Intentional selection replacement
  remains available for the first delivery of a new dictation.
- After clipboard preparation, Rust validates the prepared position and bounded
  context again before sending keys. Only unchanged samples authorize dispatch;
  partial, completed, inconsistent or unavailable observations do not. The added
  validation is included in target-probe timing.
- The GNOME companion consumes supported Stop chords during starting, recording
  and processing. It sends an explicit Stop after modifier release. Repeated
  processing chords cannot start another recording.
- A current, authenticated Shell reservation suppresses duplicate evdev events.
  Short expiries, current-state tokens and generation checks isolate stale replies.
  Idle, disconnect, disable and app timeouts release the compositor grab.

The grab follows GNOME 46's existing
[accelerator API](https://github.com/GNOME/gnome-shell/blob/46.0/js/ui/shellDBus.js#L276-L299).
No dependency, hotkey preference or installed profile was changed.

## Verification

| Check | Result |
| --- | --- |
| Observation regressions | New selection and pre-dispatch tests fail before the fix; 79 focus and 68 observation tests pass afterward |
| Real helper/browser matrix | 19 cases pass in native Brave Wayland; 19 pass in Chromium X11 |
| Application delivery | Six native application/toolkit cases pass, including protected-field rejection, Bash and nano |
| Full .57 app baseline | Real speech pipeline loses the phrase on the passive Wayland Stop sequence |
| Candidate app, native Brave Wayland | Normal, held and repeated Stop preserve the complete phrase; no recovery notice or extra recording |
| Candidate app, Brave X11 | Three successive Start/Stop sessions preserve the complete phrase |
| Real GNOME companion | Consumed keys, modifier release, processing, alternate shortcut, idle/disconnect/app-timeout cleanup and stale-response isolation pass |
| Native bridge | Unattached clients cannot reserve the shortcut; stale/idle/unsupported reservations reject |
| Rust | 282 tests pass; one pre-existing fixture export remains ignored; strict Clippy passes |
| Maintenance | DevOps checks, panel model tests and whitespace checks pass |

The compiled candidate app has SHA-256
`76ead5e373729af51b481e74e8e3a3153fbb9d0577d911dc745779eee99f97b5`;
the reviewed companion `extension.js` has SHA-256
`760ba0041c993dca9a02a6049eec99738eaf4892a5299d4f9740e128dadbb4da`.
Local receipts and frozen failed attempts are under the workspace's
`follow-up-2026-09-23-brave-stop/` directory. The main receipts are
`baseline-wayland-full/`, `candidate-wayland-accepted/`,
`candidate-x11-accepted/`, `panel-shortcut-reviewed/` and
`helper-green-wayland-final/`.

Reproduce the committed regression checks with:

```sh
npm run test:delivery-observation
npm run test:rich-editor-delivery
VOCO_RICH_EDITOR_PLATFORM=wayland \
  VOCO_RICH_EDITOR_BROWSER=/absolute/path/to/brave \
  npm run test:rich-editor-delivery
npm run test:application-delivery
VOCO_NATIVE_DEPS=/absolute/path/to/extracted/usr \
  VOCO_PANEL_EVIDENCE_DIR=/absolute/fresh/evidence/path \
  bash scripts/test-gnome-panel.sh
```

## Evidence limits

All input, clipboard, audio, buses and profiles were private. The full Wayland
test used the actual candidate app, native capture, packaged model and Brave;
physical evdev input was represented by the app's existing Start socket, and a
private keyboard adapter translated the app's paste gestures into the nested
compositor. This is not physical keyboard/uinput, Snap-confinement, owner-session
or every-desktop certification. Earlier fixture attempts failed on ambiguous
outer-window accessibility and incomplete virtual Pulse setup; those were not
passing application tests and remain retained separately.

Without a working consuming companion, selected continuations fail safely and
remain available through saved-text recovery. Native gestures still cannot be
atomic with a focus/selection change during the gesture itself. No uncertain text
is replayed, and no live profile or public release was replaced by these tests.

## Release review follow-up

An independent review found that a held Stop could be discarded when Starting
changed to Listening before Alt was released. The GNOME regression reproduced
this failure. The panel now carries the existing capture session ID, qualified
by the renderer epoch, separately from presentation revisions. The same-session
transition passes; replacement sessions reject the old gesture. The native
compositor lifecycle suite is also a protected frontend CI step. Original
qualification above describes the earlier candidate, not the new release bytes.
