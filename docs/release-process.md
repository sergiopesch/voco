# Release Process

VOCO releases are cut from git tags in the form `voco.<version>`.

## Rehearsal

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
- `v*`

The intended stable path is `voco.<version>`.

## Current Output

The release workflow:
- builds the Debian bundle
- attempts the AppImage bundle
- falls back to `scripts/package-appimage.sh` when Tauri stops after producing `VOCO.AppDir`
- generates checksums
- renders the GitHub release body from `scripts/render-release-body.sh`

## Publish Checklist

- bump the repo version everywhere required by `npm run verify:versions`
- run `npm run rehearse:release`
- ensure the CI workflow is green on `master`
- create the tag as `voco.<version>`
- verify the GitHub Release contains the expected assets and notes

## End-User Test Gate

The GitHub Release path is ready for end-user testing when all of these are true:

- `npm run rehearse:release` passes on the release commit
- GitHub Actions CI is green on `master`
- the release tag is cut as `voco.<version>`
- the README points users at the branded guided installer first
- the GitHub Release contains:
  - `voco_<version>_amd64.deb`
  - `voco_checksums.txt`
  - `VOCO-<version>-x86_64.AppImage` if the AppImage build completed

For the first end-user release test, treat the `.deb` as the primary path. Treat the AppImage as a secondary path only when that asset is actually attached to the release. Snap and Flatpak are not part of the current end-user release test gate.
