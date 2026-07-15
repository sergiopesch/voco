export function shouldApplyConfigSnapshot(
  currentRevision: number,
  nextRevision: number,
): boolean {
  return Number.isSafeInteger(nextRevision) && nextRevision >= currentRevision;
}

export function shouldBlockRuntimeForConfigErrors(
  startupConfigError: string | null,
  settingsSaveError: string | null,
): boolean {
  if (startupConfigError !== null) {
    return true;
  }
  if (settingsSaveError !== null) {
    return false;
  }
  return false;
}
