# Guide verification history

## Wayland installer follow-up · 20 September 2026

The Linux chapter now explains the .45 guided-installer dependency gap and the
.46 candidate readiness boundary. The .43 source catalog remains pinned. All nine
guide tests and lesson-regeneration checks pass. Browser checks covered the new
lesson, journey controls, quiz feedback, pinned source viewer, installation-file
search, glossary entries and the narrow chapter drawer. At 390 × 844, content and
scroll widths were both 390 px. The viewport was restored and the test browser
closed. No browser errors were reported. These checks qualify the guide only.

## Final .43 package evidence · 19 September 2026

The catalog pins `c0b657f2299fb477d297786fe5d0606e88e7e4cc`, including the
final package and desktop report. Twenty chapters distinguish public availability
from candidate evidence, retain the original TypeSafe experiment identity and
explain measured fixes and remaining gaps. No private recordings or credentials
were added.

Browser checks verified the final Linux chapter, exact pinned report in the source
reader, installation-file search, glossary, journey step and quiz feedback. The
390 × 844 responsive check measured 375 px for both content and scroll width; the
chapter drawer opened correctly. The viewport override was reset. No console
warnings or errors were observed. Nine guide tests pass after regeneration.

## Linux package chapter · 19 September 2026

Twenty chapters now include separate package/desktop gates and the unsuccessful
Hyprland hidden-microphone experiment. The source catalog pins the .43 development
commit a2f3c36b7434; it does not announce a release. All nine guide tests pass.

Browser checks passed for the new navigation label, journey steps, quiz feedback,
pinned trigger-client source, file search, glossary and mobile chapter drawer.
At 390 × 844, content and scroll widths both measured 375 px. No console errors
or warnings were observed. The temporary viewport override was reset.

Initial checks caught an omitted navigation title, an outdated source-note
assertion and an incorrect unittest working directory; these were corrected.
Regenerating a catalog requires restarting the guide server before browser checks,
because the server retains its pinned catalog in memory.


## Public .42 source refresh · 19 September 2026

The source catalog now pins the .42 release-preparation commit recorded in
`site/catalog.json`. Version metadata is read from that commit, and tests compare
every catalog path/blob and version against Git. The 19 chapters cite this source,
including the explicit NVIDIA recovery implementation and evaluation tools.
The before/after experiment tables keep their original .41 measurement identity.

Nine server, source, generation and chapter-contract tests pass after this refresh.
External-facing language identifies the test hardware without referring to a
particular reader or personal machine. Historical checks below remain dated.

## Historical evaluation chapter update · 19 September 2026

At this checkpoint the source catalog remained pinned to .39. A nineteenth chapter now explains the
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
