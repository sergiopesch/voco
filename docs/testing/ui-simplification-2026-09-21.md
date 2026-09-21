# VOCO interface simplification — 21 September 2026

Implemented on `codex/brand-motion`, based on the approved UX review. This is a
source candidate; the installed app and parallel installer worktree were not
modified. The existing silver microphone, wordmark, graphite/glass surfaces,
icons, status motion and horizontal GNOME panel capsule remain intact.

## Changes

- Onboarding has one primary action per stage: Start test, Finish test, Done.
  Finish drains capture and recognition; Done separately checks desktop input
  before saving completion. Speaker testing and repeated instructions are removed.
- Change microphone opens settings with a Back to setup action. An explicitly
  selected input survives returning to setup and completing it; the system default
  is selected on an explicit start only when no approved source exists.
- The compact tray uses one shortcut hint and direct Help access. The ready state
  fits 420 × 380 without document scrolling. Recovery text, partial-delivery
  warnings, explicit copying and discard actions retain their previous behavior.
- Settings combines Microphone and Shortcut. Updates and symptom-based Help are
  secondary destinations. Shortcut editing has explicit Apply/Cancel and restores
  keyboard focus. Technical microphone and shortcut details use disclosures.
- General settings does not start the browser microphone preview. Test microphone
  or an explicit microphone-settings entry opens it; active dictation pauses it.
- Documentation and branding copy describe the current local dictation product.

## Verification

| Gate | Result |
| --- | --- |
| TypeScript check | Passed |
| Frontend unit tests | 442 passed, 2 existing skips |
| ESLint | No errors; 4 existing `dictationRecording.ts` warnings |
| Frontend production build | Passed |
| Chromium presentation fixture | 5 groups passed |
| Full-App onboarding fixture | 18 cases passed |
| Full-App native capture fixture | 42 cases passed |
| Full-App browser microphone lifecycle fixture | 31 cases passed |

The presentation flow checks start → listening → finish → success, device
navigation/typeahead/disabled identities, consent reset, explicit application,
shortcut recording/Apply/Cancel/focus restoration, Help disclosures, Updates,
tray sizing, tooltips, error gates, reduced motion and forced colors. Page identity,
meaningful content, absence of the Vite overlay and console errors were checked.
Screenshots cover 850 × 680, 760 × 560/620, and 420 × 380 windows.

The onboarding fixture checks denied access, silence, failed recognition, Stop
flush, no external target/clipboard output, default and selected devices, missing
helpers, stopped daemons, readiness failure/timeout and repair. It also exercises
Change microphone → consent → Use this microphone → Back to setup → voice test.

Commands: `npm run check`, `npm run test -w apps/desktop`, `npm run lint`,
`npm run build:frontend -w apps/desktop`, `npm run test:brand-motion`,
`npm run test:native-capture-renderer` (normal and `VOCO_RENDERER_SUITE=onboarding`),
and `npm run test:microphone-renderer`. Renderer runs used separate ports and
exclusive evidence directories. Earlier failed attempts are retained separately;
they exposed outdated selectors/default-device expectations and port collisions.

## Evidence limits

Repository Playwright Chromium fixtures were used; no Browser plugin skill was
available. Screenshots render the production React components with synthetic
state. Full-App fixtures mock audio, recognition and OS calls. These are not
physical microphone, real cursor delivery or installed Tauri/WebKit evidence.
No package was installed or published. No GNOME panel implementation changed, so
this pass does not claim fresh compositor or panel-animation qualification.

Local receipts and screenshots are under `brand-motion-evidence/ux-delivery`,
`ux-onboarding-final-2`, `ux-native-delivery`, and `ux-webkit-fixture-3` alongside
the isolated checkout. The minimum settings window intentionally scrolls;
controls remain reachable. The compact ready tray does not need scrolling.
