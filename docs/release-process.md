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

Publisher signatures are created on the signing laptop. The hosted Release
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

The [2026.0.37 cut](releases/2026.0.37.md) and the .38 dictation-only cut are
historical and immutable. [2026.0.39](releases/2026.0.39.md) is the current
public release.

## Publish

Finish final artifact benchmarks, manual acceptance and performance documentation.
Obtain explicit publication approval, then activate the release channel and verify
the published installer, versioned assets and latest aliases. Keep the previous
release available for rollback. Follow-up changes require a new version.

2026.0.39 was published from verified local artifacts. Previous public release
2026.0.21 remains available for rollback. The hosted Release workflow stays
disabled.

## Repository hygiene

Remove remote branches only when their exact tips are already merged, and retain
the recorded commit IDs. Do not delete dirty local worktrees or unresolved PRs.
Keep security updates separate when their dependency graph fails compilation;
never waive a gate or ignore an advisory just to clear the PR list.
