# Wayland installation/readiness regression · 20 September 2026

## Failure and cause

A fresh .45 Ubuntu GNOME Wayland installation completed its local voice test.
All 11 subsequent shortcut attempts reached VOCO, but insertion preflight rejected
every attempt before recording. `ydotool` and `ydotoold` were absent. The guided
installer used `dpkg -i`, followed by `apt-get install -f`; the recommended input
packages were not installed, despite APT's default recommendations being enabled.
Earlier qualification used APT directly on X11, which did not cover this path.

## Regression checks

`bash scripts/test-install-common.sh` initially failed with:
`installer did not ask APT to install the local package and its recommendations`.
The revised tests cover real installer functions with package-manager substitutes:
Wayland packages, X11 independence, failed/incorrect package-manager outcomes,
readiness failure, service start failure, missing device access and existing-daemon
preservation. No permission or service mutation reaches the host in these tests.

The onboarding renderer initially failed `missing-helper must block completion`
because `onboardingCompleted` was saved. Seventeen cases now pass, including missing
helpers, a stopped daemon, exceptions/timeouts, repair without an external cursor,
local-only voice testing, capture drain, missing-cursor feedback and correct setup
error classification. Native capture/model calls are substituted in this suite.

The broader native-capture renderer has 42 passing cases. The full test suite
passes in Ubuntu 24.04 userspace, including 442 frontend tests and 30 speech-worker
tests. Two frontend tests remain skipped. Rust has 382 passing tests and one
existing ignored test, plus 26 passing integration tests (408 passing overall).
The dictation and microphone renderer suites pass 71 and 31 cases respectively;
Chromium exact-field regression also passes. TypeScript, Clippy and version checks pass. Lint has no
errors and retains four existing explicit-any warnings. Nine guide tests pass.

## Installed GNOME Wayland trial

A disposable Ubuntu 24.04 KVM guest runs GNOME on Wayland with four virtual CPUs,
its own kernel/input devices, a synthetic PulseAudio-compatible source and an
independent GTK recipient. No host input, microphone, clipboard or user speech is
used. This is a booted guest, separate from the local-container userspace checks.

The first candidate trial demonstrated real native capture and bundled recognition,
onboarding refusing completion without its daemon, successful completion after
fixture service repair, then two four-word deliveries to the same GTK field. Stop
completed in 443 and 460 ms in those two prototype sessions. These are individual
fixture observations, not latency percentiles or physical microphone measurements.

The fresh account had no raw keyboard access. One trial used the private control
command and the next used a GNOME compositor Alt+D binding to that command; it did
not prove the evdev route was available. Device permission and the compositor
binding were explicit guest-fixture setup, not automatic installer permissions.

Final complete-installer/package evidence is recorded separately from this first
prototype. A candidate is not a published release; release signing, protected CI
and downloaded public-asset checks remain release gates.

## Final complete-installer trial

The final candidate was assembled after the setup-guide URL allowlist regression
was reproduced and fixed. The installed application launched the exact setup URL
through the desktop handler; the guest handler recorded the argument instead of
opening an external browser. Only that exact documentation URL was added.

| Artifact | SHA-256 |
| --- | --- |
| Complete `.deb`, 689525834 bytes | `3bbc2d1b691d8987c96a980b0bf285d87d6889dbd5fa662e96c4e8f781e08170` |
| Installed `/usr/bin/voco` | `bfcb7bfba51c47db95bae9862039efaead3520368265fbd4121371041c322175` |
| Standalone installer | `6b886c20e15e204f333898fdf367a719e08d80b731eca8c60b99cb93c0b418e5` |

The guest's VOCO package, helpers and application state were removed before this
trial. The candidate is unpublished, so an allowlisted download transport supplied
these local files at the three expected candidate URLs. The complete installer,
checksum verification, APT, systemd and installed application ran unchanged.
This does not verify a public GitHub download or a release signature.

1. With no `ydotool`/`ydotoold` and no user access to `/dev/uinput`, the installer
   installed both helpers and the exact candidate, then exited **2**, reporting
   incomplete setup rather than success.
2. The actual voice test captured the public LibriSpeech `84-121123-0000` fixture
   through the guest audio server and ran bundled NVIDIA recognition. Finish
   refused to persist completion without the input daemon. The setup-guide button
   successfully reached the guest URL handler.
3. The fixture owner granted `/dev/uinput` access **inside the guest**. Rerunning
   the installer enabled and started `voco-ydotoold.service`, verified readiness
   and exited **0**. Finish then saved onboarding without repeating the voice test.
4. Two real GNOME compositor **Alt+D** sessions each delivered the four expected
   words into an independent GTK entry: eight words in total, in order. The final
   Stop-to-idle observations were **451 ms** and **475 ms**; onboarding was 320 ms.
5. Closing the recipient and pressing Alt+D produced a cursor preflight rejection.
   Stopping the daemon and pressing Alt+D produced a setup preflight rejection.
   Both left the recording count unchanged: three captures total, including
   onboarding, and two rejected post-onboarding starts.

The preceding full-installer candidate also passed two four-word cursor sessions
(456 ms each), with application SHA-256
`b50a12beb7e7a7db1f47e0ed7a91649f149f1dfef9c47c41d20ecf8596bddd19`.
Its package SHA-256 was
`0a1c118f5516a070f4a03857cda6bc72a1c993a06da4aa7acf12896c71d91248`.
That evidence remains separate from the final link-fixed binary above. Across the
prototype, preceding installer candidate and final candidate, six cursor sessions
were completed; only the last two qualify the final application binary.

The removal procedure was exercised between the preceding and final trials:
disable/stop the service, purge VOCO, reload the user service manager, and confirm
both `/usr/bin/voco` and the packaged service file are absent and the service is
`not-found`. Package validation checks the service's ownership, mode and exact
contents, dependencies, payload identity and desktop/AppStream metadata.

An early package assembly raced a build and retained metadata without `procps`.
The verifier rejected it; that artifact was preserved and excluded from installed
qualification. An initial renderer run failed because its native-command substitute
lacked the new readiness export; it was corrected and rerun. A userspace test
attempt on a read-only source mount failed when Vite needed a temporary directory;
the full suite passed in a writable isolated copy. None is counted as a passing run.

Private logs, synthetic recipient text, screenshots and VM harnesses are retained
outside the repository under the candidate's `evidence-local` directory. The
userspace Crabbox lease was `cbx_f16fae68d7f9` (`local-container`); the booted GNOME
trial used a separate KVM guest. No personal speech or host input was used.

These checks do not qualify physical microphones, other compositors, every target
application, automatic device-permission grants, or the public release transport.
Documentation-only edits after assembly do not change the application identity;
bundled documentation retains its assembly snapshot. Protected hosted CI remains
separate from the local evidence and must pass before release publication.
