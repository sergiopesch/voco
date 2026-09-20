# Onboarding release review fixes — 20 September 2026

The unpublished signed .44 cut is superseded by .45. The model and recognition
configuration are unchanged. Earlier .44 evidence remains attributed to that
candidate in [the original record](onboarding-2026-09-20.md).

## Reproductions and corrections

- A delayed native source selection allowed onboarding recording to begin after
  Alt+D had already requested Stop. The new renderer regression fails against
  .44. Admission now carries a cancellation marker through asynchronous setup;
  a second toggle or explicit Stop cancels it, including browser recording
  ownership. An idle Stop does not request microphone access.
- A terminal role bypassed caret validation. Two new tests fail against .44:
  missing text interface and invalid caret. Terminals now validate text offsets
  before receiving a destination token, including terminals without the editable
  state flag. No field contents are read by this check.

## Focused results

- Onboarding renderer: 12 cases pass, including four pending-setup cancellation
  scenarios, native and WebKit speech tests, silence, access denial, recognition
  retry, Finish draining and missing-cursor feedback. No browser console errors
  or warnings. Capture and recognition are mocked at the native boundary.
- Destination focus: 35 tests pass, including both previously failing terminal
  cases and a valid terminal caret without the editable flag.
- Version consistency and TypeScript checks pass. Lint retains four existing
  explicit-any warnings in dictationRecording.ts, with no errors.

The local full test invocation stopped at missing NumPy after host cleanup; this
is an environment failure, not a passing full-suite result. Release qualification
uses isolated dependencies and protected CI. The published release must attach
validation and provenance receipts for the exact .45 installer, installed virtual
audio test, install/remove inventory and final CI. These focused results alone do
not establish those gates, physical microphone quality or Wayland compatibility.
