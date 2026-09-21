# .50 panel and launcher verification

This unpublished candidate includes the .49 rich-editor correction. The owner
remains on .49; the published Debian release remains .47. Neither was replaced
to run these checks.

## Findings and changes

An isolated .49 GNOME 46 reproduction advertised seven successive startup PNG
paths, deleted six while the app was alive, exposed no native status label, and
rejected a second launch. This proves a file-lifetime defect; it does not identify
the cause of every previously observed desktop icon warning.

The .50 package maps the five GNOME companion files into the system extension
directory. Checking is read-only. Explicit activation preserves other extensions
and the global policy, and distinguishes active from next-login activation.
Package hooks do not modify user settings. Other GNOME versions retain the native
tray fallback.

Native status includes a visible label where supported and a menu status row.
Start and Stop have separate menu IDs: a delayed Stop cannot turn into Start.
Four immutable state PNGs and the library's initial PNG remain readable for the
process lifetime. The additive tray-icon 0.23.1 patch retains upstream licenses
and a source inventory; no dependency version was upgraded.

Done leaves the ready interface visible. Normal launcher activation uses its own
owner-only socket and presents the existing idle app. Starting, recording and
processing preserve the current recipient and capture. The existing `--toggle`
control path is unchanged.

## Evidence levels

- Renderer checks cover explicit panel activation, restart feedback, the minimum
  window with scrolling, onboarding handoff and launcher admission. Native API
  mocks cannot prove GNOME presentation or speech delivery.
- The private GNOME 46 nested Wayland fixture covers installed-after-login setup,
  read-only checks, required sign-out, activation on a fresh Shell session,
  synthetic meter states, accessibility, reconnect and delayed PNG readers.
- A private full GNOME 46 X11 session exercises fresh onboarding with virtual
  PulseAudio, actual recognition, two cursor dictations into Chromium's rich
  editor, live panel levels, repeated panel Stop, fallback Stop delivered again
  after idle, launcher focus preservation and recovery after target departure.
  The final source trial passed these paths; its debug executable was
  `dca8ac649fc3a234819483097b652d071f9dc6151ebaceb63f364f6ec391533a`.
- Complete Debian assembly, exact executable/model hashes, package-manager
  install/remove and repetitions using the extracted final package belong in
  the private candidate directory's qualification record. A base Tauri package
  is incomplete and is never the installable deliverable.

The first two full-app source trials found an asynchronous Shell activation
reporting defect and an explicit Stop admission defect. Their failures are
retained with the two subsequent successful source trials. Screenshots from
earlier full-app attempts were unavailable because the capture helper had not
initialized GDK; those attempts provide state/trace evidence only. Final artifact
checks require successful screenshot creation.

These checks use isolated input, D-Bus, audio and profile directories. They do not
qualify a physical microphone, the owner's live session, every Linux desktop or
every editor. The selected model, worker thread policy and cursor no-replay
contract are unchanged. Final hosted CI, including all speech gates, must pass
before qualification; publication and owner installation are separate actions.
