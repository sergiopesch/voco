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
checking and lint. The desktop notification service accepted manual diagnostic
notifications with exit status zero; this does not establish that a banner was
visible. User confirmation remains necessary. The native notification wrapper also
ignores unsuccessful helper exit codes; this is a diagnostic gap, not an established
cause of the historical missing banners.
