# 2026.0.60 release qualification

Status: source preparation. No complete 2026.0.60 installer, package hash,
installed-desktop receipt, signed tag or public download is claimed here.

The candidate contains the bounded accessibility verification correction and
cleanup from [PR 83](https://github.com/sergiopesch/voco/pull/83), Tauri 2.11.6
from [PR 81](https://github.com/sergiopesch/voco/pull/81), and Vite 8.3.1 from
[PR 82](https://github.com/sergiopesch/voco/pull/82). See the
[reliability record](cloud-reliability-2026-09-28.md) for the original correction's
tests and limits. Dependency and version integration require fresh protected CI.

## Remaining release gates

1. Record the final clean source commit and all four successful protected jobs,
   including pinned Nemotron accuracy/continuity and optimized GLib verification.
2. On the qualified release builder, provision the pinned payload using
   `bash scripts/provision-ci-speech.sh`, then follow
   [Linux packaging](../linux-packaging.md) to build and assemble a complete
   NVIDIA Debian package. The base Tauri archive is not an installable release.
3. Run `scripts/verify-deb-package.sh`, then exact-package isolated runtime,
   install/upgrade/remove and native desktop checks. Record package/source hashes,
   payload identity, licenses, attempts and failures. Earlier package receipts do
   not qualify these new bytes; physical devices remain separate acceptance.
4. Have the maintainer sign the canonical `voco.2026.0.60` tag and checksum
   manifests with the existing release key. Verify the fingerprints/signatures,
   upload the full asset set, and verify downloaded assets before publication.
5. Only after verified publication, update `packaging/published-release.json`,
   README's public installer link and the release-status record together.

## Cloud handoff

CI already provisions the exact checksum-pinned runtime from the historical
2026.0.47 package and verifies its model/native identities. Runtime retrieval is
not the missing capability. This cloud session has no connected qualified release
builder or maintainer signing environment, and its GitHub connector cannot upload
release assets. Repository policy keeps hosted installer assembly disabled and
the private signing key outside CI. No substitute key or unsigned public release
has been created.

Keep 2026.0.59 downloads and frozen receipts intact. Fedora, openSUSE and
Arch/Omarchy remain at their independently qualified 2026.0.43 release.
