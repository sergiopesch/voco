import { describe, expect, it } from "vitest";
import { nextCursorDeliveryState } from "@/lib/dictationDelivery";

describe("cursor delivery state", () => {
  it("tracks a successfully owned canonical session", () => {
    const pending = nextCursorDeliveryState("inactive", "canonical-started");
    expect(pending).toBe("pending");
    const owned = nextCursorDeliveryState(pending, "ownership-established");
    expect(owned).toBe("owned");
    expect(nextCursorDeliveryState(owned, "session-idle")).toBe("inactive");
  });

  it("makes unavailable ownership an explicit preview fallback", () => {
    expect(
      nextCursorDeliveryState("pending", "ownership-unavailable"),
    ).toBe("preview-only");
  });

  it("preserves uncertain delivery for user recovery until a new session", () => {
    const uncertain = nextCursorDeliveryState("owned", "ownership-uncertain");
    expect(uncertain).toBe("unreconciled");
    expect(nextCursorDeliveryState(uncertain, "session-idle")).toBe(
      "unreconciled",
    );
    expect(nextCursorDeliveryState(uncertain, "ownership-unavailable")).toBe(
      "unreconciled",
    );
    expect(nextCursorDeliveryState(uncertain, "session-reset")).toBe("inactive");
  });
});
