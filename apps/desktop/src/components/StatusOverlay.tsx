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

  return (
    <main className="status-overlay">
      <section
        className={shellClassName}
        aria-live="polite"
        aria-label={isRecording ? "Voice is listening" : "Voice is transcribing"}
        style={{ "--voice-level": `${level}` } as CSSProperties}
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
            {LEVEL_PATTERN.map((factor, index) => {
              const barLevel = Math.max(0.18, Math.min(1, level * factor + 0.18));

              return (
                <span
                  // The bar pattern is fixed, so the index is stable here.
                  key={index}
                  className="status-overlay__meter-bar"
                  style={
                    {
                      "--bar-level": `${barLevel}`,
                      animationDelay: `${index * 80}ms`,
                    } as CSSProperties
                  }
                />
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
