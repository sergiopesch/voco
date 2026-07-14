# Release Process

VOCO releases are cut from git tags in the form `voco.<version>`.

## Quick path

1. Start from current `master`:

```bash
git checkout master
git pull origin master
npm ci
```

2. Run the release checks:

```bash
npm run verify:versions
npm run check
npm test
npm --workspace @voco/desktop run build:frontend
npm run rehearse:release
```

3. Commit and push:

```bash
git add .
git commit -m "Cut release <version>"
git push origin master
```

4. Create and push the release tag:

```bash
git tag voco.<version>
git push origin voco.<version>
```

5. Wait for the GitHub release workflow to create a draft with all verified assets, inspect it, then
   publish the draft manually only after release sign-off. Verify it contains:
- `voco_<version>_amd64.deb`
- `voco_checksums.txt`
- `VOCO-<version>-x86_64.AppImage` when AppImage packaging succeeds

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
  - `VOCO-<version>-x86_64.AppImage`
  - `voco_checksums.txt`

## Release Trigger

The GitHub release workflow runs on tags matching:
- `voco.*`

The workflow rejects a tag unless it exactly matches `voco.<package.json version>`.

## Current Output

The release workflow:
- builds the Debian bundle
- attempts the AppImage bundle
- includes the AppImage only when Tauri produces it; the manual AppDir fallback requires explicit
  `VOCO_APPIMAGETOOL_PATH` and `VOCO_APPIMAGETOOL_SHA256` values
- generates checksums
- renders the GitHub release body from `scripts/render-release-body.sh`
- uploads all available artifacts in one action and leaves the GitHub Release as a draft

## Publish checklist

- bump the repo version everywhere required by `npm run verify:versions`
- run `npm run rehearse:release`
- ensure the CI workflow is green on `master`
- create the tag as `voco.<version>`
- verify the GitHub Release contains the expected assets and notes

## Manual test before tagging

- start VOCO only inside the disposable remote desktop described in the testing guide
- complete onboarding
- test dictation with `Alt+D`
- confirm tray launch, settings, and hide-to-tray still work
- run `npm run report:linux-runtime` if Linux insertion changed

Treat the `.deb` as the primary release path. Treat the AppImage as secondary when that asset is attached successfully.
