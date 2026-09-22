import type { DictationSessionPhase } from "./dictationSession";

export type DictationTriggerAction = "start" | "stop";

export function isBrowserTrigger(triggerId?: string): triggerId is string {
  return triggerId?.startsWith("browser:") ?? false;
}

/** A directed browser Stop can only cancel admission for its own Start. */
export function cancelsPendingStart(
  pendingTriggerId: string | undefined,
  triggerId?: string,
  action?: DictationTriggerAction,
): boolean {
  return action !== "start" && (!isBrowserTrigger(triggerId) || triggerId === pendingTriggerId);
}

export function canStopOnboardingTest(triggerId?: string): boolean {
  return !isBrowserTrigger(triggerId);
}

/** Browser stop messages belong to their original recording, even after focus loss. */
export function admitsDictationTrigger(
  phase: DictationSessionPhase,
  activeTriggerId: string | undefined,
  triggerId?: string,
  action?: DictationTriggerAction,
): boolean {
  if (action === undefined) return true;
  // The app's own Stop controls apply to its current recording, regardless of
  // start origin. They never admit Start or turn a delayed Stop into a toggle.
  if (triggerId === "tray:stop") {
    return action === "stop" && (phase === "starting" || phase === "recording");
  }
  if (triggerId !== "onboarding:test" && !triggerId?.startsWith("browser:")) return false;
  if (action === "start") return phase === "idle" || phase === "error";
  return triggerId === activeTriggerId && (phase === "starting" || phase === "recording");
}
