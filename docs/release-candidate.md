# Release status

**2026.0.38 is the next private candidate.** It simplifies VOCO to direct cursor
dictation, removes assistant and conversation capabilities, and adds a usable
settings-window drag surface. Existing microphone and shortcut preferences survive
migration. The NVIDIA model and streaming/delivery safeguards are retained.

The [2026.0.37 cut](releases/2026.0.37.md) is frozen. Its tests do not qualify new
2026.0.38 bytes. The latest public GitHub download may be older than either candidate.

## Required before the next cut

- Source, UI, Rust, worker, packaging and unchanged Whisper accuracy gates pass.
- Isolated rendered settings and native desktop delivery checks pass.
- Complete NVIDIA package, licenses, source provenance and checksums are verified.
- Known limitations and untested desktops are recorded in the release notes.

## Public launch

Keep releases as private drafts until final artifact benchmarks, manual acceptance
and explicit publication approval. No universal Linux compatibility or performance
superlatives follow from limited userspace tests. See [release process](release-process.md).
