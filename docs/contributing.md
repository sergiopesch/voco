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

## Runtime and packaging

Read [AGENTS](../AGENTS.md) and [current architecture](architecture/README.md).
The production pipeline still uses historical `benchmark_stream` and
`benchmarkPhraseQueue` names; these are not disposable benchmark-only modules.

Provision the pinned model/native runtime separately before NVIDIA tests or a
complete package build; a fresh clone does not contain these artifacts.
Use `npm run build` for the base bundle, then the NVIDIA assembler and full
package verifier from [packaging](linux-packaging.md). A direct Tauri bundle may
omit the matching browser host.

Use Python with NumPy, psutil and required GI bindings. On the reference laptop
this is `/usr/bin/python3`; bare `python3` can select a different environment.
Keep synthetic audio/input tests in private fixtures and retain exact evidence
separately from source. [Pre-release review](testing/pre-release-review-2026-09-15.md)
tracks this candidate's scope and remaining acceptance gates.
