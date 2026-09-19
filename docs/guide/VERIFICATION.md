# Verification · 2026.0.39 study guide

## Evaluation chapter update · 19 September 2026

The source catalog remains pinned to .39. A nineteenth chapter now explains the
later .41 TypeSafe evaluation, with curated context/thread comparisons and explicit
limits. No raw benchmark logs, speech transcripts or credentials enter the site.

Nine standard-library tests pass, including the dated comparison contract and all
original server/source protections. Chapter generation is reproducible. The
separate evaluation tools pass six Python and five Node tests; 28 existing text
quality/comparison regression tests also pass.

Checked in the in-app browser: the new journey's Next control, consequential-error
quiz feedback, pinned source modal, exact-file search, new glossary entries, both
comparison tables, and the narrow chapter drawer. At a 390 × 844 viewport the
document width and scroll width both measured 375 px (remaining space is the
scrollbar); the table scrolls within its own region. The temporary viewport was
reset. No error or warning console entries were recorded during these flows.

One initial unittest invocation used the repository root and discovered no guide
tests. It was not counted as a pass; the corrected invocation from `docs/guide`
ran all nine successfully. This verifies the guide, not physical dictation quality.

## Original application tour · 15 September 2026

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
