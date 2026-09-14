/** Capture liveness is independent of signal loudness: silence is valid audio. */
export interface CaptureHealthOptions {
  stream: Pick<MediaStream, "getAudioTracks">;
  onInterrupted: (reason: string) => void;
  onDurationLimit: () => void;
  now?: () => number;
  maximumDurationMs?: number;
  sampleTimeoutMs?: number;
  muteTimeoutMs?: number;
}

export function monitorCaptureHealth({
  stream,
  onInterrupted,
  onDurationLimit,
  now = () => performance.now(),
  maximumDurationMs = 600_000,
  sampleTimeoutMs = 5_000,
  muteTimeoutMs = 3_000,
}: CaptureHealthOptions): { samplesReceived: () => void; dispose: () => void } {
  const startedAt = now();
  let lastSampleAt = startedAt;
  let disposed = false;
  const tracks = stream.getAudioTracks();
  const mutedSince = new Map<MediaStreamTrack, number>();
  const listeners: Array<() => void> = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timer !== null) clearInterval(timer);
    for (const remove of listeners) remove();
    mutedSince.clear();
  }

  function interrupt(reason: string) {
    if (disposed) return;
    dispose();
    onInterrupted(reason);
  }

  for (const track of tracks) {
    if (track.muted) mutedSince.set(track, startedAt);
    const ended = () => interrupt("The microphone disconnected or stopped capturing audio.");
    const mute = () => mutedSince.set(track, now());
    const unmute = () => mutedSince.delete(track);
    track.addEventListener("ended", ended);
    track.addEventListener("mute", mute);
    track.addEventListener("unmute", unmute);
    listeners.push(() => {
      track.removeEventListener("ended", ended);
      track.removeEventListener("mute", mute);
      track.removeEventListener("unmute", unmute);
    });
  }

  timer = setInterval(() => {
    if (disposed) return;
    const current = now();
    if (tracks.length === 0 || tracks.some((track) => track.readyState === "ended")) {
      interrupt("The microphone disconnected or stopped capturing audio.");
    } else if ([...mutedSince.values()].some((since) => current - since >= muteTimeoutMs)) {
      interrupt("The microphone stopped providing audio while muted by the system.");
    } else if (current - lastSampleAt >= sampleTimeoutMs) {
      interrupt("Audio capture stopped responding. The recording captured so far is available to recover.");
    } else if (current - startedAt >= maximumDurationMs) {
      dispose();
      onDurationLimit();
    }
  }, 250);

  return {
    samplesReceived() { if (!disposed) lastSampleAt = now(); },
    dispose,
  };
}
