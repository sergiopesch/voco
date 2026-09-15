# Release status

**2026.0.40 is being prepared for public release.** It retains local English
streaming dictation and the glib safety backport, while rebuilding native libraries
with a fixed CPU baseline and removing personal build paths from release artifacts.
Packaging now copies only explicitly listed public files.

## Required qualification

- All CI checks pass, including the unchanged Whisper accuracy gate.
- Pinned native sources, patches, model digest and licensing notices match.
- Fresh binaries pass CPU capability, worker, renderer and native delivery checks.
- The complete package passes isolated install/remove and privacy inspections.
- Benchmarks identify the exact binaries, fixture scope and measurement limits.
- Uploaded assets are downloaded again and their hashes verified before publication.

The .39 and earlier cuts remain historical evidence. Their host-native runtime
measurements do not qualify this fixed-baseline rebuild. Public release notes will
link the exact validation record; preparation is not a published-download claim.

See [release process](release-process.md), [packaging](linux-packaging.md) and the
[glib backport record](../vendor/glib/VOCO-PATCH.md). There is no claim of universal
Linux compatibility, world-leading accuracy or comprehensive security certification.
