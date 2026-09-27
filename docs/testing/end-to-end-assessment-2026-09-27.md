# VOCO end-to-end assessment — 27 September 2026

## Scope and outcome

Four parallel reviews covered recording/recovery, native input and shortcuts,
the speech runtime, and delivery infrastructure. The starting master was
`57f858bd38c018bb3fd5847862d7d5756e01dda5`; the reviewed open candidate was PR
[#79](https://github.com/sergiopesch/voco/pull/79), head
`b5089fb2b2b81384e14f31194a80666705714975`.

PR #79 was merged as `6b65aba83364847f808c5d2045d2085c8615d49d` after
review and verification of its four successful hosted CI checks. It requires
the loaded GNOME Wayland companion and the current capture's Stop reservation
before opening the microphone for Alt+D or Alt+Shift+D.

This assessment also produced the source fixes below. Their PR's checks are
the authority for subsequent hosted verification; PR #79's older green run
does not qualify these additional edits.

The latest public release was independently checked on GitHub as
**2026.0.59**. Merging source does not update an installed application or
publish a new package. A new binary needs a new version, complete pinned
runtime, package qualification, signatures and public-asset verification.

## Findings and changes

| Finding | Result |
| --- | --- |
| GNOME can leave Alt+D visible to the recipient without a loaded companion | Merged #79 gates Start on live, capture-bound Stop ownership. Existing selection/focus guards remain. |
| WebKit startup cancellation or failure can discard already received audio | Reproduced with a failing lifecycle test. Startup teardown now retains every received sample for explicit recovery, regardless of capture backend. |
| Empty cancellation must not create empty recovery | Regression verifies zero samples return to idle; no target paste occurs in the startup regressions. |
| Slow inference at Stop lacked combined queue/tail/recovery coverage | Added four cases at 16 kHz and 44.1 kHz: delayed completion flushes the exact tail once; gradual overload preserves all received source for explicit recovery without automatic paste. Production bounds are unchanged. |
| CI omitted microphone evidence and did not request dictation renderer JSON receipts | Both paths are now retained by CI. The disabled release workflow has matching evidence configuration and remains disabled. |
| Setup documentation described the newly required GNOME companion as optional | Updated the integration contract and unsupported-version guidance. |
| Code map equated app readiness with the installer CLI | Documented the app's companion checks and the CLI's intentionally helper-only check. |
| Speech fixture guide still instructed users to supply the retired Whisper model | Updated provisioning, Nemotron invocation, actual report fields and real-model versus source-test distinction. |

No new confirmed native insertion or speech-protocol defect was found in this
review. That is a scoped review result, not proof of absence of bugs.

## Beginning, middle and end

| Stage | Reviewed behaviour and evidence |
| --- | --- |
| Install and launch | Version/signature/helper checks, installer journey, published/source distinction, complete-runtime packaging and onboarding. |
| Start | Readiness, exact editable destination, GNOME reservation, queued Stop during setup, cancellation before Listening and microphone permission separation. |
| Dictate | Bounded 100 ms worker packets, sample/sequence accounting, append-only delivery, content/caret observation and focus-loss invalidation. |
| Stop | Same-stream tail flush, capture-bound Stop identity, delayed callbacks, reservation expiry, no automatic Enter and no uncertain replay. |
| Recover and repeat | Retained source samples, explicit local retry, cancellation, stale-session cleanup and no destination callback during recovery. |

Native review covered first-delivery-only selection replacement, revalidation
after clipboard preparation, delayed caret/content propagation, focus departure
and return, terminal-surface classification, rejected renewals and stale replies.
Desktop clipboard/key gestures remain non-atomic with concurrent focus changes.

## Fresh local verification

Environment: Ubuntu 24.04 userspace, Node 24.19.0, npm 11.9.0. Native desktop
namespaces, Unix sockets and process introspection are restricted here.

| Check | Outcome |
| --- | --- |
| New startup regression before fix | Failed: recovery was null after retained WebKit audio. |
| Desktop frontend after startup fix | 401/401 tests, 47 files passed; three new startup regression rows. |
| Slow-worker Stop follow-up | Four additional queue/tail/recovery regressions; combined suite 405/405 passed locally, plus typecheck and lint. Native IPC is mocked, so this is not physical-device or real-model endurance evidence. |
| TypeScript, ESLint, production frontend build | Passed. |
| Independent focused lifecycle review | 22/22 tests passed. |
| Focus cache / delivery observation | 79/79 and 68/68 passed. |
| Panel presentation / setup | 4/4 and 6/6 passed. |
| IBus ownership model | 17/17 passed. |
| Version consistency, release rehearsal, installer journey | Passed; journey 6/6. |
| Workflow YAML and diff whitespace | Passed. |
| npm dependency audit | Zero reported vulnerabilities. |
| Speech source tests without process introspection | 23/23 passed; full 30-test attempt had seven environment failures. |
| Remaining npm chain segments run independently | 17/18 commands passed; IBus protocol blocked by socket restrictions. These are commands, not a combined test count. |

Full `npm test` and `verify:devops` did **not** pass locally. Preserve these
limitations: NumPy/psutil were initially missing; isolated dependency provisioning
resolved imports, but psutil could not resolve the current sandbox PID. IBus
protocol had six passes, five errors and one failure among 12 attempts due to
prohibited socket creation. Installer launch fixtures had 12 socket errors.
The private application fixture was blocked by namespace creation. Rust/toolkit
dependencies were absent, system-package installation was denied, and Playwright's
browser download failed archive validation. No sandbox policy or test gate was
weakened, and no audio/keys were injected into an active user desktop.

## Existing hosted evidence, verified independently

PR #79's exact-head CI run
[35924493850](https://github.com/sergiopesch/voco/actions/runs/35924493850)
passed Code Guide, Frontend Checks, Rust Check & Test and RustSec Audit.
Its steps include private GNOME Stop, native GTK/Wayland/IBus, application/editor
delivery, renderer/onboarding, backport validation and production frontend build.

The inspected Rust job reports 288 passed tests and one ignored test. Its pinned
runtime checksum and model/native identities passed; the eight-clip speech smoke
and repeated-speech checks passed with aggregate WER 2.5%, and the real-worker
protocol passed 13 checks. This small corpus does not establish conversational,
accent, physical-microphone or long-session accuracy. Mocked five-minute renderer
audio is not a real-model endurance measurement.

RustSec passed with eight visible warnings: seven unmaintained transitive
dependencies and the existing rand 0.7.3 advisory. The graph is not warning-free;
no advisory was hidden or gate waived by this review.

The native evidence archive was downloaded and matched its recorded SHA-256
`2980d5fa1ec06a111ab39a9f1739b5d122bbad4884597f8cd92b99a8bed3e582`.
Visual inspection of its onboarding, restart guidance, stalled-capture recovery
and minimum-size shortcut screenshots found readable controls without visible
clipping in those states. The archive also records seven branded-interface
checks and six application groups (GTK3, GTK4, WebKit, GNOME Text Editor,
GNOME Terminal/Bash and GNOME Terminal/nano). These are dated fixtures, not a
new observation of the owner's installed desktop.

## Remaining acceptance work

1. The owner's Codex partial-text/Stop failure remains **unattributed**. The
   [owner-session record](owner-stop-2026-09-23.md) distinguishes destination
   rejection, recognizer backlog and prefix revision. Neither #79 nor the
   startup-retention fix establishes its cause or resolution.
2. Qualify a new complete signed package in an isolated desktop: fresh install,
   upgrade with a stale companion, sign-out/sign-in, onboarding, repeated short
   dictation, immediate Stop, long natural speech, recovery and removal.
3. Verify physical Alt+D consumption and microphone behaviour on the owner's
   supported GNOME session, including Brave, the actual Codex composer and
   Ghostty. Record exact package identity and attempted/passed/failed cases.
4. For any failed natural session, retain content-free performance/hotkey traces
   through normal shutdown and distinguish admission, capture drain, worker
   finish and destination rejection. Never publish personal audio or transcripts.

These are release/desktop acceptance gaps, not permission to relax the queue
bound, weaken destination ownership or replay uncertain text.
