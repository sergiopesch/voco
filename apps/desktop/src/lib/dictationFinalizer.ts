import { reconcileFinalCursorText } from "@/lib/liveCommitPolicy";

export type LiveFinalCursorAction =
  | { status: "no-live-text"; appendText: "" }
  | { status: "already-final"; appendText: "" }
  | { status: "append-final-suffix"; appendText: string }
  | { status: "keep-live-text"; appendText: "" };

export function planLiveFinalCursorAction(
  committedLiveText: string,
  finalText: string,
): LiveFinalCursorAction {
  if (committedLiveText.length === 0) {
    return { status: "no-live-text", appendText: "" };
  }

  const reconciliation = reconcileFinalCursorText(committedLiveText, finalText);
  if (reconciliation.status === "unsafe") {
    return { status: "keep-live-text", appendText: "" };
  }

  if (reconciliation.appendText.length === 0) {
    return { status: "already-final", appendText: "" };
  }

  return {
    status: "append-final-suffix",
    appendText: reconciliation.appendText,
  };
}
