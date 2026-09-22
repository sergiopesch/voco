# Contributing

## Development Setup

Use Node.js 24 LTS (`.nvmrc`) or newer, Rust and the Linux development packages
checked by the setup script. CI reads the same Node LTS file. With nvm installed,
run `nvm install` and `nvm use` from the clone before setup.

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
separately from source. The [release process](release-process.md) and [release status](release-candidate.md)
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

## Dependency maintenance

Vite 8 and React plugin 6 are a matched build-tool pair. Upgrade them together
and check their peer requirements. Vite uses Rolldown/Oxc for JavaScript and
Lightning CSS for CSS minification. The explicit JavaScript/CSS output targets
retain the previous compiler targets; they do not establish support for every
browser or WebKit version. Keep both development-renderer and production-package
checks when updating these tools. React Compiler is not enabled.
Root renderer fixtures declare Vite directly; the DevOps gate requires them to
resolve the same build tool as the desktop workspace.

Compatible updates are grouped weekly, with two open version PRs per ecosystem.
Vite and its React plugin share a dedicated group, including major updates.
Other major upgrades, pre-1.0 keyboard/hash APIs and the shortcut plugin need
individual review. Security updates remain independent. See [repository hygiene](release-process.md#repository-hygiene).

TypeScript 7 supplies `tsc` through the `@typescript/native` npm alias. The
`typescript` alias points to Microsoft's `@typescript/typescript6` compatibility
package because ESLint and compiler-API regression fixtures still need that API.
This follows [Microsoft's side-by-side guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-60).
Both are development dependencies; neither ships as a runtime service. Remove
the compatibility alias only after all API consumers support a stable successor.

`verify-shortcut-backport.py` checks the upstream vendor inventory and rejects
multiple `global-hotkey` resolutions. The app's X11 focus lease and the Tauri
shortcut plugin must use the same patched actor. Run the isolated desktop tests
after upgrading this dependency; a successful compilation cannot prove that link.

`verify-tray-backport.py` similarly requires Tauri to resolve one patched
`tray-icon` library. Tauri updates can change that dependency even within a patch
release. Carry the immutable Linux icon-path API onto the required upstream
version, preserve its source inventory and archive checksum, and qualify the
packaged tray in a real isolated GNOME session. The package ships that provenance
beside the upstream licenses.
