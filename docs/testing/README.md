<!-- markdownlint-disable MD032 MD060 -->
# Testing

## Quick local test

1. Install dependencies:

```bash
npm install
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
- press `Alt+D` again
- confirm text is inserted at the cursor

## Automated checks

```bash
npm run verify:versions
npm run check
npm run lint
npm test
npm --workspace @voco/desktop run build:frontend
cd apps/desktop/src-tauri && cargo check && cargo clippy -- -D warnings && cargo test
```

## Manual checks before release

- confirm the onboarding fits in the window without scrolling
- confirm the top bar can drag the window
- confirm `Hide to tray` works
- confirm the final onboarding step shows the three tray icons clearly
- confirm dictation still works end to end
- run `npm run report:linux-runtime` on the Linux machine used for release testing

Use [linux-e2e.md](./linux-e2e.md) as the release sign-off checklist for Ubuntu-class Linux environments.
