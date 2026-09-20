import type { DictationSessionPhase } from "./dictationSession";

export type DictationTriggerAction = "start" | "stop";

/** Browser stop messages belong to their original recording, even after focus loss. */
export function admitsDictationTrigger(
  phase: DictationSessionPhase,
  activeTriggerId: string | undefined,
  triggerId?: string,
  action?: DictationTriggerAction,
): boolean {
  if (action === undefined) return true;
  if (triggerId !== "onboarding:test" && !triggerId?.startsWith("browser:")) return false;
  if (action === "start") return phase === "idle" || phase === "error";
  return triggerId === activeTriggerId && (phase === "starting" || phase === "recording");
}
