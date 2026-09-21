# Fresh-install investigation — 21 September 2026

Scope: the published Ubuntu/Debian .47 package and a source candidate based on
`913247757ab32994cf122daba22230e1d0dc57d9`. The candidate is not a new release or an
installed fix. Raw host traces and screenshots remain private, outside Git.

## Installation and footprint

The tested .47 package is 689,522,432 bytes (657.6 MiB), SHA-256
`7164521ff55c59fc00310db5bea051cdfad020371e52abcbf202c15eb8d34743`.
Its pinned English Q8 model is 699,872,960 bytes (667.5 MiB) uncompressed;
the VOCO executable is 14,298,848 bytes (13.6 MiB). Model weights dominate the
package, so removing small UI components would not materially reduce downloads.

The reported installation fetched an additional 802 kB from the Ubuntu mirror in
31 seconds. The host APT history records roughly five seconds for unpack/configure.
The original package-download duration was not retained; total installation time
cannot be reconstructed from these logs.

A subsequent sequential comparison downloaded the complete, identical release:

| Transfer | Wall time | SHA-256 matched |
| --- | ---: | --- |
| Existing wget transfer | 22.519 s | Yes |
| Experimental four-range transfer | 23.216 s | Yes |

The experiment did not improve this full transfer and was removed. An earlier
small range probe suggested a benefit; it did not predict full-package results.
One local timing pair cannot establish performance on other connections.

The retained installer changes report elapsed download time and make only the
owned public-package staging directory readable by APT's unprivileged reader.
Checksum verification, bounded retries and private diagnostic logs are preserved.
These improve measurement and remove the `_apt` root-fallback warning; they are
not evidence of a shorter initial download.

One post-onboarding ready-state process-tree snapshot used about 1,275 MiB PSS,
including about 957 MiB in the speech worker. PSS accounts for shared mappings;
this snapshot is not a cross-machine memory benchmark. Warm model loading helps
first-dictation latency. Model/app separation could avoid downloading unchanged
weights on upgrades, but would not eliminate their first-install transfer.
Smaller quantization or idle unloading needs matched accuracy and latency trials.

## Onboarding control

The recording button's later glass styles overrode its transparent inner style,
leaving two nested capsules. Keyboard focus outlined only the button. The candidate
keeps the button and live meter inside one capsule with one group focus outline.
The microphone icon and branding are unchanged. Meter height follows actual input;
short bars at silence are not a failed audio signal.

The keyboard-focus regression fails on the baseline and passes on the candidate.
All five brand-motion browser groups pass. An isolated GTK fixture using the host's
WebKit 2.52.6 provides native-engine screenshot evidence. It uses synthetic text and
meter values, not a physical microphone. Playwright's WebKit driver was unavailable
because its bundled dependencies were missing; no host packages were installed.

## Dictation after onboarding

The successful microphone test was followed by six shortcut attempts rejected at
cursor preflight, before capture or recognition started. The desktop-input helper
check passed and the Wayland input service was active. Recognition readiness does
not establish delivery into an external field.

The .47 trace records only a generic preflight failure. Read-only accessibility
observations later showed both ambiguous windows and unavailable focused-control
metadata, at different moments. Those observations cannot identify the destination
or exact condition during the earlier attempts. Reproduction requires the target
app and field; no host accessibility setting or destination guard was changed.

The source candidate adds finite cursor-failure categories to local diagnostics.
Python rejection tests cover the categories and preserve token rejection; Rust
maps only known categories to fixed events. Text, titles and destination identities
are not logged. This improves diagnosis and does not claim to fix the unverified
external-field failure.

## Candidate verification

- Installer/DevOps checks passed, including nine presentation, retry and cleanup cases.
- Focus/delivery Python suites: 82 passed; native Rust insertion suite: 22 passed.
- Type checking, ESLint, Rust Clippy with warnings denied and frontend production build passed.
- Brand-motion browser checks: five groups passed; native WebKit screenshot inspected.
- The first native test attempt lacked PulseAudio development headers. The successful
  retry used an existing extracted header cache, without installing host packages.
- No new package or release was built, and no destination application was qualified.

## Codex and Brave follow-up

The user identified Codex and Brave as the failed destinations and reported no
notification. A later read-only inspection of the running Codex accessibility
window found no exposed editable control. Neither app's command line requested
renderer accessibility; the desktop accessibility switch was off.

The Chromium 151.0.7922.34 comparison used a disposable profile, private D-Bus and
runtime directory, and Xvfb with explicit `--ozone-platform=x11`. Both cases enabled
the native accessibility bridge (`ACCESSIBILITY_ENABLED=1`). The same synthetic
input was focused; no speech, clipboard or keyboard delivery was attempted.

| Renderer accessibility | Production cursor probe |
| --- | --- |
| Default | `no_focused_control`, no destination token |
| `--force-renderer-accessibility` | `ready`, verified control token |

This is a reproducible compatibility condition, not qualification of the user's
Codex/Brave editors. It supports an explicit application-accessibility trial while
preserving the cursor guard. See [Chromium's activation instructions](https://www.chromium.org/developers/accessibility/testing/automated-testing/ax-inspect/)
and [native bridge activation](https://github.com/chromium/chromium/blob/main/ui/accessibility/platform/atk_util_auralinux.cc).
An earlier fixture attempt lacked explicit display isolation; its results are
excluded. A second attempt failed because Chromium selected Wayland in the private
runtime; the final comparison explicitly selected Xvfb/X11.

The Brave Snap denied the diagnostic process's accessibility query. That process
has the desktop host application's security label; installed VOCO and its helper
have the ordinary `unconfined` label accepted by Brave's policy. The denial cannot
be attributed to installed VOCO without an equivalent production-context check.
No confinement rules or browser profile were changed.

The production recording-factory tests now assert that rejected cursor and setup
preflights request the corresponding notification exactly once and never acquire
the recording shortcut or microphone. All 18 lifecycle tests passed, as did type
checking and lint. These tests verify dispatch, not native banner visibility.

## Missing notification banners

The host runs GNOME Shell 46. Global and VOCO-specific banner settings were enabled,
the desktop was unlocked and available, and Codex was not fullscreen. These settings
were verified with `/usr/bin/gsettings`; the Homebrew command earlier on PATH read
schema defaults and was excluded from the diagnosis.

GNOME accepted the short-lived `notify-send --app-name=VOCO` request, then closed
notification 61 after **34 ms**, with close reason 2. The installed Shell source
explains this behavior: `FdoNotificationDaemonSource` watches the sender's bus name
and destroys a registered application's notification source when that sender exits.
VOCO's installed desktop entry makes this registered-app path applicable.

Repeating the diagnostic with `notify-send --wait` kept the sender alive, and the
user confirmed the banner was visible. This establishes the notification-lifetime
failure independently of the rejected cursor preflight. The first lifetime harness
blocked reading buffered output from `--wait`; after user confirmation its test
process was terminated. Preserve that harness failure: only the baseline has a
machine-recorded close time, and the positive result is a human visibility check.

The source fix replaces the helper process with GIO over the existing session bus,
retaining the connection for VOCO's lifetime. It uses the installed VOCO icon and
desktop entry, normal urgency and the desktop's default expiry. No dependency or
desktop preference is added. Notify calls run off the UI thread with a three-second
reply deadline. Failed or uncertain requests are not retried; the next independent
request can reconnect after a closed connection. Fixed trace events record acceptance,
connection failure, request failure or an invalid reply without notification content.

Three native tests use private D-Bus services and exercise retained sender ownership,
connection reuse/reconnection, request rejection, invalid IDs, the production reply
deadline and failure recovery without retries. A deliberate sender-drop mutation
fails at `sender must outlive Notify`; the final candidate passes all three tests.
The standalone test build uses the application's resolved GIO/WebKit/glib libraries.
A separate diagnostic compiled from the exact production module was accepted by the
host service and kept its bus connection alive for 12 seconds. This transport check
does not by itself prove visibility. After requesting a resend, the user confirmed
seeing **VOCO notification fix** from that native code, with the VOCO icon. Rust
Clippy passed for all targets with warnings denied. Formatting and diff checks passed.

Initial test-fixture compilation failures are retained in the private evidence.
They are excluded from the passing checks; no dependency upgrade was needed.

The installed .47 package remains unchanged. This source fix does not qualify
dictation into Codex or Brave; their actual editor/accessibility trial is still open.
