# VOCO .56 installer and Ghostty qualification

This follow-up addresses two fresh-install reports: opening VOCO after guided
installation and starting dictation in Ghostty after onboarding. Publication is
established by the signed release assets, not this source version. Earlier failed
candidates and fixture attempts remain retained separately.

## Diagnosis and fixes

The owner's startup journal established running keyboard and speech services but
contained no optional failure trace. The exact installed Ghostty 1.3.1 was therefore
reproduced privately. Its focused terminal is a GTK graphical pane with no Text
interface or editable caret. Released .55 rejected that pane before capture; the
private terminal received no bytes. The new route verifies a uniquely focused pane,
fresh ancestry, complete bounded discovery and tracked focus/window events.
Destination checks still run before clipboard use and immediately before keys.

The first candidate exposed a second defect in repeated X11 recordings. Holding
Alt+D produced X11 `FocusOut/NotifyGrab` and GTK active/focused loss while native
window focus stayed on the same Ghostty window. A warm probe rejected Start;
releasing D produced `FocusIn/NotifyUngrab` and restored accessibility readiness.
The final X11 plugin callback admits one matched press/release pair on release.
It rejects stale, orphan and duplicate events without delays or target retries.
Wayland native, browser and IBus shortcut semantics are unchanged.

Destination/setup rejection also cleared microphone readiness before capture was
attempted. The renderer now invalidates WebKit readiness only after attempting
WebKit capture; generation-bound native invalidation remains separate.

The guided installer requests one detached launch after verified installation and
desktop setup. It retains the installing desktop user's environment, rejects root,
remote and headless launch contexts, and never opens a GUI from a package hook.
Opening onboarding does not start microphone capture.

## Frozen candidate

Application and complete-package assembly use clean source
`19fbfc2c2f9f8dd49930951aeb4c2cb0c3bf9cf7` with Node 24.21.0, Rust 1.94.0,
GCC 13.3.0 and four Cargo jobs. Subsequent changes to this qualification record
are documentation only; package docs retain the assembly snapshot.

| Artifact | SHA-256 |
| --- | --- |
| Complete Debian package, 685,704,410 bytes | `7bfe1f0df7384a9eb77e078f2261f2894f2e50373ca7655cfffa64cc8e7c8ade` |
| Packaged app | `293395879e9d5c97521cad22239ed5021a1b1b6627d59d977737c4a8fed24060` |
| Browser host | `d7878c268e0af099ac8e52ab91e8483d5188cdf53268c84dd17fef06f9f88d4d` |
| Desktop destination helper | `1a607c8746da796ab34d2d4de9eaff7b6f7093268eb6f9967a39a56ec8256369` |
| Pinned speech model | `d9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d` |

Tauri replaces the executable's bundle marker with `DEB`; raw Cargo and packaged
executable hashes differ. Application acceptance uses the packaged hash above.

## Verification

- All four [build-source CI jobs](https://github.com/sergiopesch/voco/actions/runs/35863245085)
  pass, including pinned speech accuracy/continuity/protocol, native toolkit,
  renderer, security and DevOps gates. The local full frontend chain passes 439
  Python, 78 Node and 390 desktop tests; focused destination tests pass 79 + 63.
- Final-source isolated Rust tests pass 281 library cases, the explicitly invoked
  synthetic export, 25 browser-host cases and seven optimized glib regressions:
  314 total. Strict release Clippy, formatting and production build pass.
- The final packaged app passes ten private GNOME X11/Ghostty cases. A held Start
  waits for D release even while Alt remains held; repeated warm Start/Stop cycles
  deliver five complete phrases, totaling 76 bytes, with no Enter/control bytes.
  The expected four-word phrase has two punctuation variants frozen before the
  final run. Switching to a new tab retains recovery and adds no receiver bytes.
- The final helper passes separate 22-stage X11 and native Wayland matrices:
  tabs, splits, menus, search, focus roundtrips, readonly/exited-child limits,
  preferred clipboard guards and exact inert-PTY receipts. Early harness scope
  labels say prototype; frozen source hashes identify the final production helper.
- The packaged app passes nine Chromium delivery/recovery/lifecycle cases and
  native GNOME Wayland onboarding with complete synthetic audio, transcription,
  capture release and an unchanged private clipboard.

Fresh package installation/removal, exact installed worker execution and graphical
installer opening are separately bound in the release validation manifest.
Prior .55 VM input/service evidence remains historical: the speech runtime,
private input helper, service and associated source/license notices have identical
bytes apart from the speech manifest's version fields. No new kernel-input or
physical-microphone claim follows from that parity.

## Limits and retained failures

The focused Ghostty canvas proves pane identity, not caret position, writable mode,
password state or text readback. Terminal delivery confirms dispatch and never
sends Enter or terminal control characters. Generic desktop paste cannot make
focus changes atomic; uncertain delivery is retained without automatic replay.
Stop before changing destinations and review terminal text before submitting it.

Owner input, microphone, clipboard and profile were not used in qualification.
Native Wayland helper/clipboard checks, X11 full-app speech, private synthetic
capture, local-container installation and historical VM evidence remain distinct.
Other applications, physical microphones, default PipeWire, owner-perceived motion
and other distributions require their own acceptance. Existing security maintenance
warnings remain visible; this is not a security certification.

Retained failures include the original .55 rejection, the first candidate's real
warm shortcut race, invalid fixture accessibility configuration, missing explicit
fixture focus, a strict punctuation expectation and an initial isolated-test mount
setup error. Final runs correct the relevant source or fixture cause; failed
artifacts are not replaced or reported as passes.
