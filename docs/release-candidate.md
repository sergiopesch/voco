# Release status

**2026.0.39 is the next private candidate.** It backports the upstream glib
iterator safety fix while retaining VOCO's dictation-only UI, NVIDIA model and
streaming/delivery behavior. The frozen .38 cut remains the comparison baseline.

## Required before the cut

- Pinned glib source matches the exact upstream patch; every consumer resolves it.
- Optimized iterator regression, full CI and unchanged Whisper accuracy gates pass.
- Isolated renderer/native delivery and package install/remove checks pass.
- Complete NVIDIA package, licenses, provenance and downloaded checksums match.
- Performance comparisons identify fixture scope and uncertainty.

The [glib backport record](../vendor/glib/VOCO-PATCH.md) explains why a compatible
source fix is used instead of adding a second glib version. This fixes the named
iterator defect; it does not establish that all dependency findings are resolved.

## Public launch

Private cut preparation is authorized. Final artifact benchmarks, manual acceptance
and explicit publication approval remain separate gates. Hosted tag builds still
need portable pinned NVIDIA provisioning. See [release process](release-process.md).
