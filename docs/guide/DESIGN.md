# Visual direction and fidelity ledger

Use VOCO’s actual silver microphone and Geist type on a white canvas. Graphite is the main ink; pale silver separates the interactive story. Rounded panels echo the application. No decorative accent colors.

The local concept and browser screenshots are saved in the separate release-assets evidence folder, outside this repository.

| Anchor | Implementation and verification |
| --- | --- |
| White canvas and graphite type | Preserved; local Geist regular/semibold and Geist Mono fonts. |
| VOCO identity in the left rail | Unchanged microphone symbol and uppercase wordmark. |
| Main headline and simple opening story | Preserved from the concept; left-aligned, prominent and readable. |
| Five-node voice-to-cursor journey | Preserved as an interactive sequence with outlined icons and a silver rounded panel. |
| Story beside code references | Two columns on desktop; one column on narrow screens. Real buttons open pinned source. |
| Numbered chapter rail and footer links | Extended from the concept’s first eight chapters to 18 source chapters plus the dated TypeSafe evaluation chapter; the chapter region scrolls independently. |
| Primary Play and secondary Next controls | Preserved, with accessible labels, focus indicators and finite animation. |
| Local-only utility strip | Kept once; the concept accidentally repeated the local-only label. |

Intentional functional additions: quizzes, read progress, glossary, searchable file catalog, source modal with line numbers and function/type jumps, and five teaching simulations. These support studying rather than adding product controls. Code opens inside the guide instead of launching an external editor. The generic keyboard symbol replaces the concept’s tiny Alt+D text; the exact shortcut is named in the step explanation.

Narrow layout was inspected at 390 × 844: stacked diagram, chapter drawer and no horizontal overflow. The closed drawer is hidden from keyboard and accessibility navigation. Motion runs only after Play, has a pause button and stops at the final step. CSS transitions respect reduced motion; contrast and print variants remain available.

The TypeSafe comparison uses a semantic table within a keyboard-focusable horizontal
scroll region on narrow screens. It retains the same palette and type. The original
source catalog remains pinned; new research results are explicitly separate.
