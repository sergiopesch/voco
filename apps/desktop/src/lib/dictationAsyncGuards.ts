export function isCurrentAudioCaptureSource<T extends object>(
  source: T,
  sourceSessionId: number,
  currentSource: T | null,
  currentSessionId: number,
): boolean {
  return source === currentSource && sourceSessionId === currentSessionId;
}
