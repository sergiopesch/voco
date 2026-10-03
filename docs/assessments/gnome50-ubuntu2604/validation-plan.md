# Validation and performance plan

This file separates what was checked on 3 October 2026 from what a later upgrade
must prove. All source tests here use candidate `2045dd7391ece5815d70a5fd42e1cb6fd14ae2a6`.
Installed CLI results belong to the older PR87 package. Neither substitutes for
a built and installed GNOME 50 candidate.

## Checks performed

| Check | Result | Boundary |
| --- | --- | --- |
| GitHub release, candidate and CI identity | Confirmed .59 public; .60 source at pinned master; all five jobs passed | Remote source/CI, Ubuntu 24.04 runners |
| Installed package verification | `dpkg --verify voco` exit 0, empty output | Existing PR87 installed files only |
| APT dependency request | Simulation fails: `ydotoold` has no candidate | Actual configured Ubuntu 26.04 package indexes; no package transaction |
| Input service state | Distro provider active; VOCO socket-collision retry loop | Read-only systemd/journal observations |
| Startup guard | `require_settled` raises `MigrationInFlight` for observed auto-restart state | Read-only helper functions; GUI launch not attempted |
| Companion / introspection | Out-of-date installed v12; candidate v13 permits 46 only; missing Meta API verified | No extension enable or Shell restart |
| `python3 scripts/test-panel-setup.py` | 6/6 passed | Existing classification fixtures, not a working GNOME 50 panel |
| `python3 scripts/test-ydotool-service.py` | 25/25 passed | Mocked systemd and helper fixtures; no real key input |
| `bash scripts/test-install-common.sh` | Passed | Existing mocked installer behavior; misses current distro mapping failure |
| `node --test scripts/test-panel-model.mjs` | 5/5 passed | Presentation model only |
| Python speech unittest discovery | 31/31 passed | Model-free tests on system Python/NumPy |
| Version consistency | Passed at 2026.0.60 | Source metadata only |
| glib provenance | Passed, 121 files and one resolved patched copy | Source/provenance, not optimized Rust execution |
| Native capture C callback suite | **Environment-blocked**, attempt exit 1 | Missing `libpulse.pc`; compilation and device checks not reached |
| Installed native speech bridge | Dependencies resolved; `ctypes.CDLL` succeeded | Loader/ABI smoke only |
| Candidate worker with pinned installed native payload | 13/13 protocol checks passed | Private worker; no microphone, desktop app or clipboard |
| Public development corpus | 8/8 completed, 4 edits / 160 words, WER 0.025 | One unpaced pass, 4 workers, context 1, 100 ms packets |
| Crabbox doctor | Passed for local-container provider | No new lease; no remote VM or desktop acceptance |

Seven of eight initial check commands passed; the eighth was blocked by a missing
development dependency. This count is not a claim that seven eighths of the product
is qualified. Protocol and corpus checks were additional, separately identified
experiments. No failures were discarded or rerun with weakened assertions.

Private logs are retained on the assessment laptop under
`~/Documents/voco-gnome50-assessment-20261003/`. They include `checks.json`,
individual logs, the failed native callback receipt, native hash verification,
worker protocol records and the evaluation run/score. That directory is not in
Git. The repository contains only [sanitized summaries](evidence-summary.json)
and explanatory documents, with no personal transcript, microphone sample,
clipboard content, machine hostname or user-specific settings file.

### Speech experiment identity and limits

The experiment copied **candidate Python sources** to a private staging directory,
then linked the installed model/native files there. Every native file listed in
candidate `runtime/speech/NATIVE-BUILD.json` matched its SHA-256 before use; the
production loader verified the pinned model. Thus this is neither an unmodified
old-worker test nor a new application package qualification.

The corpus came from `tests/fixtures/speech/manifest.json`, using
`scripts/evaluate-dictation-worker.py` and `scripts/score-dictation-worker.mjs`.
Configuration: development split, one repeat, unpaced, context 1, zero gate,
100 ms packets, explicitly four CPU workers. Protocol metrics also observed the
default of four workers. Peak sampled worker RSS was 1,011,441,664 bytes. Worker
launch-to-ready in the corpus run was about 1,149 ms; this was a new process, not
a controlled cold filesystem-cache or cold-boot experiment.

Median service real-time factor was 0.235, maximum 0.249; median finish ACK was
75 ms, maximum 100 ms. These are worker request timings under unpaced replay,
not microphone-to-visible-text or Stop-to-final-paste timings. The score's
descriptive p95 over eight clips is not a qualified population tail. No matched
Ubuntu 24.04 run was performed. The full pinned speech baseline's long continuity,
silence and variants gate was **not** replaced by this corpus smoke experiment.

## Reproduce diagnosis without modifying the desktop

Run these only as observations; do not run the actual installer or setup commands
as part of reproducing this review:

```bash
git rev-parse HEAD
dpkg-query -W voco gnome-shell ydotool
apt-cache policy ydotool ydotoold
apt-get --simulate install ydotool ydotoold
dpkg-query -S /usr/bin/ydotoold /usr/lib/systemd/user/ydotool.service
systemctl --user show voco-ydotoold.service ydotool.service \
  -p ActiveState -p SubState -p FragmentPath -p NRestarts -p ExecStart
journalctl --user -u voco-ydotoold.service -n 12 --no-pager
gnome-extensions info voco-panel@voco.local
/usr/bin/voco --check-panel
/usr/bin/voco --check-desktop-input
gnome-shell --help
```

The following inspects only the installed launcher's guard. It does **not** call
`migrate()`, `main()`, `--migrate`, `--setup-desktop-input` or any restart method:

```python
import importlib.machinery
import importlib.util
import time

loader = importlib.machinery.SourceFileLoader(
    'review_launcher', '/usr/libexec/voco/ydotool-launcher')
spec = importlib.util.spec_from_loader(loader.name, loader)
module = importlib.util.module_from_spec(spec)
loader.exec_module(module)
state = module.unit_state(time.monotonic() + 2)
print({key: state.get(key) for key in ('ActiveState', 'Job', 'MainPID')})
module.require_settled(state)
```

This reproduces the sampled rejection only while the unit has that state.
The [upstream note](upstream-research.md#reproducible-read-only-capability-evidence)
contains the installed Meta API probe. Record new results rather than assuming
the same state on another machine. Do not publish raw journal/profile data.

## Required upgrade matrix

| Layer | Environments and cases | Required evidence |
| --- | --- | --- |
| Source and unit | All current repo gates; package mapping; stock/custom units; pending jobs; service race; 46/50 API classification | Exact commit and commands; failures retained; no weakened safety tests |
| Native payload | Pinned model/native libraries, new Python/NumPy/SentencePiece, old supported ABI | Hashes, loader checks, full speech baseline and protocol/continuity gates |
| Package lifecycle | Clean Ubuntu 24.04 and 26.04 VMs; enabled/disabled recommendations; upgrade with prior VOCO unit; distro unit enabled; remove/reinstall | APT transaction and file receipts; one chosen provider; no hooks mutating user session |
| Compositor | Actual GNOME 46 and 50; modern daemon plus qualified legacy path where appropriate | Versioned Shell and loaded companion; real uinput path tested separately from nested adapter |
| Packaged renderer | Actual WebKitGTK app on each OS; onboarding retry/finish/Done, Settings, Review, hidden recording | Rendered/accessibility evidence; successful flush; no hidden idle recording or focus-stealing launch |
| Clipboard and recipient | Native GTK 3/4, WebKit, Chromium/Brave, Electron/Codex, Ghostty and a second terminal; native Wayland and XWayland modes identified | Public/synthetic text; CLIPBOARD/PRIMARY behavior, leading space, Unicode, no Enter, no uncertain replay; actual recipient verification |
| Keyboard lifecycle | Start/Stop idle/starting/recording/processing; held Alt/Shift; repeated key; hotplug/layout; multiple keyboard devices; manual bindings; failed grabs | Exactly one toggle; no focused-app chord side effect; bounded fallback; no stuck modifiers; authentic input path identified |
| Shell lifecycle | Disable/enable, owner loss, app crash, old replies, locked screen, modal dialogs, overview/fullscreen, suspend/resume | Cleanup, fallback tray and lease expiry; no accidental capture/delivery in protected surfaces; no hidden retry loop |
| Accessibility / display | Reduced motion, keyboard navigation, large text, fractional scaling, multi-monitor, RTL, crowded panel | Accessible names and operable Stop; no VOCO-induced microphone drift; authentic system privacy indicator retained |
| Audio continuity | PipeWire 1.6 pulse server, synthetic waveform, idle-to-start, long session, CPU/UI pressure, input unplug, suspend | Complete-reference retained-sample accounting, bounded queues, Stop tail; no drop hidden by local ACKs |
| Owner laptop | Actual chosen microphone, real speech, user-selected apps and shortcut, repeated Start/Stop and clean exit | Explicit user acceptance after packaged checks; record attempted/completed/failed counts |

Use disposable recipient documents, not live personal editors. Diagnostic DOM
snapshots and transcript verification must run separately from latency trials;
copying a growing transcript can distort performance. A nested test cannot prove
kernel device permissions or physical microphone continuity. A VM cannot prove
this laptop's hardware behavior. No single row replaces another.

## Performance strategy

### Preserve known limits first

- One warm worker; default `max(1, min(4, affinity_count - 1))`. Do not reserve
  more workers just because this laptop has 16 logical CPUs.
- 100 ms IPC batching, partial-packet Stop flush, 3 s maximum recognition backlog.
- Native capture pump: 5 ms while live, 250 ms with a connected idle backend,
  blocking receive with no backend (`native_capture/mod.rs:284–303`).
- Companion: one in-flight GetState, nominal 50 ms polling while recording and
  1.5 s otherwise; 1 s reservation heartbeat; 2.5 s lease; fallback on disconnect.
- 20 s cache for completed companion-probe responses, including unsupported,
  disabled or error statuses; 2 s for invocation failures or `unavailable`.
  Invalidate on ownership/setup changes. Explicit checks stay fresh.
- Paste remains off the main UI loop, with current settle/modifier/deadline bounds.

These are source invariants, not measurements of CPU, frames or actual cadence.
The first performance correction is eliminating the duplicate-service retry loop,
not changing audio chunks or skipping readiness checks.

### Measure comparable things

Use paired baseline/candidate runs with exact package identities, same power mode,
CPU affinity, fixture order, background workload and display/recipient settings.
Retain at least three paired runs for idle, paced dictation and long-session
stress, including a ten-minute session. Record all attempts, thermal throttling
and errors. Use sufficient sessions and chunks for latency distributions and
report their denominators; repeated chunks are not independent speakers.

On GNOME 46 compare unchanged master with the port to detect regressions. On
GNOME 50 there is no working unchanged-companion baseline: compare a labeled
package/service-only build using the tray/manual route to the companion build,
then report the extra feature cost separately. Never label this a same-route
comparison. Use the same speech worker on both to isolate recognition from desktop
changes. Do not use the old historical PR87 timing record as a matched baseline.

Collect process-tree CPU time, RSS/PSS where available, context switches/wakeups,
Shell frame behavior, helper spawn counts, source sample continuity, queue age,
recognizer readiness, shortcut-to-capture, first-audio-to-first-visible-word,
paste/clipboard phase times and Stop-to-final-visible-text. Keep process launch,
model load, capture and recipient timing separate. Native performance logs must
remain content-free; retain only aggregate public-corpus results in Git.

Proposed review budgets below are **initial engineering thresholds**, not existing
product promises or measured achievements. Freeze final budgets before evaluating
the implementation; do not relax them after observing a failing run:

| Metric | Initial review gate |
| --- | --- |
| Service health | Zero unexpected input-service restarts during stable operation and login/exit trials |
| Audio / output correctness | No unaccounted retained samples, missing Stop tail, duplicated paste or changed deterministic fixture output |
| Same-route warm latency | Investigate/reject an unexplained median or p95 regression greater than both 10% and 25 ms across paired runs |
| Idle CPU / wakeups | No new periodic loop beyond documented timers; no persistent regression above measured baseline variability; report single-core CPU units |
| Memory stability | No sustained growth across 50 Start/Stop cycles or 20 extension reconnect cycles after warmup; measure whole process tree |
| Responsiveness | No capture stalls or repeatable Shell frame stalls correlated with panel updates, helper spawning or ownership checks |
| Recognition | Same model/config and full corpus thresholds; any changed output or missing measurement gets investigated, not averaged away |

If a budget fails, isolate the cause before optimization. Consider event-driven
state changes or caching immutable helper syntax only after profiling identifies
that cost. Preserve live service checks, source continuity and modifier handling.

## Completion criteria

All F1–F3 corrections need focused regressions, F4 needs real GNOME 50 evidence,
and F5's remaining runtime/capture/package layers need the matrix above. Run
the exact current AGENTS verification commands, then final review of code and
updated operational docs. Preserve GNOME 46 compatibility and pin the full package.

A private laptop trial may be handed off with explicitly listed remaining
physical acceptance checks. A published support claim requires completed release
gates, downloaded-asset verification and separate publication authorization.
If a VM, dev library, hardware trial or permission is unavailable, record that
gate as unavailable; successful unit tests do not turn it into a pass.
