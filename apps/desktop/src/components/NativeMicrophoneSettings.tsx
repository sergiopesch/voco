import { DeviceSelect } from "./DeviceSelect";
import { StatusMark } from "./StatusMark";
import { useEffect, useState } from "react";
import type { NativeMicrophoneControls } from "@/hooks/useNativeCaptureSettings";

export function NativeMicrophoneSettings({ controls, disabled }: {
  controls: NativeMicrophoneControls;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    setDraft(controls.selected?.selectionToken ?? "");
    setAcknowledged(false);
  }, [controls.selected?.selectionToken, controls.sources?.revision]);
  const defaultToken = controls.sources?.defaultSelectionToken ?? null;
  const token = draft === "system-default" ? defaultToken : draft;
  const sourceSupported = controls.sources?.sources.some((source) => source.selectionToken === token && source.objectSerial);
  const allowed = Boolean(token && sourceSupported && acknowledged && !disabled && !controls.busy);

  if (controls.mode === "pending") {
    return <div className="voco-inline-note" role="status">
      <p>{controls.error ?? "Checking the capture backend…"}</p>
      <button type="button" className="voco-button voco-button--secondary" disabled={controls.busy || disabled}
        onClick={() => { void controls.initialize().catch(() => {}); }}>Retry capture setup</button>
    </div>;
  }
  return <div className="voco-native-microphone">
    <p><strong>Microphone access</strong></p>
    <p>VOCO will use your Linux audio server directly, outside the browser microphone permission prompt.
      Choose a microphone and allow access for this app session. Recording starts only from your dictation controls.</p>
    <div className="voco-field">
      <span>Native input device</span>
      <DeviceSelect label="Native input device" value={draft} disabled={disabled || controls.busy}
        onChange={value => { setDraft(value); setAcknowledged(false); }}
        options={[
          { value: "", label: "Choose a microphone" },
          ...(defaultToken ? [{ value: "system-default", label: "System default (current device)", disabled: !controls.sources?.sources.some(source => source.selectionToken === defaultToken && source.objectSerial) }] : []),
          ...(controls.sources?.sources.map(source => ({ value: source.selectionToken,
            label: `${source.label || source.name}${source.isMonitor ? " (output monitor)" : ""}${!source.objectSerial ? " — identity unavailable" : ""}`,
            disabled: !source.objectSerial })) ?? []),
        ]} />
    </div>
    <label className="voco-toggle">
      <input type="checkbox" checked={acknowledged} disabled={disabled || controls.busy || !token}
        onChange={(event) => setAcknowledged(event.target.checked)} />
      <span>Allow native microphone access for this app session</span>
    </label>
    <div className="voco-settings__actions">
      <button type="button" className="voco-button voco-button--primary" disabled={!allowed}
        onClick={() => { if (allowed && token) void controls.select(token); }}>Use this microphone</button>
      <button type="button" className="voco-button voco-button--secondary" disabled={disabled || controls.busy}
        onClick={() => void controls.refresh()}>Refresh native devices</button>
    </div>
    {controls.selected ? <p className="voco-motion-feedback" role="status"><StatusMark state="success" />Ready for dictation: {controls.selected.label || controls.selected.name}.
      This choice lasts until VOCO closes or its device identity changes.</p> : null}
    <p>No audio is captured by this setup panel. Use Stop or Cancel during dictation.
      If the source changes or disconnects, VOCO stops and retains received audio for review.</p>
    <p>Microphone identity is verified through PipeWire.</p>
    {controls.error ? <div role="alert" className="voco-inline-note voco-inline-note--error">{controls.error}</div> : null}
  </div>;
}
