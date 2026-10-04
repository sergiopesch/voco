export function shouldApplyConfigSnapshot(
  currentRevision: number,
  nextRevision: number,
): boolean {
  return Number.isSafeInteger(nextRevision) && nextRevision >= currentRevision;
}
