# Cursor Streaming QA Results

Use this file to record the release-candidate evidence for
[cursor-streaming-manual-qa.md](./cursor-streaming-manual-qa.md).

## Canonical v3 Workspace Validation

- Date: 2026-07-15
- Candidate version: 2026.0.21
- Scope: current workspace plus an isolated installed-package local-container smoke; not a remote
  VM or physical installed-package desktop run
- Private input-method protocol: v3
- Automated result: **passed**
- Final 2026.0.21 Debian bundle build and payload verification: **passed**
- Installed-package local-container X11/GTK smoke: **passed** (`cbx_d7d1979c5580`)
- Remote/physical installed-package Wayland/X11 matrix: **pending under the documented active-host
  safety release exception**

The enhancement-off stable cursor path now keeps rolling previews revisable in IBus preedit and
commits only authoritative canonical chunks. Complete 30-second ranges overlap by one second and
finish at 30, 59, 88 seconds, and subsequent 29-second strides. Cached exact chunk results are final
truth; stop processes only deferred complete work and the remaining partial range. Enhancement modes
remain overlay preview plus one-shot final insertion. An uncertain mutating IPC result is never
retried.

Automated evidence recorded for this candidate:

```text
npm run test:owned-preedit
status: passed
detail: 17 ownership + 9 protocol + 53 engine Python tests passed

npm test
status: passed
detail: 192 frontend tests passed, 2 skipped; trace, baseline, and reset helpers passed

npm run test:private-ibus
status: passed
detail: private DBus/IBus lifecycle; fresh-safe positive path; ambiguous-default, terminal,
password, private, unchanged-tuple global-proxy suppression, focus, ordinary-key, reset,
source-switch, target-close, and disconnect cases

cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --all-targets --all-features
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets
cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
status: passed
detail: 137 Rust tests passed; locked all-target check and warning-denied Clippy passed

npm run verify:security
cargo audit --file apps/desktop/src-tauri/Cargo.lock
status: passed
detail: 0 npm vulnerabilities and 0 Rust vulnerabilities; RustSec reported 19 allowed
transitive unmaintained/unsound warnings documented for the current GTK3-era dependency stack

VOCO_CAPTURE_TIMELINE=$HOME/.local/state/voco/debug-captures/dictation-1784040735874.json \
VOCO_MODEL_PATH=$HOME/.local/share/voco/models/ggml-base.en.bin \
npm run test:captured-dictation
status: passed
detail: 1 file, 2 tests passed

nice -n 10 env CARGO_BUILD_JOBS=2 CMAKE_BUILD_PARALLEL_LEVEL=2 npm run build
status: passed
artifact: apps/desktop/src-tauri/target/release/bundle/deb/VOCO_2026.0.21_amd64.deb

bash scripts/verify-deb-package.sh \
  apps/desktop/src-tauri/target/release/bundle/deb/VOCO_2026.0.21_amd64.deb \
  2026.0.21
status: passed
detail: version, architecture, dependencies, paths, ownership, modes, exact IBus payload,
desktop/AppStream identity, icons, and artifact hygiene
sha256: 2ba04305a1dede12614f1fdba72376f670f33b7ded72a43d0be6b4ebb76da661
size: 7667592 bytes
```

Installed-package isolation evidence:

```text
Crabbox canonical lease: cbx_d7d1979c5580
provider: local-container (Ubuntu 24.04 image); not a remote VM, microVM, or physical desktop
status: passed; lease stopped and deleted after verification

package: exact hash/size matched before and after apt install; dpkg installed/2026.0.21/amd64;
dpkg --verify and ldd clean; root ownership/modes, payload hygiene, desktop/AppStream, IBus
component identity, packaged Python imports, and launcher lifecycle passed

private IBus: exact checkpoint/final/cancel, visible preedit signal, no deletion, ordinary-key,
focus/reset/source/destroy/disconnect invalidation, same-real fresh-proof requirement, fake focus,
ambiguous default, and PASSWORD/PIN/PRIVATE/TERMINAL rejection passed

X11/GTK3: Xvfb + openbox + private DBus/IBus + real Gtk.Entry passed visible safe preedit,
provisional isolation, exact canonical commit, xdotool key pass-through/lease invalidation,
focus/background rejection, sensitive/terminal/ambiguous rejection, and fail-closed unchanged-tuple
refocus. Packaged launcher remained healthy; a second launch was rejected while the first stayed up.

Wayland: Weston 13 headless initialized, but its backend exposed no keyboard seat, so Gtk.Entry
could not receive focus. Wayland toolkit/preedit remains unverified; this was not a VOCO crash.

cloud Crabbox: unavailable because HCLOUD_TOKEN/HETZNER_TOKEN was not configured
```

The stateful frontend suite covers the 44.1 kHz pinned sequence and the complete 10-minute sequence:
20 complete ranges through 581 seconds plus the final `[580, 600]` range, for 21 canonical ranges in
total. The pinned 66.5339375-second WAV replay proved these exact ranges:

```text
[0, 480000]
[464000, 944000]
[928000, 1064543]
```

Its cumulative canonical outputs were 222, 486, and 555 characters with SHA-256 values:

```text
38231922e9852c4c9989bc8b09861f58d526df1f52bb5266ec901636c9380931
70295ea3f276939163a362da3871926931aa334e77950a068250c9c87f1c6284
d659f33d6eee60874d0ac67d196957985d8cf0855d078ab78b8d4d5ca63bd0d7
```

The production greedy decoder was also compared over three deterministic runs against two bounded
alternatives using the saved 105-word target as the reference. Greedy `best_of=1` produced 16 edits
(15.24% WER) at a 5.207-second median. Greedy `best_of=5` was byte-identical and offered no quality
gain. Beam size 5 produced 19 edits (18.10% WER) at a 6.279-second median, making it 2.86 WER points
worse and about 20.6% slower. The release therefore keeps the current decoder unchanged.

This evidence validates pure state boundaries, Rust bridge behavior, Python
ownership/protocol/engine behavior, deterministic ASR replay, exact installed package payload, and
one real GTK3/X11 owned-preedit path inside a local container. It does not validate remote or
physical desktop integration, a Wayland keyboard seat, browser/Qt/Electron target layout, the full
input-source/tray workflow, package refresh on a resident desktop engine, or the 10-minute
wall-clock flow. Those cases remain explicitly pending and this release does not claim that the
local-container run is equivalent to installed remote/physical desktop coverage.

## Pre-v3 Installed Validation: 2026.0.19

- Date: 2026-07-14
- Environment: Ubuntu GNOME on Wayland, installed Debian package, persistent `VOCO Dictation`
  input source selected
- Capture timeline: `$HOME/.local/state/voco/debug-captures/dictation-1784040735874.json`
- Capture audio: `$HOME/.local/state/voco/debug-captures/dictation-1784040735874.wav`
- Saved target document:
  `$HOME/.local/state/voco/manual-tests/voco-2026.0.19-post-restart-live-test.txt`
- Result: **failed direct-cursor acceptance; safety behavior passed**

Artifact integrity:

```text
timeline SHA-256: 8f3f9c3dfebdbeef83d82b54201bef2f479ee4cc7cbfb39843408c178071ef01
audio SHA-256:    558deafbae26a23171d90bc37832b4c36e0f0c9eaac491288f58befc2c4713dd
model SHA-256:    a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002
```

Audio validation:

```text
format: PCM16, mono, 16000 Hz
duration: 66.533938 seconds
samples: 1064543
peak: -1.43 dBFS
RMS: -32.62 dBFS
clipped samples: 0
```

Live and replay evidence:

```text
owned-preedit updates: 55
progressive commits: 13
blocked/failure/fallback events: 0
first live text: 1788ms (target <= 1500ms)
live cursor update gap p95: 2059ms (target <= 2000ms)
preview p50/p95/max: 613/741/806ms
stop-to-final: 3992ms
stop-to-idle: 4661ms
final event: dictation_final_output_unreconciled

authoritative final: 555 characters, 112 normalized words
saved target: 528 characters, 105 normalized words
saved target versus final: 16 edits, 14.29% WER
saved target versus progressively committed text: exact match
last visible live hypothesis: 555 characters, 110 normalized words
last live hypothesis versus final: 11 edits, 9.82% WER
```

The WAV replay reproduced the authoritative final exactly with the pinned model. It also proved that
deeper preview agreement does not solve this capture: LocalAgreement-3 delayed the first divergent
hard commit by one frame but increased live WER from 5.36% to 8.93%. The wrong segment remained
stable with up to 13.8 seconds of trailing context inside the 20-second window.

The installed build behaved safely: it emitted no deletion, insertion failure, or ownership fallback
event and did not overwrite an unverified target range. It was not release-ready because it dropped
the still-owned 27-character tail (including its separator) during mismatch finalization, missed
both latency targets narrowly, and could not reconcile the earlier normal-text commits with
full-session ASR.

The immediate follow-up candidate committed the exact still-owned tail verbatim on mismatch, bumped
the private input-method protocol, lowered the native first-preview floor from 1.0 to 0.7 seconds,
and scoped trace reports to the latest app run. Those changes required a new installed-package live
validation; they did not make an earlier divergent progressive commit authoritative.

That follow-up was subsequently superseded by the canonical protocol-v3 architecture documented
above. This installed run remains useful historical failure and safety evidence, but it does not
validate v3.

The remaining recorded build, runtime, trace, and timing sections below are older 2026.0.16
evidence. They are retained for audit history and do not describe the current workspace candidate.

## Build Under Test

- VOCO version: 2026.0.16
- Build source: local workspace release build
- Launcher path: `$HOME/.local/bin/voco`
- Binary path: `$HOME/.local/bin/voco-bin`
- Binary SHA-256: `90af41edea207d8cc233738c8ff9dba97e6060e62686d9ac552ce80ac5c57d3b`
- Date: 2026-06-08

Recorded build validation:

```text
npm run build -w apps/desktop
status: passed
detail: release binary built at apps/desktop/src-tauri/target/release/voco; Tauri linuxdeploy
bundle step failed, then scripts/package-appimage.sh produced
apps/desktop/src-tauri/target/release/bundle/appimage/VOCO-2026.0.16-x86_64.AppImage

sha256sum apps/desktop/src-tauri/target/release/voco
90af41edea207d8cc233738c8ff9dba97e6060e62686d9ac552ce80ac5c57d3b

sha256sum $HOME/.local/bin/voco-bin
90af41edea207d8cc233738c8ff9dba97e6060e62686d9ac552ce80ac5c57d3b

desktop-file-validate $HOME/.local/share/applications/VOCO.desktop
status: passed
```

## Runtime

Paste the output of:

```bash
npm run report:linux-runtime
```

Recorded evidence:

```text
VOCO Linux runtime report

Timestamp                2026-06-08T16:22:34+01:00
Distro                   Ubuntu 24.04.4 LTS
Kernel                   Linux 6.17.0-1025-oem x86_64 GNU/Linux
Desktop                  ubuntu:GNOME
Session                  wayland
Display server           wayland-0
Runtime dir              /run/user/1000
Socket path              /run/user/1000/voco.sock
Input group              yes

ydotool                  /usr/bin/ydotool
ydotoold                 active
wl-copy                  /usr/bin/wl-copy
wl-paste                 /usr/bin/wl-paste
xdotool                  missing
xclip                    missing
```

## Trace Reset

Recorded reset evidence:

```text
VOCO cursor streaming trace reset

Trace file: $HOME/.local/state/voco/hotkey-trace.jsonl
Archived previous trace: $HOME/.local/state/voco/hotkey-trace.2026-06-08T152359657Z.jsonl
status: reset-ready
```

## Baseline Config

Paste the output of:

```bash
npm run report:dictation-baseline
```

Recorded baseline evidence:

```text
VOCO dictation baseline config report

Config file: $HOME/.config/voco/config.json
status: baseline-ready
detail: cursor target, stable cursor streaming, and enhancement-off baseline are configured

Required baseline settings
transcriptTarget: ok (actual=cursor, expected=cursor)
liveCursorMode: ok (actual=stable-cursor-streaming, expected=stable-cursor-streaming)
transcriptEnhancement: ok (actual=off, expected=off)
```

## Automated Validation

Recorded evidence from 2026-06-08:

```text
npm run check
status: passed

npm test
status: passed
detail: report script tests passed; Vitest 14 test files, 99 tests passed

npm run lint
status: passed

cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
status: passed
detail: 63 Rust tests passed

cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
status: passed

npm run verify:versions
status: passed
detail: version metadata is consistent at 2026.0.16
```

## Timing Report

Paste the output of:

```bash
npm run report:cursor-streaming
```

For each duration case, also paste the matching thresholded report:

```bash
npm run report:cursor-streaming -- --min-duration-ms 10000
npm run report:cursor-streaming -- --min-duration-ms 60000
npm run report:cursor-streaming -- --min-duration-ms 300000
npm run report:cursor-streaming -- --min-duration-ms 600000
```

For final-only long dictation, paste the matching final-only report:

```bash
npm run report:cursor-streaming -- --expect-final-only --min-duration-ms 60000
npm run report:cursor-streaming -- --expect-final-only --min-duration-ms 300000
npm run report:cursor-streaming -- --expect-final-only --min-duration-ms 600000
```

Recorded timing evidence:

```text
VOCO cursor streaming trace report

Trace file: $HOME/.local/state/voco/hotkey-trace.jsonl
Entries read: 174
Latest completed dictation session: 1
Reported dictation session scope: 1

Evidence status
status: dictation-session-observed
detail: 1 completed session(s), 1 final output event(s), 1 first live text event(s), 26 live cursor update event(s), 52 live preview event(s), 1 overlay fallback event(s), 0 live preview fallback event(s), 1 non-destructive final fallback event(s)

Timing events
event,count,min,p50,p95,max
dictation_recording_duration,1,123185ms,123185ms,123185ms,123185ms
dictation_first_live_text_visible,1,6665ms,6665ms,6665ms,6665ms
dictation_live_preview_completed,52,1023ms,1073ms,1311ms,2112ms
dictation_stop_to_final_transcript,1,9488ms,9488ms,9488ms,9488ms
dictation_stop_to_idle,1,9740ms,9740ms,9740ms,9740ms

Notable events
recording_get_user_media_constraints_fallback: 0
recording_get_user_media_default_fallback: 0
dictation_live_cursor_insert_updated: 26
dictation_live_cursor_insert_failed: 0
dictation_live_cursor_unsafe_rewrite_blocked: 1
dictation_live_cursor_overlay_fallback: 1
dictation_live_cursor_final_unreconciled: 1
dictation_final_output_completed: 1
dictation_final_insertion_failed: 0
dictation_live_preview_failed: 0
dictation_live_cursor_commit_waiting: 14
```

This trace contains one completed stable-cursor dictation session of about 123 seconds. It proves
privacy-safe timing, continued preview activity, continued cursor update activity, final output
completion, and return to idle. It does not by itself prove that every visible target-app case in
the manual matrix passed.

Recorded threshold evidence:

```text
npm run report:cursor-streaming -- --min-duration-ms 10000
status: dictation-session-observed
detail: 1 completed session(s), 1 final output event(s), 1 first live text event(s), 26 live cursor update event(s), 52 live preview event(s), 1 overlay fallback event(s), 0 live preview fallback event(s), 1 non-destructive final fallback event(s)

npm run report:cursor-streaming -- --min-duration-ms 60000
status: dictation-session-observed
detail: 1 completed session(s), 1 final output event(s), 1 first live text event(s), 26 live cursor update event(s), 52 live preview event(s), 1 overlay fallback event(s), 0 live preview fallback event(s), 1 non-destructive final fallback event(s)

npm run report:cursor-streaming -- --min-duration-ms 300000
status: recording-duration-too-short
detail: 1 completed session(s), but longest recording duration was 123185ms below required 300000ms
```

Recorded final-only threshold evidence:

```text
npm run report:cursor-streaming -- --expect-final-only --min-duration-ms 60000
status: final-only-live-events-observed
detail: 80 live preview/cursor/fallback event(s) observed during final-only validation
```

That historical trace passes the 10-second and 1-minute stable-cursor streaming duration gates. It
does not prove the 5-minute or 10-minute gates yet. The final-only report fails correctly because
this trace contains live preview and cursor events; final-only validation must be run against a
fresh final-text-only trace. During manual QA, each duration case must pass with its own
minimum-duration threshold and expected mode before the result can be treated as proven.

## Manual Matrix

| Case | Target app | Result | Notes |
| --- | --- | --- | --- |
| Empty field, short sentence | Text editor | Pending | Requires visible target-app QA |
| Empty field, 20-30 second paragraph | Text editor | Pending | Requires visible target-app QA |
| 29.9/30/30.1-second boundaries | Text editor | Pending | Verify first checkpoint and stop remainder |
| 59/88-second boundaries | Text editor | Pending | Verify overlapping checkpoint cadence |
| 1-minute dictation | Text editor | Pending | Requires installed duration evidence |
| 5-minute dictation | Text editor | Pending | Requires installed duration evidence |
| 10-minute automatic stop | Text editor | Pending | Requires installed cutoff and 21-range evidence |
| Existing text before cursor | Text editor | Pending | Requires visible target-app QA |
| Existing text after cursor | Text editor | Pending | Requires visible target-app QA |
| Cursor in middle of paragraph | Text editor | Pending | Requires visible target-app QA |
| Double `Alt+D` | Text editor | Pending | Requires visible target-app QA |
| Stop while preview is in flight | Text editor | Pending | Requires visible target-app QA |
| Speak, pause, continue | Text editor | Pending | Requires visible target-app QA |
| Punctuation-heavy dictation | Text editor | Pending | Requires visible target-app QA |
| Whisper-revised phrase | Text editor | Pending | Requires visible target-app QA |
| Enhancement enabled | Text editor | Pending | Verify overlay preview and one-shot final only |
| Uncertain checkpoint response | Text editor | Pending | Verify no retry or global insertion |
| Protocol-v3 package refresh | Text editor | Pending | Verify old engine fails closed until refreshed |
| Same real context after focus loss, no fresh metadata | Text editor | Pending | Must remain preview-only until the current focus reports fresh safe metadata |
| Fake/global proxy then same real context | Text editor | Pending | Earlier content proof must not survive |
| Password/PIN/private/hidden target | Sensitive input | Pending | Must emit no owned-preedit command and stay preview-only |
| Missing or ambiguous content metadata | Text field | Pending | Must stay preview-only |
| Browser textarea | Browser | Pending | Requires visible target-app QA |
| Chat input | Chat app/input | Pending | Requires visible target-app QA |
| Terminal prompt | Terminal | Pending | Verify intentional preview-only fallback and ordinary idle typing; live cursor is unavailable |

## Pass/Fail Summary

- Existing text deleted: Pending manual QA
- Raw key codes or stray numbers: Pending manual QA
- Duplicate final transcript: Pending manual QA
- Live words stopped without trace explanation: Pending manual QA
- Stop returned to idle quickly: Pending manual QA
- Final text acceptable: Pending manual QA
- Expected canonical checkpoint cadence: Pending manual QA
- Enhancement overlay/one-shot separation: Pending manual QA
- Uncertain mutation produced no retry: Pending manual QA
- Fresh per-focus content proof enforced: Pending installed manual QA
- Terminal/sensitive/ambiguous targets remained preview-only: Pending installed manual QA
