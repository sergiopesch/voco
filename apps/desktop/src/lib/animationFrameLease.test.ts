import { describe, expect, it, vi } from "vitest";
import { createAnimationFrameLease } from "@/lib/animationFrameLease";

describe("createAnimationFrameLease", () => {
  it("cannot cancel a replacement preview after a stale request rejects", async () => {
    let nextFrameId = 1;
    const cancelledFrames: number[] = [];
    const requestFrame = vi.fn(() => nextFrameId++);
    const cancelFrame = vi.fn((frameId: number) => cancelledFrames.push(frameId));

    let rejectOldRequest: (reason?: unknown) => void = () => {};
    const oldRequest = new Promise<void>((_resolve, reject) => {
      rejectOldRequest = reject;
    });
    const oldPreview = createAnimationFrameLease(requestFrame, cancelFrame);
    oldPreview.schedule(() => {});
    const oldFailure = oldRequest.catch(() => oldPreview.stop());

    oldPreview.stop();
    const replacementPreview = createAnimationFrameLease(requestFrame, cancelFrame);
    replacementPreview.schedule(() => {});

    rejectOldRequest(new Error("The old microphone request failed late."));
    await oldFailure;

    expect(cancelledFrames).toEqual([1]);
    expect(replacementPreview.isActive()).toBe(true);

    replacementPreview.stop();
    expect(cancelledFrames).toEqual([1, 2]);
  });
});
