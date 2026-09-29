import type { CursorDeliveryState } from "@/types";

export type CursorDeliveryEvent =
  | "session-reset"
  | "ownership-established"
  | "session-idle";

export function nextCursorDeliveryState(event: CursorDeliveryEvent): CursorDeliveryState {
  switch (event) {
    case "ownership-established":
      return "owned";
    case "session-reset":
    case "session-idle":
      return "inactive";
  }
}
