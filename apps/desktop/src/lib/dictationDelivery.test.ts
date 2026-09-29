import { describe, expect, it } from "vitest";
import { nextCursorDeliveryState } from "@/lib/dictationDelivery";

describe("cursor delivery state", () => {
  it("owns a browser field only until the session boundary", () => {
    expect(nextCursorDeliveryState("ownership-established")).toBe("owned");
    expect(nextCursorDeliveryState("session-idle")).toBe("inactive");
    expect(nextCursorDeliveryState("session-reset")).toBe("inactive");
  });
});
