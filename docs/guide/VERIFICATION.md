# Verification · 2026.0.39 study guide

Verified on 15 September 2026 against VOCO commit `fb957ff052547c24be92265b6b5343a4c29aff4b`.

## Automated checks

Eight standard-library tests pass:

- Loopback binding and security response headers.
- Foreign Host, Origin and cross-site request rejection.
- Source content equals the pinned Git blob; unknown paths and private-file paths are denied.
- Traversal attempts, unknown endpoints, duplicate source parameters and writes are denied.
- Binary source remains metadata-only.
- Every tracked path and blob matches the pinned Git tree, including C/C++ source.
- Chapter generation is reproducible.
- All 18 chapters cite existing files and contain valid step and quiz structures.

Run `VOCO_SOURCE=/path/to/voco python3 -m unittest discover -s tests -v`.

## Browser evidence

Checked in the Codex in-app browser:

- Chapter navigation and the five-step diagram.
- Correct-answer feedback in the opening quiz.
- Queue exercise: two captured boxes become two processed boxes with zero waiting after Stop.
- Exact-path source search, source dialog open/close, and displayed TypeScript and native C source.
- Glossary filtering.
- Desktop layout and 390 × 844 narrow layout, with no horizontal overflow.
- Narrow chapter drawer open/close; closed chapter links are absent from accessible navigation.
- No warning/error console entries during the checked flows.

The initial narrow drawer could remain keyboard-accessible while off-screen. It now uses hidden visibility when closed; the fix was verified in the browser. The initial catalog classified native C and replay examples too broadly; they now have explicit groups and readable text blobs.

The concept, desktop/narrow screenshots and raw verification receipts are retained separately from this public source tree. See DESIGN.md for the visual fidelity ledger.

## Limits

These checks qualify this study guide, not VOCO’s recognition accuracy or every Linux desktop integration. The lessons explain major layers and contracts. Every tracked file is indexed, but the catalog’s generic summaries are not individual audits of every upstream function. No private audio or benchmark logs are bundled. No public website deployment is configured.
