# Contributing to VOCO

VOCO is local English dictation for Linux. It is a Tauri 2 app: a Rust shell, a
React interface in WebKitGTK, and a Python worker that runs NVIDIA Nemotron
Speech Streaming on the CPU. Bug reports, fixes, documentation and test fixtures
are welcome. VOCO is released under the [MIT License](LICENSE), and so are
contributions to it.

Please follow the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities
privately, as the [security policy](SECURITY.md) describes, never in a public
issue. Bugs and feature ideas go in the issue forms on GitHub.

## Before you start

- Read [AGENTS.md](AGENTS.md). It sets the product contract, such as local
  recognition, one output path and a short list of settings, and the rules each
  change must keep.
- The [architecture overview](docs/architecture/README.md) follows one recording
  from the microphone to the paste. The [code map](docs/architecture/code-map.md)
  shows where each feature lives.
- Change only what your task needs. For a significant change to behaviour,
  security, privacy or the stack, open an issue first so the approach is agreed
  before the code is written.

## Prerequisites

VOCO builds on x86-64 Linux. Ubuntu 24.04 is the reference system, and CI runs on
it.

- Node.js 24, as `.nvmrc` pins. `package.json` requires 24 or later.
- Rust 1.94.0 through [rustup](https://rustup.rs), with clippy and rustfmt. It
  matches `rust-version` in `apps/desktop/src-tauri/Cargo.toml` and the CI
  toolchain.
- Tauri CLI 2.10.1, which `npm run dev` and packaging use:
  `cargo install tauri-cli --version 2.10.1 --locked`.
- System Python at `/usr/bin/python3`, with python3-gi and gir1.2-ibus-1.0 for
  the IBus tests, and python3-numpy and python3-psutil for the speech worker.
  `scripts/setup.sh` installs all four.
- Playwright's Chromium for the renderer suites:
  `npx playwright install --with-deps chromium`.

## Set up a checkout

```bash
git clone https://github.com/sergiopesch/voco.git
cd voco
bash scripts/setup.sh
```

`scripts/setup.sh` checks Node.js and Rust, then installs the build libraries with
APT: pkg-config, the GLib, libsoup, JavaScriptCore and WebKitGTK 4.1 development
packages, libayatana-appindicator3-dev, libpulse-dev, gcc, ibus,
gir1.2-ibus-1.0, python3-gi, python3-numpy and python3-psutil. It checks the
IBus bindings, reports what your session lacks for pasting, such as a helper or
access to `/dev/uinput`, and runs `npm install`.

Start the app in development mode:

```bash
npm run dev
```

This runs `cargo tauri dev`, which serves the interface from Vite on
`localhost:5173`. The app starts the installed speech worker,
`/usr/lib/voco/speech/stream_worker.py`, unless `VOCO_STREAM_WORKER` names
another absolute path. The model and native runtime aren't in Git.
[Runtime provisioning](docs/linux-packaging.md#runtime-provisioning) fetches them
into `runtime/speech/`, and then the checkout's worker can run:

```bash
VOCO_STREAM_WORKER="$PWD/runtime/speech/stream_worker.py" npm run dev
```

`bash scripts/setup.sh --install` builds the release app, assembles the complete
package with the provisioned runtime, verifies it and installs it with APT. It
then runs `voco --check-desktop-input` and sets up the Alt+D shortcut. It adds
binutils, desktop-file-utils and appstream to the APT list, installs
Tauri CLI 2.10.1 when no Tauri CLI is installed and warns about any other
version, and exits with status 2 when desktop input still needs setup.

## Checks

Run these before you open a pull request:

| Command | What it runs |
| --- | --- |
| `npm test` | `scripts/test-unit.sh`: checks that need no microphone, speech model or desktop session, then the app's Vitest suite |
| `npm run check` | The TypeScript check, `tsc --noEmit`, in `apps/desktop` |
| `npm run lint` | ESLint on `apps/desktop/src/` |
| `npm run verify:versions` | The version matches in every file that carries it |
| `npm run verify:devops` | Shell and Python syntax, package metadata, CI workflow rules, installer sync and tests, and a release rehearsal |

`npm test` covers source provenance, speech reports, the package assembler, the
speech runtime, capture and desktop integration, and the dictation scoring tools.
For the Rust shell, build the interface first, because the Tauri context embeds
it:

```bash
npm --workspace @voco/desktop run build:frontend
cd apps/desktop/src-tauri
cargo fmt --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets
```

The renderer, desktop and speech-model suites run separately. The desktop suites
need Linux, and several need Bubblewrap, Xvfb, GNOME Shell or the provisioned
runtime.
[Testing](docs/testing/README.md) lists each suite, what it needs and which CI job
runs it.

## Style

`.editorconfig` sets UTF-8, LF line endings, a final newline and no trailing
whitespace. Indent with two spaces, or four in Rust, Python, C and `.in` template
files. Files under `vendor/` and `runtime/notices/` are pinned third-party
source and notices, and stay byte for byte as they are. `npm run lint` and
`cargo fmt --check` enforce the rest.

## Dependencies

Don't add a dependency without a concrete need, and say why in the pull request.
Lockfiles pin every package. Dependabot opens grouped updates each week for Cargo,
npm and GitHub Actions; Vite and `@vitejs/plugin-react` move together. CI runs
`cargo audit` and `npm run verify:security`, which is `npm audit` at the moderate
level.

## Documentation

The docs describe how VOCO works, in the present tense. Update them in the same
pull request as the behaviour:

- user-visible behaviour: [README.md](README.md),
  [Everyday use](docs/everyday-use.md) and [Troubleshooting](docs/troubleshooting.md);
- setup: [Install](docs/install.md) and [Platform support](docs/platform/README.md);
- internals: [Architecture](docs/architecture/README.md) and the code map;
- security: [Security](docs/security/README.md);
- packaging and releases: [Linux packaging](docs/linux-packaging.md) and the
  [release process](docs/release-process.md).

Keep dates, run IDs and test narratives in the pull request description, not in
the docs. Each release is summarized in [CHANGELOG.md](CHANGELOG.md) and its
release notes, so describe user-visible changes in the pull request too.

## Commits and pull requests

Write commit subjects as an imperative outcome in sentence case, with no prefix
and no trailing period, for example "Ship a Debian copyright file with the
package". Use the body to explain why.

Open pull requests against `master` and fill in the template's Change, Validation
and Documentation sections. Keep each pull request to one concern. CI runs five
jobs on every pull request and every push to `master`: Code Guide, RustSec Audit,
Frontend Checks, Rust Check & Test, and Application. CODEOWNERS requests review
from the maintainer. A release is assembled only from a `master` commit on which
every job passed.

## Evidence rules

Tests and bug reports follow the same rules:

- Use synthetic or public fixtures, such as the LibriSpeech clips in
  `tests/fixtures/speech/`.
- Remove personal recordings, transcripts, credentials and local paths before you
  share logs or results.
- Never inject test speech into a live user session. Use isolated audio, input,
  clipboard and desktop fixtures.
- Record a check that couldn't run as unavailable, never as passed.
- Keep failures and the number of attempted trials, not only the successes.
- Hosted CI never assembles the NVIDIA package or signs anything. The maintainer
  does both locally, as the [release process](docs/release-process.md) describes.

## Where things live

- [Code map](docs/architecture/code-map.md): every source file and script.
- [Inside VOCO](docs/guide/README.md): a guided tour from spoken word to source.
- [Linux packaging](docs/linux-packaging.md): how the Debian package and the RPM are built.
- [Branding](docs/branding.md): the visual identity and the voice of the copy.
- [GNOME companion](integrations/gnome/README.md) and
  [Chromium extension](integrations/chromium/README.md): the optional integrations.
- [Native runtime](runtime/native/README.md): rebuilding the speech runtime.
