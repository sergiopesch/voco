import type { CSSProperties } from "react";
import { useStore } from "@/store/useStore";

const LEVEL_PATTERN = [0.48, 0.7, 1, 0.72, 0.52];

export function StatusOverlay() {
  const status = useStore((state) => state.status);
  const audioLevel = useStore((state) => state.audioLevel);

  if (status !== "recording" && status !== "processing") {
    return null;
  }

  const isRecording = status === "recording";
  const level = Math.max(isRecording ? audioLevel : 0.38, 0.12);
  const shellClassName = [
    "status-overlay__card",
    isRecording
      ? "status-overlay__card--recording"
      : "status-overlay__card--processing",
  ].join(" ");
  const meterBars = LEVEL_PATTERN.map((factor, index) => {
    if (isRecording) {
      const barLevel = Math.max(
        0.12,
        Math.min(1, 0.08 + level * (0.62 + factor * 0.92)),
      );

      return {
        key: index,
        level: barLevel,
        opacity: 0.42 + barLevel * 0.58,
      };
    }

    return {
      key: index,
      level: 0.3 + factor * 0.46,
      opacity: 0.68,
      animationDelay: `${index * 80}ms`,
    };
  });

  return (
    <main className="status-overlay">
      <section
        className={shellClassName}
        aria-live="polite"
        aria-label={isRecording ? "VOCO is listening" : "VOCO is processing"}
        style={{ "--voco-level": `${level}` } as CSSProperties}
      >
        <div className="status-overlay__orb" aria-hidden="true">
          <div className="status-overlay__orb-core">
            {isRecording ? (
              <span className="status-overlay__record-dot" />
            ) : (
              <span className="status-overlay__spinner" />
            )}
          </div>
        </div>

        <div className="status-overlay__content">
          <p className="status-overlay__eyebrow">
            {isRecording ? "Microphone live" : "Speech captured"}
          </p>
          <h1 className="status-overlay__title">
            {isRecording ? "Listening" : "Transcribing"}
          </h1>
          <p className="status-overlay__hint">
            {isRecording
              ? "Press Alt+D again when you are done."
              : "Text will appear at your cursor in a moment."}
          </p>

          <div className="status-overlay__meter" aria-hidden="true">
            {meterBars.map((bar) => (
              <span
                // The bar pattern is fixed, so the index is stable here.
                key={bar.key}
                className="status-overlay__meter-bar"
                style={
                  {
                    "--bar-level": `${bar.level}`,
                    opacity: `${bar.opacity}`,
                    animationDelay: bar.animationDelay,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
