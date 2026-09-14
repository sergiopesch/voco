import type { AudioDeviceOption, ShortcutDiagnostics } from "@/types";

export function unknownShortcut(hotkey: string): ShortcutDiagnostics {
  return { hotkey, route: null, state: "unknown", detail: "Shortcut availability has not been verified." };
}

export function shortcutPresentation(hotkey: string, observation?: ShortcutDiagnostics | null) {
  const current = observation && observation.hotkey === hotkey ? observation : unknownShortcut(hotkey);
  const available = current.state === "available" && current.route !== null;
  return {
    available,
    instruction: available
      ? current.route === "ibus"
        ? `Focus a supported text field and press ${hotkey} to record and copy.`
        : `Press ${hotkey} to record and copy.`
      : `Shortcut configured: ${hotkey}. Start dictation from the tray.`,
    detail: current.detail,
    setup: current.state === "focus-required"
      ? "Focus a text field with VOCO Dictation selected as your input source."
      : !available
        ? "For IBus recording shortcuts, add VOCO Dictation in your desktop Input Sources settings, select it, then focus a text field. VOCO never switches your input source automatically."
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
