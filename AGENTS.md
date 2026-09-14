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

## Current candidate and evidence boundary

This source prepares testing candidate `2026.0.35`, with matching application and
Debian package versions. It carries forward the validated `2026.0.34+rc1` cleanup,
whose installed baseline was `2026.0.34+focus1`. Read
`docs/release-candidate.md` before interpreting any dated acceptance document.
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
cargo tauri build --bundles deb
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
