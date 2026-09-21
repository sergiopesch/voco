# .51 tray, setup and speech-engine integration

The next local **2026.0.51** candidate combines the .50 baseline `f5449fa`,
tray/setup work and committed engine retirement `9dc0c1a`. The working owner .50
installation and frozen previous candidates are preserved. No default-branch
merge, tag or publication is part of this qualification.

## Behavior

- Alt+D changes the native tray's Ready presentation to five measured-volume
  bars at the compact icon size. A bounded envelope responds quickly to rising levels and settles during
  silence; it never invents listening activity. Stop restores Ready. The wider seven-bar GNOME
  panel also follows levels more frequently, with separate attack/release
  easing and system reduced-motion support.
- Native tray frames are a fixed set of 64 retained immutable PNGs. Only an active
  recording runs the timer; hidden fallback icons do not receive frame updates.
  GTK presentation work runs after worker locks are released, avoiding a circular
  wait with Shell requests or the animation callback. Host panels control their
  own icon size and rendering cadence.
- Change microphone replaces the test content inside the same setup canvas.
  Native selection requires explicit consent; a successful selection returns
  focus to Start test. Failed selection stays visible and never starts capture.
  Expanded microphone details and completion controls fit the 760×560 minimum
  window at normal text scale. Accessibility enlargement remains scrollable.
- All recognition routes use the bundled Nemotron model. Whisper's code,
  downloader, vendor trees and dependencies are removed. A source/dependency
  gate runs in `npm test`; package descriptions and current recovery instructions
  match the remaining engine. Historical reports, pinned guide source and upstream
  model/sample attribution retain their original facts.

## Evidence

The old microphone layout reproduced a 743-pixel scroll area inside a 567-pixel
canvas. Chromium presentation checks now cover the smaller window, expanded
details, successful selection, completion/restart feedback, keyboard navigation,
reduced motion and high contrast without that page overflow.

Combined source checks passed type checking, lint, full npm tests (449 frontend
tests), 283 Rust test executions (one ignored audit-export fixture), clippy,
version consistency, DevOps checks and production builds. Renderer checks passed
16 dictation scenarios, 31 microphone scenarios and 42 native-capture scenarios,
including failed selection staying open and successful selection returning focus.
These renderer tests mock the native/media boundary.

The optimized combined application passed a private GNOME 46 X11/PulseAudio
journey: fresh onboarding, Done/launcher handoff, two real Alt+D recordings into
a Chromium rich editor, panel Stop, native fallback meter/Stop, companion
reconnection and focus-departure recovery. The public speech fixture produced
20 distinct advertised meter frames; retained-path and visible Shell actor checks
passed. Dedicated captures distinguish advertised frames from Shell paint.
The pinned speech corpus and repeated-speech check passed at 2.5% aggregate WER;
that small fixture corpus does not establish general accuracy.

The nine pinned-guide tests and browser checks for chapters, source viewer,
search, glossary, simulations and narrow layout passed. No guide source pin changed.

Private logs, artifact hashes, desktop images, harnesses and failed attempts are
retained in the sibling `tray-setup-evidence-2026-09-21` directory. Earlier desktop
attempts include socket-path/setup failures, a stale test selector and the lock
conflict corrected here. They are not counted as passing runs. Playwright WebKit
could not launch because its separate browser runtime libraries are absent;
the native GNOME journey uses the installed WebKitGTK application instead.

## Before release

Use the exact complete package and its external hash/verification receipt for
installation testing. Source, extracted-package and private desktop fixtures do
not establish a fresh installed VM, physical microphone behavior, perceived
smoothness on the owner's panel, every compositor or every destination app.
The local package must pass its own payload/metadata checks, and protected CI
must pass on the final source before a public cut. Keep physical Alt+D, volume
response, silence, repeated Stop and minimum-window onboarding in owner acceptance.
