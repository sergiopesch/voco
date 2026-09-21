# Branded first-run journey — design candidate

The `codex/brand-motion` candidate keeps the existing VOCO microphone asset,
graphite materials and Alt+D default. It adds inline microphone selection,
automatic desktop prerequisite checking after the voice test, keyboard focus
transitions and a verified “Your voice, ready.” handoff. Done still revalidates
prerequisites before persisting completion. Microphone changes invalidate the
previous voice test. The opening renderer has a branded loading state; native
cold-launch visibility remains unqualified.

## Verification

- Desktop component tests: 442 passed, 2 skipped.
- Branded renderer checks: 5 groups passed, including focus and reduced motion.
- Full native-capture renderer fixture: 42 cases passed.
- Onboarding renderer fixture: 18 cases passed, including unavailable/failed/
  timed-out desktop checks, repair without repeating a passed test, consent,
  minimum-window screenshots and no external text or clipboard output.
- Browser-microphone renderer fixture: 31 cases passed.
- GNOME panel model: 4 tests passed.
- Typecheck, frontend build and DevOps preflight passed. ESLint reports the four
  pre-existing explicit-any warnings in dictationRecording.ts; no errors.

These renderer tests use simulated audio, recognition and desktop boundaries.
They do not prove physical microphone quality, compositor behavior or cursor
insertion in another application. No installed package or profile was changed.

## Installer presentation trial

Crabbox local-container lease `cbx_1a5753c4d55f` used Ubuntu 26.04, with a fresh
container user profile. The actual installer script ran through external command
fixtures for downloads, APT, package records and desktop readiness. Real checksum
verification and configuration writing ran inside the container. No release
package was installed; this was not a remote VM or fresh desktop qualification.
The lease was stopped after evidence collection.

Eight final scenarios passed: wide TTY, narrow TTY, NO_COLOR redirected, NO_COLOR
TTY, TERM=dumb TTY, ordinary redirected output, unavailable desktop input and
download failure. Static cases emit no ANSI sequences. Success exits 0, desktop
setup incomplete exits 2, download failure exits 1. Failure cases never show the
success handoff. Fresh setup uses Alt+D; helper tests also verify preservation of
existing shortcuts and settings.

Terminal presentation retains the original typographic wordmark, truncates the
active spinner label to fit narrow terminals and removes the early shortcut
question. Package-manager output and authentication prompts stay visible. Real
download progress and resumable downloads remain recommendations, not claims of
implemented behavior.
