# Release Process

VOCO releases are cut from git tags in the form `voco.<version>`.

## Quick path

1. Start from current `master`:

```bash
git checkout master
git pull --ff-only origin master
npm ci
```

2. Run the release checks:

```bash
npm run verify:versions
npm run check
npm run lint
npm test
npm run test:private-ibus
npm --workspace @voco/desktop run build:frontend
npm run rehearse:release
cargo audit --file apps/desktop/src-tauri/Cargo.lock
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

3. Commit and push:

```bash
git status --short
git add <reviewed-release-files>
git diff --cached --check
git diff --cached --stat
git commit -m "Cut release <version>"
git push origin master
```

4. Create and push the release tag:

```bash
git tag -a voco.<version> -m "VOCO <version>"
git push origin voco.<version>
```

5. Wait for the GitHub release workflow to create a draft with all verified assets, inspect it, then
   publish the draft manually only after release sign-off. Verify it contains:
- `voco_<version>_amd64.deb`
- `voco_checksums.txt`
- the Debian package contains `/usr/share/ibus/component/voco.xml`, the executable
  `/usr/libexec/voco-ibus-engine`, and the three root-owned modules under `/usr/lib/voco/ibus/`
- `scripts/verify-deb-package.sh <package.deb> <version>` confirms the package dependencies,
  paths, ownership, modes, exact desktop/AppStream identity, icons, engine payload, and absence of
  Python test/cache artifacts
- package installation does not alter the test user's enabled input sources

## Rehearsal details

Before creating a release tag, run:

```bash
npm run rehearse:release
```

This checks:
- version metadata consistency across shipped manifests
- shell helper syntax for install and packaging scripts
- public install docs still require checksum verification and do not recommend `curl | bash`
- the README keeps the guided installer as the primary install path
- the README keeps a robust manual `.deb` fallback using `wget -O`
- the release helper comment stays pinned to the exact release tag
- generated GitHub release notes for the current version
- expected asset names:
  - `voco_<version>_amd64.deb`
  - `voco_latest_amd64.deb`
  - `VOCO-<version>-x86_64.AppImage` only for a future fully pinned AppImage pipeline
  - `voco_checksums.txt`

## Release Trigger

The GitHub release workflow runs on tags matching:
- `voco.*`

The workflow rejects a tag unless it exactly matches `voco.<package.json version>`.

## Current Output

The release workflow:
- builds the Debian bundle
- installs lockfile-pinned `cargo-audit 0.22.2` under the repository's pinned Rust toolchain before
  scanning the exact application lockfile
- runs the private headless IBus lifecycle in an isolated namespace
- verifies the built Debian bundle before collecting release assets
- omits AppImage while Tauri's Linux packaging helpers are not all immutable and checksum-pinned
- generates checksums
- renders the GitHub release body from `scripts/render-release-body.sh`
- uploads the verified payload from a read-only build job, then creates the draft in a separate
  no-checkout job with release-write permission

## Publish checklist

- bump the repo version everywhere required by `npm run verify:versions`
- run `npm run rehearse:release`
- record `git rev-parse HEAD` after pushing and ensure every required CI job is green for that exact
  `master` commit before tagging
- confirm the exact lockfile passes RustSec and npm dependency audits before tagging
- create an annotated tag as `voco.<version>` at that exact green commit
- verify the GitHub Release contains the expected assets and notes
- download the draft assets, verify `voco_checksums.txt`, and rerun
  `scripts/verify-deb-package.sh` against the downloaded versioned `.deb`
- publish the draft only after those downloaded artifacts pass

## Manual test before tagging

- start VOCO only inside the disposable remote desktop described in the testing guide
- complete onboarding
- test dictation with `Alt+D`
- manually add/select `VOCO Dictation`; verify normal GB-layout typing while idle
- verify source switch, focus loss, app exit, target close, and package-version mismatch fail closed
- confirm tray launch, settings, and hide-to-tray still work
- run `npm run report:linux-runtime` if Linux insertion changed

Never substitute an active workstation for the disposable desktop. If the remote provider is
unavailable, publishing requires explicit owner acceptance of a documented release exception after
the final package passes the source, saved-audio, package-verifier, private-IBus, and installed
local-container gates. Record the local-container `cbx_...` ID and keep the remote/physical matrix
explicitly pending in the QA results and release notes. A local container does not count as remote
or physical desktop coverage.

Treat the `.deb` as the release path. Do not attach an AppImage until the complete linuxdeploy and
appimagetool chain is sourced immutably and verified by checksum.
