# Local release candidate — 14 September 2026

The testing candidate uses **2026.0.35** for both the Debian package and application.
It carries forward the validated `2026.0.34+rc1` cleanup; that candidate was based on
the `2026.0.34+focus1` application/runtime snapshot.
This is pre-release preparation, not a release cut or permission to publish.

## Delivery sequence

1. Prepare a complete, traceable local candidate and record automated validation.
2. The owner tests it on the laptop, including the actual intended applications.
3. Resolve the owner's findings and obtain release-cut approval.
4. Cut the release, then run further artifact/installed testing before public sharing.

The candidate is not ready merely because model tests pass. Confirm these gates
against the accompanying candidate receipts; unrecorded results remain pending:

| Gate | Required evidence |
| --- | --- |
| Source/provenance | Baseline identity, exact changes, source/runtime/model hashes |
| Regression checks | Frontend, Rust, worker/protocol, privacy and error-path results |
| Complete package | NVIDIA assembler validation, payload manifest, package hash, notices/dependencies |
| Runtime replay | Capture-to-recognition-to-field assertions, completion/recovery, resource/timing scope |
| Owner laptop acceptance | Real microphone and Codex/Brave/Ghostty field checks; pending until owner tests |
| Release cut | Explicit owner approval after findings are resolved; not authorized yet |
| Public sharing | Post-cut downloaded/installed artifact checks and owner sign-off |

## Source and evidence map

The `2026.0.35` Git branch is the reviewable application source. Local build and
installation receipts are recorded in the separately supplied delivery directory;
those absolute paths are not portable repository paths. The earlier candidate
`BASELINE.json`, validation reports and package receipts remain frozen evidence.
Consult the delivery index for exact artifact locations and checksums. A matching
version label alone does not prove a package or running executable has these changes.

Model weights and compiled native runtime artifacts are excluded from GitHub source.
The local candidate has the tested payload; fresh clones need separately provisioned
pinned artifacts before a complete build. See [runtime provisioning](linux-packaging.md#runtime-provisioning).
Updating a branch or review PR does not create or authorize a release tag.

The prior frozen `personal-benchmark-2026-09-14/round3` evidence contains the PDF,
63 selected trial records, configuration identities, rejected attempts, charts and
`DELIVERY-SHA256SUMS.json` (422 pinned files). It remains outside this source tree.
Do not copy personal audio/transcripts into public documentation or alter those
receipts to match a newer candidate. [This summary](testing/model-comparison-2026-09-14.md)
provides shareable aggregate measurements with their limits.

## Current boundaries

The local default is English NVIDIA Nemotron CPU streaming. Generic desktop paste
has best-effort focus checks and no recipient acknowledgement. Whole-message
post-Stop rewrite, universal editor support and physical Wayland acceptance are
not established. Qwen, Moonshine and Parakeet are research comparison adapters;
Whisper also remains legacy application code, but its tested offline adapter is
not the current streaming default. Model rankings are specific to the recorded
workloads and this hardware.

Dated documents under `docs/audits`, `docs/testing` and `docs/decisions` are historical
receipts or proposals unless explicitly referenced as the current contract. In
particular, early manual-copy-only and 30-second Whisper streaming limits must
not be presented as the current NVIDIA application's behavior.
