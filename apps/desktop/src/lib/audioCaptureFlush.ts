export const CAPTURE_TAIL_UNCONFIRMED = "The end of this recording could not be confirmed. Retrying can transcribe only the audio received.";
export const CAPTURE_INPUT_INTERRUPTED = "The microphone stopped providing input during this recording. Retrying can transcribe only the audio received before the interruption.";

export class AudioCaptureFlushError extends Error {
  constructor(reason = CAPTURE_TAIL_UNCONFIRMED) {
    super(reason);
    this.name = "AudioCaptureFlushError";
  }
}

/** One request per capture graph; only the worklet acknowledgment proves a flush. */
export function createAudioCaptureFlush(timeoutMs = 80) {
  let settle: (confirmed: boolean, reason?: string) => void = () => {};
  const completion = new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => settle(false), timeoutMs);
    settle = (confirmed, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (confirmed) resolve();
      else reject(new AudioCaptureFlushError(reason));
    };
  });
  return {
    completion,
    acknowledge: () => settle(true),
    cancel: (reason?: string) => settle(false, reason),
  };
}
