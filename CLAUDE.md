# Voice — Claude Code Project Instructions

## Mission
Build a free, local-first desktop dictation app for Linux.

The product should let users press a global shortcut, speak naturally, and have transcribed text inserted into the currently focused application with minimal friction.

## Non-negotiable product principles
- Free core experience.
- No account.
- No sign-in.
- No subscription.
- Local-first by default.
- Privacy-first by design.
- Fast launch, fast capture, fast insertion.
- Linux is the only target platform.
- The app should feel invisible when idle and dependable when invoked.

## Current product reality
This repository is a Tauri 2 desktop app with:
- React 19 + Vite + TypeScript frontend.
- Rust backend in `apps/desktop/src-tauri`.
- Local transcription via `whisper.cpp` / `whisper-rs`.
- Global shortcut flow centred on `Alt+D`.
- Tray-only UX with off-screen webview usage to enable microphone capture.
- Linux insertion strategies using `ydotool`, `xdotool`, and clipboard fallback.
- Config persistence in Rust.
- One-command local setup via `./scripts/setup.sh`.

Treat these as the current baseline unless the user explicitly requests an architectural change.

## Source of truth
When making changes, prioritise these files:
1. `README.md` for user-facing claims.
2. `apps/desktop/src-tauri/src/lib.rs` for app lifecycle, shortcut wiring, model bootstrap, and Tauri command surface.
3. `apps/desktop/src-tauri/src/transcribe.rs` for model loading and transcription behaviour.
4. `apps/desktop/src-tauri/src/insertion.rs` for insertion strategy logic.
5. `apps/desktop/src-tauri/src/config.rs` for persisted settings.
6. `apps/desktop/src/hooks/useDictation.ts` for audio capture and dictation flow.
7. `apps/desktop/src/lib/tauri.ts` and `apps/desktop/src/store/*` for frontend bridge and state.

If documentation and implementation disagree, trust the implementation first, then update the documentation.

## Architecture guardrails
- Keep the desktop app local-first.
- Preserve the Tauri architecture unless a strong product or platform reason justifies change.
- Prefer native Linux behaviour over web-style abstractions where desktop integration matters.
- Keep Rust responsible for platform integration, filesystem access, insertion, model lifecycle, and OS-specific concerns.
- Keep the frontend thin, reactive, and state-driven.
- Do not add cloud infrastructure for core dictation.
- Do not introduce authentication or telemetry into the core flow.
- Do not add hidden background services unless clearly documented and justified.

## Product constraints
- Core dictation must work locally on the user's machine.
- Avoid dependencies that weaken privacy, portability, or install simplicity.
- Any network access must be explicit, minimal, and justified.
- First-run model download is allowed only if there is no bundled alternative and the user experience is clearly documented.
- Any future optional cloud feature must be strictly additive and must not degrade the offline experience.

## Linux requirements
- Ubuntu is the primary reference environment.
- Support both Wayland and X11 where feasible.
- Be explicit about compositor and permission constraints.
- Assume `ydotool` may require `ydotoold`, uinput access, or group membership.
- Always provide a fallback insertion path when possible.
- Avoid claiming support for all distributions.
- Prefer solutions that behave predictably on Ubuntu-class distributions first.
- Treat broader distro support as best-effort until tested.

## Distribution support policy
- Officially optimise for Ubuntu first.
- Debian-derived distributions are the nearest compatibility target.
- Other Linux distributions may work, but must not be described as fully supported unless verified.
- Desktop environment, compositor, package availability, and input stack differences can affect insertion reliability.
- When documenting support, distinguish between:
  - tested on Ubuntu
  - likely to work on similar Debian/Ubuntu systems
  - experimental on other distributions

## Engineering standards
- Make the smallest correct change first.
- Prefer clarity over cleverness.
- Preserve working behaviour unless the task explicitly changes it.
- Avoid broad refactors unless they directly reduce complexity or unblock a requirement.
- Keep functions cohesive and file responsibilities clear.
- Keep user-facing errors actionable and Linux-aware.
- Never hardcode secrets, tokens, or machine-specific paths.
- Never commit generated binaries, local caches, or credential files.

## Frontend standards
- Functional React components only.
- Keep React surface area small.
- Use Zustand for shared state.
- Use `@/` path aliases consistently.
- Prefer explicit types over implicit `any`.
- Avoid UI complexity unless it materially improves the dictation experience.
- The app is tray-first, not dashboard-first.

## Rust standards
- Prefer idiomatic Rust and explicit error propagation.
- Keep Tauri commands narrow and serialisable.
- Separate Linux integration concerns into focused modules.
- Avoid panics in normal runtime paths.
- Return errors with enough detail to diagnose issues without exposing sensitive internals.
- Treat OS command execution as security-sensitive and reliability-sensitive.

## Audio and transcription standards
- Optimise for reliable dictation, not generic media processing.
- Be conservative with audio preprocessing changes.
- Any change to sample rate, chunking, gain handling, silence thresholds, or whisper parameters must be justified against transcription quality and latency.
- Do not silently degrade English dictation quality.

## Text insertion standards
- Protect user trust: never claim insertion is reliable on a Linux setup unless it has been verified.
- Preserve clipboard contents whenever clipboard fallback is used.
- Favour deterministic insertion over fragile hacks.
- When insertion fails, fail clearly and preserve the transcript where possible.
- Any new insertion path must document dependencies, permissions, limitations, and fallback behaviour.

## Permissions and security
- Default to least privilege.
- The app should request only the permissions required for microphone access, shortcut handling, and text insertion.
- Do not add telemetry by default.
- Do not add analytics SDKs.
- Do not add auth layers.
- Scrutinise any new dependency that touches input devices, clipboard, accessibility-like APIs, networking, or shell execution.
- Treat shell commands, clipboard handling, and native input simulation as high-risk areas.

## Documentation discipline
Always keep these aligned with the code:
- `README.md`
- install instructions
- Linux prerequisites
- Wayland/X11 caveats
- permissions guidance
- packaging notes
- first-run behaviour

Do not leave aspirational claims in the README.
If a feature is partial, say so explicitly.

## Testing expectations
Before considering work complete, validate the relevant scope.

### Minimum validation
- `npm run check`
- `npm run build` when the task affects shipped behaviour, packaging, or Rust/frontend integration
- manual verification notes for the relevant Linux environment

### When relevant
- Test Linux Wayland behaviour separately from X11 assumptions.
- Test insertion success and fallback behaviour.
- Test microphone denial and no-device flows.
- Test first-run model bootstrap behaviour.
- Test tray state transitions for idle, recording, and processing.
- State the distro, desktop environment, compositor, and insertion path used during verification.

If you cannot run a required validation, say exactly what was not verified.

## Core commands
```bash
./scripts/setup.sh           # One-command setup (deps + npm install)
./scripts/setup.sh --install # Build + install .deb
npm run dev                  # Start Tauri dev (frontend + Rust backend)
npm run build                # Production Tauri build
npm run check                # TypeScript check
```

## Claude Code working mode
When asked to implement something:
1. Inspect the relevant files first.
2. State the minimal plan.
3. Make focused changes.
4. Run the appropriate validation.
5. Report exactly what changed, what was verified, and what remains risky.

When asked to review:
- prioritise correctness
- Linux behaviour
- privacy impact
- packaging risk
- user-facing regressions

When unsure:
- prefer the simplest local-first solution
- avoid speculative architecture changes
- do not invent capabilities the app does not yet have

## Auto mode guidance
This repo is intended to work well with Claude Code auto mode, but auto mode must still be constrained.

- Keep instructions explicit and operational.
- Prefer narrowly-scoped permissions over broad shell freedom.
- Allow the commands needed for normal development, validation, and safe dependency installation.
- Deny privilege escalation, destructive filesystem commands, and risky secret reads.
- Do not configure the repo as if all commands are safe on all Linux systems.
- Treat auto mode as supervised autonomy, not unrestricted execution.

## Anti-goals
Do not steer this project toward:
- multi-platform scope creep beyond Linux
- SaaS-first architecture
- mandatory accounts
- server-side transcription for the core path
- unnecessary Electron-style bloat
- dashboards or collaboration features unrelated to dictation
- premature plugin ecosystems
- generic AI assistant scope creep

## Current known gaps to respect
These areas require extra care because they are incomplete or platform-sensitive:
- reliability across different Linux distributions
- packaging maturity across Linux formats
- ydotool and Wayland setup/documentation
- exact behaviour around first-run model download and offline expectations
- invisible-window/webview constraints for audio capture on Linux

## Definition of done
A change is done when:
- it solves the requested problem
- it does not break the local-first product promise
- docs match reality
- the relevant checks pass or unverified items are stated clearly
- Linux caveats are called out honestly
