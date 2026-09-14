/** Orders advisory enumeration independently of explicit access attempts. */
export class MicrophoneRefresh {
  private refresh = 0;
  private retry = 0;
  private alive = true;
  activate() { this.alive = true; }
  dispose() { this.alive = false; this.refresh++; this.retry++; }
  invalidateRetry() { this.retry++; }
  beginRefresh() {
    const id = ++this.refresh;
    return () => this.alive && id === this.refresh;
  }
  beginRetry() {
    const id = ++this.retry;
    this.refresh++; // An older advisory query cannot overwrite this access attempt.
    return () => this.alive && id === this.retry;
  }
}

export async function queryMicrophonePermission(): Promise<PermissionState | null> {
  try {
    return (await navigator.permissions?.query?.({ name: "microphone" as PermissionName }))?.state ?? null;
  } catch {
    return null;
  }
}

export function microphoneAccessFailure(error: unknown): { denied: boolean; message: string } {
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  const detail = error instanceof Error ? error.message : String(error);
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return { denied: true, message: `Microphone access is blocked. ${detail}` };
  }
  const prefix = name === "NotFoundError" ? "No microphone found." :
    name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError" ? "Microphone constraints could not be satisfied." :
    name === "NotReadableError" || name === "TrackStartError" ? "Microphone could not be read; it may be busy." : "Microphone access failed.";
  return { denied: false, message: `${prefix} ${detail}` };
}
