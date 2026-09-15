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

The hosted tag workflow still needs portable pinned NVIDIA provisioning from a
fresh clone. Until that is implemented and verified, keep the tag local and use
verified isolated build artifacts for the draft. Do not push a tag into a known
incomplete workflow or substitute mutable downloads. This changes the delivery
mechanism, not the test gates.

The [2026.0.37 cut](releases/2026.0.37.md) is historical and immutable. The .38
dictation-only cut is also frozen. The .39 glib backport changes native
application bytes and requires fresh qualification despite unchanged speech models.

## Publish

Finish final artifact benchmarks, manual acceptance and performance documentation.
Obtain explicit publication approval, then activate the release channel and verify
the published installer, versioned assets and latest aliases. Keep the previous
release available for rollback. Follow-up changes require a new version.

## Repository hygiene

Remove remote branches only when their exact tips are already merged, and retain
the recorded commit IDs. Do not delete dirty local worktrees or unresolved PRs.
Keep security updates separate when their dependency graph fails compilation;
never waive a gate or ignore an advisory just to clear the PR list.
