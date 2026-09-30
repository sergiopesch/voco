import { DeviceSelect } from "./DeviceSelect";
import { StatusMark } from "./StatusMark";
import { useEffect, useRef } from "react";
import type { NativeMicrophoneControls } from "@/hooks/useNativeCaptureSettings";

export function NativeMicrophoneSettings({ controls, disabled, showError = true, onSelected }: {
  controls: NativeMicrophoneControls;
  disabled: boolean;
  showError?: boolean;
  onSelected?: () => void;
}) {
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const defaultToken = controls.sources?.defaultSelectionToken ?? null;

  async function select(value: string) {
    const token = value === "system-default" ? defaultToken : value;
    if (disabled || controls.busy || pending.current || !token ||
        !controls.sources?.sources.some(source => source.selectionToken === token && source.objectSerial)) return;
    pending.current = true;
    try {
      if (await controls.select(token) && mounted.current) onSelected?.();
    } finally { pending.current = false; }
  }

  if (controls.mode === "pending") {
    return <div className="voco-inline-note" role="status">
      <p>{controls.error ? showError ? controls.error : "Choose Retry capture setup to check microphone access." : "Checking the capture backend…"}</p>
      <button type="button" className="voco-button voco-button--secondary" disabled={controls.busy || disabled}
        onClick={() => { void controls.initialize().catch(() => {}); }}>Retry capture setup</button>
    </div>;
  }
  return <div className="voco-native-microphone">
    <div className="voco-field">
      <span>Microphone</span>
      <DeviceSelect label="Microphone" value={controls.selected?.selectionToken ?? ""} disabled={disabled || controls.busy}
        onChange={value => void select(value)}
        options={[
          { value: "", label: "Choose a microphone", disabled: true },
          ...(defaultToken ? [{ value: "system-default", label: "System default (current device)", disabled: !controls.sources?.sources.some(source => source.selectionToken === defaultToken && source.objectSerial) }] : []),
          ...(controls.sources?.sources.map(source => ({ value: source.selectionToken,
            label: `${source.label || source.name}${source.isMonitor ? " (output monitor)" : ""}${!source.objectSerial ? " — identity unavailable" : ""}`,
            disabled: !source.objectSerial })) ?? []),
        ]} />
    </div>
    <div className="voco-settings__actions">
      <button type="button" className="voco-button voco-button--secondary" disabled={disabled || controls.busy}
        onClick={() => void controls.refresh()}>Refresh devices</button>
    </div>
    {controls.selected ? <p className="voco-motion-feedback" role="status"><StatusMark state="success" />Selected: {controls.selected.label || controls.selected.name}.</p> : null}
    <details className="voco-preferences__disclosure"><summary>Microphone access details</summary><p>Selecting a microphone allows access for this app session. VOCO records through your system’s sound server, outside the browser permission prompt. Access lasts until VOCO closes or the device identity changes.</p><p>No audio is captured by this setup panel. If the microphone changes or disconnects during dictation, VOCO stops and notifies you.</p>
    </details>
    {showError && controls.error ? <div role="alert" className="voco-inline-note voco-inline-note--error">{controls.error}</div> : null}
  </div>;
}
