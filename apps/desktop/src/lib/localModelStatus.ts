export function formatLocalModelTestStatus(
  endpoint: string,
  result: { ok: boolean; detail: string },
): string {
  if (result.ok) {
    return `Connected to ${endpoint}.`;
  }

  return `Could not reach ${endpoint}: ${result.detail}`;
}
