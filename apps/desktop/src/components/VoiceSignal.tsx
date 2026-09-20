import type { CSSProperties } from "react";

/** A level display, not simulated speech. Capture and its lifecycle stay with the owner. */
export function VoiceSignal({ level, active, label = "Microphone signal" }: {
  level: number; active: boolean; label?: string;
}) {
  const value = active && Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  return <span className="voco-voice-signal" data-active={active} role="meter" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
    {[.35, .55, .8, 1, .8, .55, .35].map((weight, index) =>
      <span key={index} aria-hidden="true" style={{ "--signal": .12 + value * weight * .88 } as CSSProperties} />)}
  </span>;
}
