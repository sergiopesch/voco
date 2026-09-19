# Release process

Release tags use `voco.<version>`. Keep public releases separate from private
candidate preparation. Never move a cut tag or replace its frozen artifacts.

## Prepare

1. Start from the current default branch and use a dedicated release branch.
2. Update all version metadata with the same version. Keep historical records unchanged.
3. Run the source, renderer, worker, native delivery and package checks in
   [AGENTS.md](../AGENTS.md). Pass the unchanged Whisper accuracy gate.
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
If a signing key is unavailable, say the tag is unsigned; checksums are integrity
checks, not a substitute for signatures.

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

## Additional native Linux channels

Follow [the support gates](linux-support.md) for each distribution and desktop.
Build Fedora and openSUSE RPMs from their explicit dependency profiles; preserve
companion source packages and all bundled licenses. Validate nodocs license
retention as well as full-document payload parity. Keep native package revisions,
checksums and signatures independent. A successful .deb test or a renamed RPM is
not acceptance for another channel. Do not publish .43 until its outstanding
capture and desktop gates are complete.
