# Release process

A VOCO release is a signed Git tag, `voco.<version>`, and a GitHub release that
carries the Debian package and the Fedora RPM, the source, the installer, two
records and signed checksum manifests. The maintainer builds, verifies and signs
each release on their own Linux computer with `scripts/assemble-release.sh`.
Hosted CI tests every commit on `master`, including a release build of the app,
but it never packages the speech runtime, holds the signing key or publishes
anything.

Versions have the form `YYYY.0.N`: the year, then a number that grows with each
release. A fix ships as a new version; a published tag or asset is never replaced.

## One-time setup

On the Linux computer that signs releases:

1. Keep the secret half of the release key in that computer's GnuPG keyring and
   nowhere else: not in CI, the repository or another service. `KEYS` holds only
   the public half, whose fingerprint `SECURITY.md` and the
   [security model](security/README.md#release-signing) publish.
2. Sign tags with it:
   `git config user.signingkey B33C7C6AAEC8C20433A7A837540796453D8E3865`.
3. Install what [CONTRIBUTING.md](../CONTRIBUTING.md#prerequisites) lists,
   including Tauri CLI 2.10.1, run `bash scripts/setup.sh`, and add the packaging
   tools: `sudo apt install binutils desktop-file-utils appstream rpm`. The `rpm`
   package provides `rpmbuild`. The assembler also needs `gpgv` and names any
   command it can't find; the upload needs `gh`.
4. Use Ubuntu 24.04. Its glibc 2.39 and GCC 13 runtime set both packages'
   floors, and the RPM check stops if a binary needs a newer symbol version.

## Make a release

### 1. Set the version

Change the version by hand in `package.json`, `apps/desktop/package.json`, the
three `package-lock.json` entries (top level, root and `apps/desktop`),
`apps/desktop/src-tauri/Cargo.toml`, the `voco` entry in its `Cargo.lock`,
`tauri.conf.json`, `packaging/ibus/voco.xml`, and `VERSION` and the example tag
in the header comment of `install`. `npm run verify:versions` names any file
that differs; `npm run rehearse:release` checks the installer's tag.

### 2. Describe the changes

- Write `docs/releases/<version>.md`: what's new, how to upgrade, and known
  limits. The GitHub release links to this file at the tag, and the assembler
  stops without it.
- Add a `## [<version>] - <date>` section at the top of [CHANGELOG.md](../CHANGELOG.md),
  with its compare link at the bottom.
- Put a `<release version="<version>" date="<date>">` element with a short
  `<description>` first in `packaging/tauri/com.sergiopesch.voco.metainfo.xml`.

### 3. Merge with CI green

Merge the pull request to `master`. The assembler asks GitHub's public API for
the `ci.yml` push run on `master` for that exact commit. The run must be
complete and successful, with every job passed, Application included.

### 4. Tag the commit

On the signing computer, check out the merged commit. The tree must be clean,
with no untracked files. Keep the tag local until both packages have been tried.

```bash
git tag -s voco.<version> -m "VOCO <version>"
git verify-tag voco.<version>
```

### 5. Provision the runtime

```bash
bash scripts/provision-ci-speech.sh
```

This fills `runtime/speech/` with the pinned model and native libraries, which Git
ignores; see [runtime provisioning](linux-packaging.md#runtime-provisioning).

### 6. Assemble and try the packages

```bash
bash scripts/assemble-release.sh ~/voco-release
```

The output directory must be outside the repository and must not exist yet. The
script stops unless the tag is annotated, points at `HEAD` and is signed by the
release key, `KEYS` holds exactly that key, its secret half is present, the
versions agree, `install` pins the key, the release notes and runtime exist, the
Tauri CLI is 2.10.1 and CI passed. It builds with `SOURCE_DATE_EPOCH` set to the
commit time and stops if the build changed a tracked file. From one staged tree
it builds the Debian package and the RPM, verifies both, the RPM also against
the Debian package, and runs the worker protocol checks against the packaged
worker. Then it writes the assets, signs each manifest and verifies it with
`verify-release.sh --keys KEYS`, repeats the installer's `gpgv` check with the
key embedded in `install`, and renders `release-notes.md`. It uploads nothing.

| Asset | Contents |
| --- | --- |
| `voco_<version>_amd64.deb`, `voco_latest_amd64.deb` | The Debian package, under its own name and the fixed name the manual install uses |
| `voco-<version>-1.x86_64.rpm`, `voco_latest_x86_64.rpm` | The RPM, under its own name and the fixed name the manual install uses |
| `voco_<version>_source.tar.gz` | `git archive` of the tag |
| `voco-panel@voco.local.shell-extension.zip` | The GNOME companion |
| `install`, `KEYS` | The guided installer and the public key |
| `voco_<version>_provenance.json`, `voco_<version>_validation.json` | The source, the hashes and sizes of both packages and other files, and the build tools; the CI run, the local checks and their limits |
| `voco_<version>_checksums.txt`, `voco_checksums.txt` | Every other asset except the signatures, under two names |
| `voco_<version>_debian_checksums.txt`, `voco_latest_checksums.txt` | The Debian package's checksum, under its own name and under its fixed name |
| `voco_<version>_rpm_checksums.txt`, `voco_latest_rpm_checksums.txt` | The RPM's checksum, under its own name and under its fixed name |
| `voco_<version>_source_checksums.txt` | The source archive's checksum |
| `*.asc` | A detached signature for each manifest |

Install the Debian package with the `sudo apt install` command the script
prints and run the [manual acceptance check](testing/README.md#manual-acceptance).

The validation record doesn't cover installing the RPM, so try it on a Fedora 44
computer with SELinux enforcing. Copy `voco-<version>-1.x86_64.rpm` there, then:

1. Install it with `sudo dnf install ./voco-<version>-1.x86_64.rpm`. DNF warns
   that it skipped OpenPGP checks, because the RPM carries no signature of its
   own.
2. Run `voco --check-desktop-input` and `voco --setup-panel`, sign out and back
   in, and run the voice test.
3. Remove it with `sudo dnf remove voco`.
4. Check that `sudo ausearch -m avc -ts today` finds no denial.

### 7. Push the tag and create a draft

```bash
git push origin voco.<version>
gh release create voco.<version> --draft --verify-tag --title "VOCO <version>" \
  --notes-file ~/voco-release/release-notes.md ~/voco-release/assets/*
```

`--verify-tag` stops `gh` unless the tag is already on GitHub, so creating the
release can't create an unsigned tag.

### 8. Check the draft, then publish

Download the draft's assets into a new directory, compare them with the files
you uploaded, and verify them:

```bash
gh release download voco.<version> --dir ~/voco-draft
diff -r ~/voco-release/assets ~/voco-draft
bash scripts/verify-release.sh --keys KEYS ~/voco-draft/voco_checksums.txt
```

Read the draft's notes on GitHub, publish with
`gh release edit voco.<version> --draft=false`, then try the guided installer
from the published tag in a desktop session, on Ubuntu or Debian and on Fedora:

```bash
wget -qO voco-install https://raw.githubusercontent.com/sergiopesch/voco/voco.<version>/install && bash voco-install
```

### 9. Point the docs at the release

After publishing, update in one pull request `version` in
`packaging/published-release.json`, the version and install command in
[README.md](../README.md), and the guided install command, `TAG` and the two
`KEYS` addresses in [Install](install.md). Until then they install the previous
release, and `npm run rehearse:release` fails if the README doesn't match the
JSON file.

## What CI checks

`.github/workflows/ci.yml` is the only workflow. It runs on every pull request
and push to `master`, with read-only permissions, actions pinned to commit SHAs
and checkouts that keep no credentials. Its Application job runs the release
executables in isolated desktops, as [Testing](testing/README.md) describes. The
signing computer rebuilds them from the same commit, so the released files
aren't byte-identical to the ones CI ran; the validation record says so. Its
GNOME 50 Companion job runs the companion on Ubuntu 26.04, and its Debian 13 and
Fedora 44 Runtime jobs install the packages' dependencies by those systems'
names and run the speech runtime there. No job builds a package, and the
assembler requires every job to have passed.

`npm run verify:devops` runs `scripts/check-devops.sh`, which fails when another
workflow file appears or when `ci.yml` mentions `package-nvidia.py`,
`sign-release-checksums`, `assemble-release` or any secret. It also runs
`npm run rehearse:release`, which needs no key or network. The rehearsal checks
the versions, the release scripts and the installer helper tests; that no
README, doc or installer comment installs from `master` or pipes a download into
a shell; that the install guide keeps its checksum steps, the installer names
its own tag and the README installs the published version; that the assembler
builds the RPM from the Debian package's staged tree, verifies it against the
Debian package and creates drafts with `--verify-tag`; and that the release
notes give both packages' verification commands. Then it prints the release
notes it would render. `check-devops.sh` also keeps the RPM spec in step with
the Debian dependencies, as [Linux packaging](linux-packaging.md#package-checks)
describes.

## Change the release key

A new key must replace the old fingerprint everywhere `git grep` finds it, in
one change: `KEYS`, `VOCO_RELEASE_KEY_BASE64` and `VOCO_RELEASE_KEY_FINGERPRINT`
in `install`, `FINGERPRINT` in `scripts/assemble-release.sh`,
`scripts/render-release-body.sh`, `scripts/test-install-journey.py`,
[SECURITY.md](../SECURITY.md), the install guide, the security model and this
page. Then set `user.signingkey` to the new key. Each tag's installer carries
its own copy of the key that signed that tag's release.
