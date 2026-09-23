# Brave Stop release qualification — 23 September 2026

VOCO **2026.0.58** is published with signed immutable assets. The final package
was built from `2496afb7e1d3904753ed20ab0dd1088b4a872b88` and cut from merged
commit `2a4d07d104a8be1b2ba32da9ccb2e7a4c1ac257a`, with identical product trees.

| Artifact | SHA-256 |
| --- | --- |
| Complete Debian package | `990d6b86b094d880031fe2dc625b73d251a2e0da99d8c4e996b52a816a7c178c` |
| Packaged app | `8f2e3321f5e0dd64d3a716538e1adb51dc2de183a2e0857e2a173a4135ed6024` |

## Findings and corrections

The original native Wayland Brave reproduction changed `Go do you hear` into
`?`: Alt+D selected the address-bar text, and the final suffix replaced it.
The correction consumes Stop in the GNOME companion, rejects selected
continuations and revalidates the prepared caret immediately before keys.
Intentional first-chunk selection replacement remains available.

Independent standards and requirements reviews both found one further defect:
a held Stop was tied to a changing presentation revision. The existing capture
session identity now owns that gesture, while dispatch uses the current action
token. Same-session state changes preserve it; replacement sessions reject it.

Release review found two more issues. Setup now distinguishes old loaded
companion metadata from newly installed files and requests a session restart.
Native reservations clear immediately when capture becomes inactive, the hotkey
changes or the renderer resets. Focused regressions and a real private GNOME
upgrade test cover the corrections. No confirmed review findings remain open.

## Final-package checks

- Six native Brave sessions across Wayland and X11 preserve the full phrase,
  including held and repeated Stop. No recovery notification or extra recording
  occurred in those cases.
- Ten Ghostty/application cases cover fresh onboarding directly to the tray,
  repeated Start/Stop, complete inert-PTY delivery and recovery after departure.
- Ten browser cases pass, including **309.18 seconds** of live public-fixture
  audio, full-reference scoring, recovery on request and teardown. The full
  reference was fixed before inference: 34 selected fixture segments, 672
  hypothesis words and 2.07% word error rate in this one run. This is a bounded
  regression result, not a general accuracy or hardware benchmark.
- Native GNOME Wayland onboarding passes complete sample accounting and keeps the
  private clipboard unchanged. Both X11 and Wayland installer launch checks pass
  with detached, unprivileged launch and no unsolicited capture.
- The packaged GNOME companion passes held/replacement gesture tests, shortcut
  cleanup, old-loaded-version upgrade reporting, fresh-session activation and
  rejection of unattached bridge callers.
- Fresh Ubuntu 24.04 local-container installation and removal verify 412 inventory
  entries, ten ELF objects, 13 installed-worker checks and 334 removed paths.
  Both task-owned qualification containers were stopped.
- 393 desktop unit tests, 284 Rust tests, strict Clippy, setup/observation tests,
  source/renderer and DevOps checks pass. One pre-existing Rust fixture-export
  test remains ignored. All four protected CI jobs and the exact merged-source
  jobs pass, including the pinned Nemotron accuracy/continuity gate and the new
  real GNOME shortcut/lifecycle CI step. No gate was waived.

[Protected CI](https://github.com/sergiopesch/voco/actions/runs/35899711556) ·
[Merged-source CI](https://github.com/sergiopesch/voco/actions/runs/35901045968) ·
[Release](https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.58).

The signed tag, five signed manifests and all 18 release assets were checked
locally, after draft upload and through anonymous public downloads, including
latest aliases and the tagged installer. Published validation/provenance files
bind source, package and qualification identities. Public documentation follows
publication; bundled documentation retains its assembly snapshot.

## Scope and retained attempts

The model/runtime and private input daemon/launcher match .57. The ten-minute
session bound remains. Recovery is held in memory until copied, discarded or the
app closes. Existing low Rand advisory conditions are absent in the current
feature/logger graph; the advisory remains visible.

Tests use private buses, displays, clipboard, profiles and public/synthetic audio.
Native Brave runs the browser binary directly, without qualifying Snap confinement.
Start/passive evdev and Wayland paste use private fixture seams: these results do
not certify physical evdev/uinput concurrency, physical microphones, default
PipeWire or every Linux desktop. Desktop gestures are not atomic with recipient
changes. Terminal dispatch does not establish protected-input state or caret/text
readback. The active GNOME 46 companion is required for consuming Stop; without
it, selected continuation text stays in recovery rather than replacing words.

The first .58 candidate remains retained separately. The held-Stop and stale-version
regressions failed before correction; package preparation also retained its initial
container ownership failure before the corrected fresh transaction. These attempts
are not counted as passing final-package trials. Temporary desktops were archived
before cleanup. The owner's installed .57 application and profile were preserved.
