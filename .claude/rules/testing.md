# Testing Rules

## Philosophy
- Test-first where the behaviour is well-defined
- Narrow tests first (unit), broad tests second (integration, E2E)
- Never claim a feature is complete without validation

## Unit Tests
- Test pure functions and utility logic directly
- Test Zustand store actions in isolation
- Mock Tauri commands at the IPC boundary

## Integration Tests
- Test the voice interaction hook with mock MediaRecorder
- Test insertion strategy selection logic
- Test config persistence round-trips

## E2E Tests
- Use Playwright when E2E coverage is added
- Test the full voice loop: record -> transcribe -> insert
- Test tray state transitions

## Validation
- `npm run check` must pass before any merge
- `npm run build` must pass when changes affect shipped behaviour
- No skipped or `.only` tests in committed code

## Linux-Specific Testing
- State the distro, desktop environment, compositor, and insertion path used during verification
- Test Wayland behaviour separately from X11 assumptions
- Test insertion success and fallback behaviour
- Test microphone denial and no-device flows
- Test first-run model bootstrap behaviour
- If a validation cannot be run, say exactly what was not verified
