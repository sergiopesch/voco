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

## First Read

If the user did not give a concrete task, read these first:
- `README.md`
- `docs/install.md`
- `docs/linux-packaging.md`

Then inspect the files most relevant to the request. The usual source-of-truth files are:
- `apps/desktop/src-tauri/src/lib.rs`
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
