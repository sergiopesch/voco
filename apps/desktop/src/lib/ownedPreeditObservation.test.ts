import { describe, expect, it, vi } from "vitest";
import { observeOwnedPreeditMutation } from "@/lib/ownedPreeditObservation";
import type { OwnedPreeditStatus } from "@/types";

function ownedPreeditStatus(
  setupState: OwnedPreeditStatus["setupState"],
): OwnedPreeditStatus {
  return {
    available: setupState === "ready",
    ready: setupState === "ready",
    setupState,
    detail: "",
    sessionId: null,
    engineActive: false,
    focusLost: false,
    progressiveCommitActive: false,
    committedCharacterCount: 0,
    ownershipIntact: false,
    finalizationOutcome: null,
    error: null,
  };
}

describe("owned preedit observation", () => {
  it("observes a successful mutation exactly once without refreshing", async () => {
    const status = ownedPreeditStatus("ready");
    const refresh = vi.fn(async () => ownedPreeditStatus("not-enabled"));
    const observe = vi.fn();

    await expect(
      observeOwnedPreeditMutation(async () => status, refresh, observe),
    ).resolves.toBe(status);

    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(status);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes after a mutation failure and preserves the original error", async () => {
    const originalError = new Error("mutation failed");
    const refreshedStatus = ownedPreeditStatus("runtime-unavailable");
    const refresh = vi.fn(async () => refreshedStatus);
    const observe = vi.fn();

    await expect(
      observeOwnedPreeditMutation(
        async () => {
          throw originalError;
        },
        refresh,
        observe,
      ),
    ).rejects.toBe(originalError);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(refreshedStatus);
  });

  it("does not replace a mutation error when recovery also fails", async () => {
    const originalError = new Error("mutation failed");
    const refresh = vi.fn(async () => {
      throw new Error("refresh failed");
    });
    const observe = vi.fn();

    await expect(
      observeOwnedPreeditMutation(
        () => Promise.reject(originalError),
        refresh,
        observe,
      ),
    ).rejects.toBe(originalError);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    expect(observe).not.toHaveBeenCalled();
  });
});
