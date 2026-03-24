import { useEffect } from "react";
import { useStore } from "@/store/useStore";
import { useDictation } from "@/hooks/useDictation";

export function Overlay() {
  const { status, transcript, interimTranscript, error, clearTranscript, setError } = useStore();
  const { toggle } = useDictation();
  const isRecording = status === "recording";
  const isProcessing = status === "processing";

  const hasResult = transcript && status === "idle";

  // Auto-clear the result after a few seconds
  useEffect(() => {
    if (!hasResult) return;
    const timer = setTimeout(() => {
      clearTranscript();
    }, 4000);
    return () => clearTimeout(timer);
  }, [hasResult, clearTranscript]);

  const dismiss = () => {
    clearTranscript();
    setError(null);
  };

  return (
    <div
      className="h-screen w-screen flex flex-col items-center justify-center select-none"
      data-tauri-drag-region
      style={{ background: "transparent" }}
    >
      <div
        className={`
          flex items-center gap-3 px-4 py-2.5 rounded-2xl
          shadow-lg border backdrop-blur-sm
          transition-all duration-200
          ${isRecording
            ? "bg-red-50/95 border-red-200 shadow-red-100"
            : isProcessing
              ? "bg-yellow-50/95 border-yellow-200 shadow-yellow-100"
              : error
                ? "bg-red-50/95 border-red-200"
                : hasResult
                  ? "bg-green-50/95 border-green-200 shadow-green-100"
                  : "bg-white/95 border-gray-200 shadow-gray-100"
          }
        `}
      >
        {/* Status dot / button */}
        <button
          onClick={toggle}
          disabled={isProcessing}
          className={`
            relative flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
            transition-all duration-150
            ${isRecording
              ? "bg-red-500 hover:bg-red-600"
              : isProcessing
                ? "bg-yellow-500 cursor-wait"
                : "bg-blue-500 hover:bg-blue-600"
            }
          `}
          title={isRecording ? "Stop (or press shortcut)" : "Start (or press shortcut)"}
        >
          {isRecording ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : isProcessing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="animate-spin">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}

          {isRecording && (
            <span className="absolute w-8 h-8 rounded-full animate-ping bg-red-500 opacity-30" />
          )}
        </button>

        {/* Label */}
        <div className="min-w-0 max-w-[200px]">
          {error ? (
            <p className="text-xs text-red-600 truncate">{error}</p>
          ) : isRecording ? (
            <p className="text-xs text-red-700 font-medium">Listening...</p>
          ) : isProcessing ? (
            <p className="text-xs text-yellow-700 font-medium">
              {interimTranscript || "Transcribing..."}
            </p>
          ) : hasResult ? (
            <p className="text-xs text-green-700 truncate">{transcript}</p>
          ) : (
            <p className="text-xs text-gray-500">
              Alt+D to dictate
            </p>
          )}
        </div>

        {/* Dismiss button — clears state, not close app */}
        {(hasResult || error) && (
          <button
            onClick={dismiss}
            className="flex-shrink-0 p-0.5 rounded hover:bg-gray-200/50 text-gray-400 hover:text-gray-600 transition-colors"
            title="Dismiss"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
