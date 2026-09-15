# Development Rules

## Mission

Build VOCO as a free, local-first Linux desktop dictation app.

Core product rules:
- no account
- no sign-in
- no subscription
- no telemetry in the core flow
- Linux only
- privacy-first and fast by default

## Authorized 2026.0.37 release cut

The owner accepted installed +local7 English dictation and explicitly authorized
its release cut on 15 September 2026. This supersedes historical "not authorized"
statements below for the cut only. Preserve the accepted production bytes and
model; no product expansion is part of the cut. Public publication remains pending
final artifact benchmarks, release gates and explicit owner sign-off. Read
[the cut record](docs/releases/2026.0.37.md). Keep the local annotated tag separate
from remote tag activation while portable NVIDIA provisioning is incomplete.
No private audio/transcripts belong in source or draft assets. Source promotion
must pass unchanged CI, including the legacy Whisper gate; no waiver is authorized.

## Current candidate and evidence boundary

This source prepares pre-release candidate `2026.0.37`, carrying forward
.36 diagnostics on merged .35 source. It adds optional bounded AT-SPI local-region
readback before the next clipboard update and first-delivery sentence joining.
Transient target text is never logged or returned to the frontend. No atomic
ownership, unsupported-field acknowledgement or universal editor claim follows.
Read `docs/testing/delivery-observation.md` and `docs/release-candidate.md`.
The owner must manually test before a release cut; do not tag, publish or claim
public readiness from automated checks alone. Updating a GitHub branch or review PR
does not authorize a release tag or publication.

GitHub source excludes model weights and compiled native runtime artifacts. The
local candidate workspace has the tested assets; a fresh clone requires separate
pinned provisioning described in `docs/linux-packaging.md#runtime-provisioning`.
Do not replace missing artifacts with mutable downloads or claim a source-only
build verifies NVIDIA runtime behavior.

The production candidate path is local NVIDIA Nemotron English Q8 CPU streaming:
`runtime/speech/` -> `src-tauri/src/benchmark_stream.rs` ->
`src/lib/benchmarkPhraseQueue.ts` -> desktop paste delivery. Despite historical
"benchmark" names these files are application code. Whisper and exact-field
Chromium paths remain separate; research Qwen/Moonshine/Parakeet adapters are not
production alternatives. Do not replace the selected runtime from a leaderboard.

Preserve raw evidence, failures and private recordings outside public docs. Report
measurement origins, actual audio durations, model/runtime hashes, valid/failed
trial denominators, CPU scope and target-app coverage. Callback, key dispatch and
observed field mutation are different events. Never sum overlapping stage timers.

## Current bounded optimization

Private +local7 adds only `--delay 24` to the detected legacy ydotool paste command.
The owner installed and positively tested +local6; old preparation deferrals below
are historical. Preserve all key events, literal spaces, modern helper arguments,
focus/receipt checks and uncertain-write handling. Read [the current change](docs/testing/keyboard-delivery-2026-09-15.md).
Do not claim socket/XTest timing is physical Wayland cursor latency. Artifact
receipts and renewed owner testing qualify each revision; no release is authorized.

## Current Stop-delivery review

`2026.0.37+local6` validation C passed 34 selected strict Stop cases from 35 attempts
and 65 model-protocol cases across five userspaces. Normal route-specific continuation
passed five selected cases from eight attempts. Exact package qualification requires
the accompanying external artifact receipts; full-app renderer reload is unqualified. `+local5`
is frozen evidence: normal five-userspace tests passed, delayed-reader X11 Stop
tests failed. `+local4` is an earlier sandbox-tested baseline. The owner subsequently
installed +local6 and reported a successful test; preserve that running app during
new isolated optimization work. Read the [current review](docs/testing/stop-delivery-review-2026-09-15.md),
[release gates](docs/release-candidate.md) and [code map](docs/architecture/code-map.md).

The X11 fix scopes the existing registered shortcut to the exact X input-focus
window for one recording, through final delivery. It does not forgive focus loss
or refresh an initially valid target token. The actor's fixed 650-second lease
covers the 600-second recording limit plus bounded finalization; it does not
extend recipient deadlines. End/automatic restoration must expose degraded health
on failure, and an automatically restored old lease cannot authorize more output.
The frontend owns a UUID and serializes cleanup; late replies release only that
owner. Begin/end traces describe the logical session, not proof of physical X11
scope on Wayland/unsupported no-op routes. No user keybinding/fallback configuration
change or new hotkey engine is required. Preserve the pinned upstream provenance
and licenses in [the vendored patch](vendor/global-hotkey/VOCO-PATCH.md).
The actor waits on the X connection and a command signal with `libc::poll`, using
only the original lease expiry as a timer deadline. Drain buffered X events before
waiting, queue commands before signaling and preserve bounded drain/cleanup work.
Paired isolated callback/idle results are mechanism evidence, not atomic shortcut
availability or application energy measurements; read their scope before quoting them.

Main-renderer PageLoad Started synchronously advances the shortcut epoch, then
asynchronously releases only older-epoch ownership. Preflight captures its epoch
before the blocking target probe; Begin keeps that value immutable and checks it
before/after acquisition. A stale acquisition cleans up before returning failure.
Do not remove epoch checks or let a late reset release a newer owner. Generic paste
IPC does not carry a renderer epoch; this fix does not establish universal reload
cancellation. Fresh dependency audits retain seven maintenance and two unsoundness
notices; the [current review](docs/testing/stop-delivery-review-2026-09-15.md)
documents feature/reachability limits instead of waiving them.

Keep consuming X11 and passive evdev admission distinct. Root/scoped X11 grabs
use `owner_events=false`; their callback already consumed the chord and must not
be dropped just because an IBus poll is pending. Passive evdev still needs the
in-flight-poll/retained-authority guard. Registration/readiness uses completed
Armed/Uncertain authority, never merely polling. Preserve the shared debounce,
plugin-generation checks and one-second IBus authority bound. Finite suppression
events occur only on input events, not every poll. Validation B attempted two
cases before its startup failure; preserve both without retroactively applying
C's tighter overlap/focus-negative gates to B's first completion.
The excluded C attempt lacked suffix-coverage preconditions; its corrected gap
fixture alone was rerun, with production bytes unchanged. Never report 34/34 total
attempts. Native package qualification lives in external exact-artifact receipts;
do not embed the final package's own hash into packaged docs and trigger a rebuild loop.
Three initial userspace fixtures incorrectly required root-X11 restoration while
IBus owned the real shortcut route. Preserve them and the corrected real Start/Stop
proof; do not describe those as production fixes or omit the eight-attempt ledger.

Backend startup selects NVIDIA for Cursor + enhancement Off when desktop paste and
streaming are enabled. Readiness must follow real worker warmup, never file presence.
The queue module must not start a worker on import. Explicit legacy transcription
still prepares Whisper lazily; do not remove its independent recovery/browser paths.
Keep worker logging optional, bounded and private; reject unsafe file targets without
chmodding unrelated files or blocking speech. Trigger sockets validate private paths,
same-user peers and inode ownership before cleanup. Do not weaken these checks for
a test fixture; repair the isolated fixture's environment instead.

Distribution userspace, native package-manager installation, default compositor,
physical audio and destination-app acceptance are separate evidence levels. Five
normal userspace passes do not qualify every Linux desktop or a later binary.
Preserve failed setup attempts and report missing dependencies explicitly.

## First Read

If the user did not give a concrete task, read these first:
- `README.md`
- `docs/install.md`
- `docs/linux-packaging.md`

Then inspect the files most relevant to the request. The usual source-of-truth files are:
- `apps/desktop/src-tauri/src/lib.rs`
- `runtime/speech/streaming.py`, `worker_main.py`, `adapters.py`
- `apps/desktop/src-tauri/src/benchmark_stream.rs`
- `apps/desktop/src/lib/benchmarkPhraseQueue.ts`
- `apps/desktop/src-tauri/src/focus_probe.rs`
- `apps/desktop/src-tauri/src/performance.rs`
- `scripts/package-nvidia.py`
- `apps/desktop/src-tauri/src/transcribe.rs`
- `apps/desktop/src-tauri/src/insertion.rs`
- `apps/desktop/src-tauri/src/config.rs`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/hooks/useDictation.ts`
- `apps/desktop/src/components/ControlPanel.tsx`

If code and docs disagree, trust the code first, then fix the docs.

## Product Guardrails

- Keep the app local-first.
- Do not add auth, cloud-only flows, or analytics to the core product.
- Preserve the tray-first interaction model unless the user explicitly wants a product change.
- Keep Rust responsible for platform integration, filesystem access, packaging-sensitive logic, and OS interactions.
- Keep the frontend thin, typed, and state-driven.
- Be explicit about Linux limitations instead of hiding them.

## Platform Rules

- Ubuntu is the primary reference environment.
- Support Wayland and X11 where feasible, but document caveats honestly.
- Preserve fallback insertion paths where possible.
- Respect XDG paths for config, data, and cache.
- Do not claim Snap, Flatpak, Flathub, or Ubuntu App Center readiness unless it has been verified.
- Treat Debian and Ubuntu as the main supported packaging targets unless the repo is explicitly extended.

## Code Quality

- Make the smallest correct change first.
- Prefer clarity over cleverness.
- Avoid broad refactors unless they directly simplify the solution or unblock the requirement.
- Do not remove intentional functionality without asking.
- Keep React components functional and typed.
- Prefer explicit error propagation in Rust; avoid panics in normal runtime paths.
- Treat shell execution, clipboard handling, input simulation, and network access as high-risk areas.
- Never hardcode machine-specific paths, secrets, or credentials.

## Documentation

- Keep `README.md`, install docs, packaging docs, and security notes aligned with the implementation.
- Do not leave aspirational claims in the docs.
- If a feature is partial, platform-sensitive, or draft-quality, say so explicitly.

## Validation

After code changes, run the narrowest meaningful checks first, then broaden as needed.

Common validation commands:

```bash
npm run verify:versions
npm run check
npm run lint
npm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

When frontend bundle, packaging, or release metadata changes are involved, also run:

```bash
npm --workspace @voco/desktop run build:frontend
desktop-file-validate packaging/flatpak/com.sergiopesch.voco.desktop
appstreamcli validate packaging/flatpak/com.sergiopesch.voco.metainfo.xml
npm run build
```

If a required validation cannot be run, say exactly what was not verified.

NVIDIA worker tests also require Python with NumPy and psutil. Run
`python3 -m unittest discover -s runtime/speech -p 'test_*.py'` and the protocol
checks separately with `python3 runtime/speech/test_worker_protocol.py --output-dir /path/to/new/receipts`
and the pinned model/runtime present. A base Tauri `.deb` is incomplete:
assemble and verify the NVIDIA payload with `scripts/package-nvidia.py` before
calling it an installable candidate. Capture artifact hashes and dependency status.
Do not copy external personal audio into source, fixtures or public release notes.

## Reviews

When reviewing, prioritize:
- correctness bugs
- Linux behaviour regressions
- privacy or security risks
- packaging and release drift
- performance problems in the audio, transcription, and insertion paths
- missing validation for risky changes

## Safety

- Never commit unless the user asks.
- Avoid destructive commands unless the user asked for them or they are clearly required for the task.
- Do not overwrite unrelated user changes.
- Keep the repo vendor-neutral: repository guidance belongs in `AGENTS.md`, not tool-specific config trees.

When modifying paste gestures, test each helper's parser independently. Legacy
ydotool 0.1.x needs a literal space argument; xdotool uses `space`; modern ydotool
uses explicit keycode events. Run `scripts/test-legacy-ydotool.py` where available.
The .37+local2 Codex owner test failed this path despite X11 test passes; the
owner reported successful Codex dictation on .37+local3 after the correction.
Further code changes require fresh candidate verification. See
`docs/testing/pre-release-review-2026-09-15.md` for this review and remaining gates.
Keep Stop-drained samples in the live NVIDIA stream before finish; avoid making a
full-recording copy for a queue that already received those samples. Recreate a
known-dead idle worker only at a safe session boundary, never by replaying audio.
