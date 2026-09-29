import type { AudioDeviceOption, DesktopInputStatus, ShortcutDiagnostics } from "@/types";

const ANY_APP = "To dictate into any app, start dictation from the tray or assign voco --toggle to a shortcut in your desktop settings.";

export function unknownShortcut(hotkey: string): ShortcutDiagnostics {
  return { hotkey, route: null, state: "unknown", detail: "Shortcut availability has not been verified." };
}

export function shortcutPresentation(hotkey: string, observation?: ShortcutDiagnostics | null, desktopInput?: DesktopInputStatus | null) {
  const current = observation && observation.hotkey === hotkey ? observation : unknownShortcut(hotkey);
  const available = current.state === "available" && current.route !== null;
  return {
    available,
    instruction: desktopInput?.available === false
      ? `Desktop setup needed. ${desktopInput.detail}`
      : available
      ? `Press ${hotkey} to dictate at your cursor.`
      : `Shortcut configured: ${hotkey}. Start dictation from the tray.`,
    detail: current.detail,
    // Text is pasted into the focused app whichever route starts dictation.
    setup: current.state === "focus-required"
      ? `The optional VOCO Dictation input source handles this shortcut only in supported text fields. ${ANY_APP}`
      : !available
        ? ANY_APP
        : null,
  };
}

export function microphoneLabel(
  mode: "pending" | "native" | "webkit" | undefined,
  selected: { label: string; name: string } | null | undefined,
  deviceId: string | null,
  devices: AudioDeviceOption[],
): string {
  if (mode === "pending") return "Checking microphone setup";
  if (mode === "native") return selected ? selected.label || selected.name : "No native microphone selected";
  return devices.find((device) => device.deviceId === deviceId)?.label ?? "System default";
}

/** Invalidates outstanding observations without changing shortcut authority. */
export class DiagnosticsRequestGate {
  private generation = 0;
  private alive = true;

  activate() { this.alive = true; }
  invalidate() { this.generation += 1; }
  dispose() { this.alive = false; this.invalidate(); }
  begin() {
    const generation = ++this.generation;
    return () => this.alive && generation === this.generation;
  }
}

/**
 * Runs the launch diagnostics check. If it leaves diagnostics unloaded (timeout,
 * failure or a stale result), setup is reported conservatively and the check is
 * retried exactly once, unless a later refresh loads diagnostics first.
 * Returns a disposer that cancels the pending retry.
 */
export function startLaunchDiagnostics(
  refresh: () => Promise<void>,
  loaded: () => boolean,
  onFailed: () => void,
  retryDelayMs = 2000,
): () => void {
  let disposed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const attempt = async (retryOnFailure: boolean) => {
    await refresh();
    if (disposed || loaded()) return;
    onFailed();
    if (retryOnFailure) {
      retry = setTimeout(() => {
        if (!loaded()) void attempt(false);
      }, retryDelayMs);
    }
  };
  void attempt(true);
  return () => {
    disposed = true;
    if (retry !== undefined) clearTimeout(retry);
  };
}
