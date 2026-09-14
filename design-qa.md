# Crystal Sidebar settings implementation QA — 2026-09-05

final result: passed

## Follow-up: glass by default

Removed the Glass effects switches and More's Reduce visual effects option at
the user's request. The retired local-storage preference is no longer read or
written, so a previous opt-out cannot silently disable the default material.
System contrast, transparency and motion preferences still apply. Removed unused
switch styling and updated appearance documentation.

Browser verified Overview and Appearance contain no switch; More retains its
guide, device refresh and Realtime controls without the effects checkbox.
Overview still fits at 1040 × 760 (728px content and scroll heights). Actual host
high contrast still removes mesh and blur. Latest capture:
`../crystal-sidebar-evidence/overview-glass-default.jpg`.
TypeScript, ESLint and all 43 ControlPanel tests passed, including retired
preference coverage. The earlier toggle verification below is historical.
The updated frontend and Debian bundle built and passed package verification;
the uninstalled copy is `../crystal-sidebar-evidence/VOCO-glass-default_2026.0.21_amd64.deb`.

## Selected target and current evidence

Source: `../settings-reassessment/01-crystal-sidebar.png`, 1467 × 1072 generated
concept, normalized by approximately 1.41 to a 1040 × 760 logical desktop window.
Implementation: `../crystal-sidebar-evidence/overview.jpg`, 1040 × 760 browser
capture, normal-material fixture, ready state. Source and latest implementation
were opened together in one comparison input by both root and the independent
GPT-6 Astra design reviewer. Full-frame comparison was sufficient; no crop was
needed. All eight settings pages were inspected in the browser.

Typography uses live Geist with the existing silver microphone asset and
unmodified Lucide icons. Hierarchy, aligned rows, sidebar proportions, radius and
spacing follow the selected reference. Graphite glass has directional silver
reflections and a dark lower-right reading surface. The generated grille remains
behind the content. Copy reflects real application settings: Reduce motion reports
the system state, Output reports the configured delivery mode, and recovery takes
precedence over readiness. These are deliberate functional differences from the mock.

## Iteration and resolved findings

- Initial cards looked too uniformly opaque; changed the material to a darker,
  directional translucent gradient. Increased-contrast and reduced-effects
  surfaces remain opaque.
- Initial grille competed with headings; reduced backdrop opacity to 0.55.
- Overview had a small vertical overflow; reduced group gaps and bottom padding.
  Final content clientHeight and scrollHeight are both 728px at 1040 × 760.
- Sidebar height varied by page because an empty error slot removed its grid
  track; assigned explicit error and content grid rows. Sidebar now stays stable.
- Closed disclosures clipped keyboard outlines; inset the summary focus ring.
  Browser Tab verification measured a visible 2px outline with -4px offset.
- Forced-color selectors now explicitly override reduced-effects and primary
  button materials. This combination was source-reviewed, not OS-emulated.
- Replaced the Overview Output waveform with the library text-cursor icon.

Post-fix independent Astra review found no remaining P0/P1/P2 findings. Root
compared the final capture including the updated icon against the reference.

## Current behavioral verification

Browser journeys verified all page navigation, stable sidebar, glass toggle in
Appearance and Overview, native-field layout at 760 × 560, shortcut recording
and Escape cancellation, failed shortcut-save draft retention, and integration
draft protection across navigation. Keep editing reopened the correct disclosure
and focused `voco-local-model` with its edited value intact. Recovery remains above
setup groups; Review saved transcripts returns to the retained transcripts with
focus on the recovery heading. No browser errors were logged.

At minimum size, content scrolls while all eight navigation choices remain visible;
there was no document or content horizontal overflow. Actual host high contrast
rendered no mesh, blur or background gradients. Local reduced effects likewise
removed mesh and blur. Microphone feedback was verified with a synthetic oscillator
and with a blocked-device fixture; screenshots do not represent live user audio.

Current screenshots are in `../crystal-sidebar-evidence/`: overview.jpg,
microphone.jpg, appearance.jpg, shortcuts.jpg, settings-recovery.jpg. Diagnostic
captures include integration-focus.jpg, save-error.jpg, minimum-overview.jpg,
minimum-dictation.jpg, reduced-effects.jpg and system-high-contrast.jpg. Diagnostic
captures made before the final material refinement retain that earlier tint.

Validation: 244 frontend tests passed, 2 skipped; 79 IBus Python checks and all
three script suites passed. TypeScript, ESLint, version consistency, final frontend
production build and git diff whitespace checks passed. Debian custom-protocol
bundle built successfully and package, desktop/AppStream identity, icons and IBus
payload verification passed. Package copy:
`../crystal-sidebar-evidence/VOCO-crystal-sidebar_2026.0.21_amd64.deb`.
SHA256: `e0fc2e86954657cae9615c657cc6e9bc471740c45834e3ac3131006db848c884`.

No install, commit, merge or publication. Browser harness boundaries described
below still apply: native calls are stubbed, normal contrast is a fixture media
override, and actual Linux focus/insertion, global shortcuts, WebKitGTK material
rendering, screen readers and OS forced colors require on-device verification.
No native Rust behavior was changed by this settings pass.

P3 follow-up: Refresh devices could sit nearer its selector. The discreet window
hide action remains available on every page in addition to Overview's larger
dictation handoff, preserving native hide and unsaved-edit protection.

## Earlier Silver Lens implementation QA — retained provenance

final result: passed

Scope: browser-rendered production ControlPanel and production stylesheet, plus
frontend tests and Debian build. This is not native Linux/compositor/dictation
certification. No installation, commit, merge or publication was performed.

## Source and rendered evidence

- Selected target: `../glass-concepts/silver-lens-refined.png` (generated concept,
  approximately 3x density, intended 420 × 380 logical desktop panel).
- Actual: `../glass-implementation-evidence/daily-panel.jpg`, 420 × 380 browser
  viewport. Source and actual were opened together in the same comparison input.
  Comparison accounts for the source image's approximate export density; images
  were not stretched to force pixel alignment.
- Independent GPT-6 Astra visual review found no remaining visible P0/P1/P2
  differences. Source and actual both show centered silver microphone, clear
  state/shortcut, one cue, capsule primary action and aligned footer controls.
- Text is live Geist, icons are library assets and microphone is the existing
  alpha asset. Smaller microphone/gear and brighter secondary type are deliberate
  practical refinements. Corrected cue: “Hide, then focus a text field.”
- Additional captures: settings.jpg, setup-minimum.jpg, recovery.jpg,
  more-glass.jpg, compact-more.jpg, reduced-effects.jpg,
  system-high-contrast.jpg, realtime-fixture.jpg in the same evidence directory.

## Browser fixture boundaries

Preview imports production React/CSS from this worktree, with native calls,
clipboard, model requests and microphone access stubbed/blocked. It does not mount
App.tsx or exercise native focus restoration, insertion or global shortcut routing.
The host browser reports prefers-contrast: more. Default preview respects it and
was checked to show no mesh, no blur and no glass shadow. For full-material
screenshots only, `contrast=normal` changes the stylesheet media condition in the
external harness to simulate standard contrast. This is not a production CSS
change. The pointer hook continues to honor real media preferences; pointer
tracking and all preference exclusions have focused unit coverage, not a claim
of full-material pointer motion demonstrated in this contrast-host browser.

Cloud Crabbox doctor failed for missing Hetzner provider credentials. Local in-app
browser verification was used; it is not equivalent to remote VM evidence.

## Iteration and checks

Initial browser pass found 3px resting overflow and a misplaced footer More
control; fixed spacing and replaced display:contents with stable footer geometry.
Initial More disclosure expanded below the viewport; replaced it with an anchored,
scrollable glass disclosure above the trigger. Its height is bounded for short
viewports. At 380 × 280 it remained within the visible region, with no horizontal
overflow. Escape closes the disclosure and returns focus to More.

Independent engineering review found reduced-effects hover specificity leakage;
explicit hover/active fallbacks now suppress motion/shadows. Pointer handling also
excludes increased contrast, reduced transparency and forced colors. Independent
copy review found Realtime still consumed live level under the local reduced
setting; it now receives zero decorative level in that mode.

Verified browser interactions: More, help expansion, local reduced-effects toggle,
Escape/refocus, primary button activation through its fixture, microphone shortcut
opening the Microphone heading, Realtime start/stop fixture controls, recovery Copy
feedback scoped to its entry while both recoveries remain. No browser error logs.
Recovery retains partial labels, lifetime disclosure and duplicate-paste warning.
Setup at 760 × 560 has no horizontal overflow and Continue stays disabled without
an audio check. Long/active/recovery states reduce the decorative microphone size.

Five fidelity surfaces reviewed: typography, spacing, colors, imagery and copy.
Secondary text is clearer than the source, mesh recedes beneath the reading area,
and the original microphone retains its aspect ratio. Full-panel screenshots are
readable at logical size; no additional focused crop was needed.

Validation: 225 frontend tests passed, 2 skipped; 79 IBus Python checks and 3 script
suites passed. TypeScript, ESLint, version metadata, frontend build, desktop-file
and AppStream checks passed. Focused affected suites rerun after the final reduced
Realtime adjustment. Debian bundle built with custom-protocol. Native Rust
integration behavior and screen-reader/OS forced-colors interaction were not
rerun as part of this frontend material change.

## Remaining P3 / native follow-up

The primary reflection is more restrained than the generated mock. Native
WebKitGTK blur quality, compositor edge rendering, pointer appearance and actual
microphone/focus/insertion still require on-device verification. There is no
native Apple refraction or wallpaper blur implementation.
