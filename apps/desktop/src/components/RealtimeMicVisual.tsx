import { useEffect, useState, type CSSProperties } from "react";
import type { RealtimeStatus } from "@/types";
import vocoBrandImage from "../../../../assets/voco-symbol-ui.png";

interface RealtimeMicVisualProps {
  active: boolean;
  level: number;
  status: RealtimeStatus;
  size?: "compact" | "overlay";
}

const WAVE_BARS = [
  { id: "a", weight: 0.44 },
  { id: "b", weight: 0.72 },
  { id: "c", weight: 1 },
  { id: "d", weight: 0.64 },
  { id: "e", weight: 0.5 },
] as const;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function reducedMotionRequested(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION_QUERY).matches
    : false;
}

export function RealtimeMicVisual({
  active,
  level,
  status,
  size = "compact",
}: RealtimeMicVisualProps) {
  const [reducedMotion, setReducedMotion] = useState(reducedMotionRequested);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const preference = window.matchMedia(REDUCED_MOTION_QUERY);
    const updatePreference = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", updatePreference);
    updatePreference();
    return () => preference.removeEventListener("change", updatePreference);
  }, []);

  // Removing CSS transitions alone still lets audio samples move the graphic.
  // Hold every decorative level-driven property still when motion is reduced.
  const visualLevel = reducedMotion ? 0 : Math.max(0, Math.min(1, level));
  const style = {
    "--voco-realtime-level": visualLevel.toFixed(3),
    "--voco-realtime-image-scale": (1 + visualLevel * 0.16).toFixed(3),
    "--voco-realtime-image-lift": `${(-2 * visualLevel).toFixed(2)}px`,
    "--voco-realtime-inner-scale": (1 + visualLevel * 0.34).toFixed(3),
    "--voco-realtime-outer-scale": (1 + visualLevel * 0.72).toFixed(3),
    "--voco-realtime-ring-opacity": (0.2 + visualLevel * 0.52).toFixed(3),
    "--voco-realtime-inner-opacity": (0.14 + visualLevel * 0.38).toFixed(3),
    "--voco-realtime-glow": `${(10 + visualLevel * 24).toFixed(1)}px`,
  } as CSSProperties;

  return (
    <div
      className="voco-realtime-mic"
      data-active={active}
      data-size={size}
      data-status={status}
      data-reduced-motion={reducedMotion}
      style={style}
      aria-hidden="true"
    >
      <span className="voco-realtime-mic__ring voco-realtime-mic__ring--outer" />
      <span className="voco-realtime-mic__ring voco-realtime-mic__ring--inner" />
      <img className="voco-realtime-mic__image" src={vocoBrandImage} alt="" />
      <span className="voco-realtime-mic__bars">
        {WAVE_BARS.map((bar) => (
          <span
            key={bar.id}
            className="voco-realtime-mic__bar"
            style={
              {
                "--voco-realtime-bar-scale": Math.max(
                  0.16,
                  0.22 + visualLevel * bar.weight,
                ).toFixed(3),
              } as CSSProperties
            }
          />
        ))}
      </span>
    </div>
  );
}
