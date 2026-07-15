export interface AnimationFrameLease {
  isActive: () => boolean;
  schedule: (callback: FrameRequestCallback) => void;
  stop: () => void;
}

export function createAnimationFrameLease(
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (frameId: number) => void,
): AnimationFrameLease {
  let active = true;
  let frameId: number | null = null;

  return {
    isActive: () => active,
    schedule(callback) {
      if (!active) {
        return;
      }
      frameId = requestFrame(callback);
    },
    stop() {
      active = false;
      if (frameId === null) {
        return;
      }
      const ownedFrameId = frameId;
      frameId = null;
      cancelFrame(ownedFrameId);
    },
  };
}
