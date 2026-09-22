# Release process

Release tags use `voco.<version>`. Keep public releases separate from private
candidate preparation. Never move a cut tag or replace its frozen artifacts.

## Prepare

1. Start from the current default branch and use a dedicated release branch.
2. Update all version metadata with the same version. Keep historical records unchanged.
3. Run the source, renderer, worker, native delivery and package checks in
   [AGENTS.md](../AGENTS.md). Pass the pinned Nemotron accuracy, continuity and worker protocol gates.
4. Update product, install, architecture and security docs. Describe limitations
   without publishing personal audio, transcripts or local machine paths.
5. Build a complete NVIDIA package using pinned runtime/model artifacts. Verify
   its payload, licenses, ELF dependencies, native install/remove and checksums.
6. Review the diff and require all CI checks before merging to the default branch.

## Cut a private draft

Record the exact merged commit, source tree, build environment and package SHA-256.
Create an annotated local tag at that commit. Create a **draft** GitHub release
with versioned package, source archive, checksums, provenance and concise release
notes. Download the uploaded assets and verify every byte before marking the cut ready.
If the signing key is unavailable, keep this release pending. Checksums are
integrity checks, not a substitute for the required publisher signatures.

## Signed tags and checksums

Publisher signatures are created on the maintainer’s local signing environment. The hosted Release
workflow must not hold the private key or assemble NVIDIA installers.

One-time setup (interactive; never paste the private key into chat or CI):

```bash
bash scripts/setup-release-signing.sh
```

That wizard creates a 2-year ed25519 key, writes the **public** key to `KEYS`,
opens GitHub's GPG key form, and enables `tag.gpgSign` for this clone only. It
refuses to retag `voco.2026.0.39`.

For each **new** version, after checksums exist:

```bash
git tag -s "voco.<version>" -m "VOCO <version>"
git tag -v "voco.<version>"
bash scripts/sign-release-checksums.sh voco_<version>_checksums.txt voco_latest_checksums.txt
bash scripts/verify-release.sh --keys KEYS voco_<version>_checksums.txt
```

Attach both the checksum files and the `.asc` signatures to the GitHub release.
Do not move or recreate an already published tag to add a signature.

The hosted tag workflow still needs portable pinned NVIDIA provisioning from a
fresh clone. Do not re-enable it or push a later tag into that assembler. Public
releases attach verified local NVIDIA packages. This changes the delivery
mechanism, not the test gates.

Historical cuts and published tags are immutable. The release version is recorded
in package metadata; confirm the current public release on GitHub before cutting a
new version. The .40 and .41 development milestones are superseded by .42.

## Publish

Finish final artifact benchmarks, manual acceptance and performance documentation.
Obtain explicit publication approval, then activate the release channel and verify
the published installer, versioned assets and latest aliases. Keep the previous
release available for rollback. Follow-up changes require a new version.

Keep 2026.0.39 available for rollback after publishing .42. Never relabel an older
package as a new build. The hosted Release workflow stays disabled.

## Repository hygiene

Remove remote branches only when their exact tips are already merged, and retain
the recorded commit IDs. Do not delete dirty local worktrees or unresolved PRs.
Keep security updates separate when their dependency graph fails compilation;
never waive a gate or ignore an advisory just to clear the PR list.

Version updates run weekly on Monday at 09:00 Europe/London, with at most two
open version PRs per ecosystem. Compatible minor/patch updates are grouped;
major upgrades and the pre-1.0 input/hash libraries remain separate. Shortcut
plugin updates also stay separate because both consumers must resolve to the
same vendored actor. Security updates keep their independent queue; no advisory
is suppressed by this policy. Require the same protected checks for every merge.

Automatic deletion of merged PR branches is enabled in GitHub. For a combined
integration PR, merge the original dependency heads into it, resolve their
compatibility changes, and use a merge commit after CI passes. Verify those exact
heads are ancestors of the default branch before deleting any residual branches.
Do not squash away the ancestry needed to close the constituent PRs accurately.

Housekeeping, workflow and documentation changes alone do not require an app
release. Dependency or application changes included in shipped binaries do:
advance the version and qualify a fresh package; never replace published assets.

## Additional native Linux channels

Follow [the support gates](linux-support.md) for each distribution and desktop.
Build Fedora and openSUSE RPMs from their explicit dependency profiles; preserve
companion source packages and all bundled licenses. Validate nodocs license
retention as well as full-document payload parity. Keep native package revisions,
checksums and signatures independent. A successful .deb test or a renamed RPM is
not acceptance for another channel. Sign each RPM header and each Arch package
with the publisher key; never publish disposable guest-test signatures. Verify
RPM headers in an isolated RPM key database and Arch detached signatures against
the checked publisher key. Signing may change RPM archive hashes, so compare
installed payload identity with the qualified unsigned candidate afterward.

Provide a signed manifest per platform, listing only that platform's package and
required companion. Keep the complete versioned manifest for source, provenance,
validation and all release assets. Preserve the Debian latest alias for existing
users; do not point it at a different package format. Verify the exact uploaded
and anonymously downloaded bytes before publishing and upgrading the host.
