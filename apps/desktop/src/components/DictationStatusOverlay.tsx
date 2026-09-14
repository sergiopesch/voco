import type { CursorDeliveryState, DictationStatus } from "@/types";

export function DictationStatusOverlay({
  status,
  interimTranscript,
  transcript,
  audioLevel,
  cursorDeliveryState,
  captureNotice,
  canCancel,
  cancellationPending,
  onCancel,
}: {
  status: DictationStatus;
  interimTranscript: string;
  transcript: string;
  audioLevel: number;
  cursorDeliveryState: CursorDeliveryState;
  captureNotice: string | null;
  canCancel: boolean;
  cancellationPending: boolean;
  onCancel: () => void;
}) {
  const trimmedInterim = interimTranscript.trim();
  const hasLiveText =
    status === "recording" &&
    trimmedInterim !== "" &&
    trimmedInterim !== "Listening...";
  const previewOnly =
    cursorDeliveryState === "preview-only" ||
    cursorDeliveryState === "unreconciled";
  const headline = status === "starting" ? "Starting microphone" : previewOnly
    ? "Preview only"
    : status === "recording"
      ? "Streaming words"
      : "Transcribing";
  const copy =
    trimmedInterim ||
    (status === "processing" && transcript
      ? transcript
      : previewOnly
        ? "Cursor delivery is unavailable. Your transcript will remain in VOCO so you can copy it safely."
        : "Speak normally. Live words will appear here before VOCO inserts the final text.");
  const meterLevel = status === "starting" ? 0 : status === "recording" ? audioLevel : 1;

  return (
    <main
      className="voco-overlay voco-overlay--dictation"
      data-state={status}
      data-live-preview={hasLiveText ? "true" : "false"}
      data-cursor-delivery={cursorDeliveryState}
      aria-live="polite"
    >
      <span className="voco-overlay__eyebrow">
        {status === "starting" ? "Wait for Listening before speaking" : previewOnly
          ? "Cursor unavailable — safe preview"
          : hasLiveText
          ? "Live transcript preview"
          : status === "recording"
            ? "Listening for speech"
            : "Local Processing"}
      </span>
      <div className="voco-overlay__heading-row">
        <strong className="voco-overlay__headline">{headline}</strong>
        <button className="voco-realtime-overlay__button" type="button" onClick={onCancel} disabled={!canCancel}>
          {cancellationPending ? "Cancelling…" : "Cancel"}
        </button>
      </div>
      <p className={hasLiveText ? "voco-overlay__transcript" : "voco-overlay__copy"}>
        {captureNotice || copy}
      </p>
      <div className="voco-overlay__meter" aria-hidden="true">
        <div
          className="voco-overlay__meter-fill"
          style={{ transform: `scaleX(${meterLevel})` }}
        />
      </div>
    </main>
  );
}
