import type { CursorDeliveryState } from "@/types";

export type CursorDeliveryEvent =
  | "session-reset"
  | "canonical-started"
  | "ownership-established"
  | "ownership-unavailable"
  | "ownership-uncertain"
  | "session-idle";

export function nextCursorDeliveryState(
  current: CursorDeliveryState,
  event: CursorDeliveryEvent,
): CursorDeliveryState {
  switch (event) {
    case "session-reset":
      return "inactive";
    case "canonical-started":
      return "pending";
    case "ownership-established":
      return "owned";
    case "ownership-unavailable":
      return current === "unreconciled" ? current : "preview-only";
    case "ownership-uncertain":
      return "unreconciled";
    case "session-idle":
      return current === "unreconciled" ? current : "inactive";
  }
}
