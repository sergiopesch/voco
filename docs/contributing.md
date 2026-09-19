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

Use Python with NumPy, psutil and required GI bindings. Use `/usr/bin/python3` for distribution-provided GI bindings; a virtual environment
or bare `python3` may select a different interpreter.
Keep synthetic audio/input tests in private fixtures and retain exact evidence
separately from source. The [release process](release-process.md) and [latest release notes](releases/2026.0.42.md)
explain qualification boundaries.

## Sending a change

Open a focused pull request against `master`. Include the user-visible behavior,
reproduction or relevant tests, and documentation changes. The branch requires
Code Guide, Frontend Checks, Rust Check & Test, and RustSec Audit; resolve review
conversations before merging. Never bypass a failing speech or security gate.

Use public or synthetic fixtures. Do not attach personal audio, transcripts,
clipboard contents, credentials or unredacted diagnostic logs to public issues.
The [security policy](../SECURITY.md) explains private vulnerability reporting.
Evaluation contributions should follow the [TypeSafe protocol](testing/typesafe-evaluation.md)
and distinguish measured results from targets and missing evidence.
