import type { CanonicalCursorSession } from "@/lib/canonicalCursorSession";

export interface CanonicalTargetOperationIdentity {
  dictationSessionId: number;
  canonicalSessionId: number;
  ownedSessionId: number;
}

export interface CurrentCanonicalTargetIdentity {
  dictationSessionId: number;
  canonicalSession: CanonicalCursorSession | null;
  ownedSessionId: number | null;
  ownedSessionActive: boolean;
}

export function isCurrentCanonicalTargetOperation(
  operation: CanonicalTargetOperationIdentity,
  current: CurrentCanonicalTargetIdentity,
): boolean {
  return (
    current.dictationSessionId === operation.dictationSessionId &&
    current.canonicalSession?.sessionId === operation.canonicalSessionId &&
    current.ownedSessionId === operation.ownedSessionId &&
    current.ownedSessionActive
  );
}

export function isCurrentAudioCaptureSource<T extends object>(
  source: T,
  sourceSessionId: number,
  currentSource: T | null,
  currentSessionId: number,
): boolean {
  return source === currentSource && sourceSessionId === currentSessionId;
}
