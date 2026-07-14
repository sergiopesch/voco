export type StableCursorFallbackAction =
  | { status: "normal-insertion" }
  | { status: "preserve-target" };

/**
 * Routes final text only when no stable-streaming target text exists and the
 * session has not lost its target lease. Existing normal target text is never
 * reconciled through global cursor injection.
 */
export function planStableCursorFallback(
  hadCommittedTargetText: boolean,
  cursorTargetValid: boolean,
): StableCursorFallbackAction {
  if (hadCommittedTargetText || !cursorTargetValid) {
    return { status: "preserve-target" };
  }
  return { status: "normal-insertion" };
}
