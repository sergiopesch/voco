<!-- markdownlint-disable MD032 MD060 -->
# Testing

Run the headless IBus ownership/no-deletion command matrix before any isolated desktop cursor test:

```bash
npm run test:owned-preedit
```

This does not attach to the live input session. Real IBus/target-app testing belongs in a disposable
remote VM or microVM; see the cursor-streaming checklist for the evidence requirements.

## Disposable desktop test

Do not run VOCO input-method, injection, or virtual-audio experiments on an active workstation.
Perform the steps below only inside the disposable remote VM or microVM described in the cursor
streaming checklist, and preserve the remote run ID and evidence.

1. Install dependencies:

```bash
npm ci
./scripts/setup.sh --install
```

2. Start VOCO:

```bash
npm run dev
```

3. Test the product:
- allow microphone access
- finish onboarding
- press `Alt+D`
- speak a short sentence
- confirm live words appear directly in the focused text field
- press `Alt+D` again
- confirm text is inserted at the cursor

For a production-mode headless build without packaging, run:

```bash
cd apps/desktop
cargo tauri build --features custom-protocol --no-bundle
```

Do not use plain `cargo build --release` for a runnable desktop build. The app's
`custom-protocol` feature enables Tauri's production frontend protocol; the Rust build now rejects
release binaries that omit it.

## Automated checks

```bash
npm run verify:versions
npm run test:owned-preedit
npm run check
npm run lint
CARGO_BUILD_JOBS=2 cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
npm --workspace @voco/desktop run build:frontend
CARGO_BUILD_JOBS=2 cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
npm test
```

Build the frontend before the all-features Clippy gate on a clean checkout. Tauri's production
`custom-protocol` context validates `apps/desktop/dist` at compile time.

## Manual checks before release

- confirm the onboarding fits in the window without scrolling
- confirm the top bar can drag the window
- confirm `Hide to tray` works
- confirm the final onboarding step shows the three tray icons clearly
- confirm dictation still works end to end
- run `npm run report:linux-runtime` on the Linux machine used for release testing

Use [linux-e2e.md](./linux-e2e.md) as the release sign-off checklist for Ubuntu-class Linux environments.

Use [cursor-streaming-manual-qa.md](./cursor-streaming-manual-qa.md) when validating live cursor
streaming, preview-only fallback, and final-text-only fallback.
Record the pass/fail evidence in
[cursor-streaming-qa-results.md](./cursor-streaming-qa-results.md).

Use [local-intelligence-manual-qa.md](./local-intelligence-manual-qa.md) when validating optional
localhost transcript enhancement or local assistant mode.
