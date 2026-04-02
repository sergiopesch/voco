# Contributing

## Development Setup

```bash
git clone https://github.com/sergiopesch/voco.git
cd voco
./scripts/setup.sh
```

## Common Commands

```bash
npm run dev
npm run check
npm run lint
npm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Project Expectations

- keep diffs reviewable
- preserve Linux-native behavior
- document packaging and runtime-path changes
- prefer local-first and privacy-preserving behavior
