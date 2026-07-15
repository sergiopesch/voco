import { useState } from "react";
import vocoBrandImage from "../../../../assets/voco-logo.png";

interface ConfigRecoveryPanelProps {
  error: string;
  onRetry: () => Promise<void>;
  onOpenDirectory: () => Promise<void>;
  onReset: () => Promise<void>;
}

export function ConfigRecoveryPanel({
  error,
  onRetry,
  onOpenDirectory,
  onReset,
}: ConfigRecoveryPanelProps) {
  const [busyAction, setBusyAction] = useState<"retry" | "open" | "reset" | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  async function runAction(
    action: "retry" | "open" | "reset",
    operation: () => Promise<void>,
  ) {
    setBusyAction(action);
    setActionError(null);
    try {
      await operation();
    } catch (actionFailure) {
      setActionError(
        actionFailure instanceof Error ? actionFailure.message : String(actionFailure),
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="voco-panel voco-config-recovery" data-surface="settings">
      <section className="voco-panel__shell">
        <header className="voco-panel__hero">
          <div className="voco-panel__brand">
            <span className="voco-panel__brand-mark" aria-hidden="true">
              <img
                className="voco-panel__brand-mark-image"
                src={vocoBrandImage}
                alt=""
              />
            </span>
            <div>
              <p className="voco-panel__eyebrow">Safe recovery</p>
              <h1 className="voco-panel__title">VOCO settings need attention</h1>
            </div>
          </div>
          <span className="voco-config-recovery__badge">Dictation paused</span>
        </header>

        <div className="voco-config-recovery__content">
          <div>
            <p className="voco-config-recovery__lead">
              VOCO could not safely load its local settings, so it has paused dictation
              instead of guessing or overwriting your file.
            </p>
            <p className="voco-config-recovery__detail" role="alert">
              {error}
            </p>
          </div>

          <div className="voco-config-recovery__steps">
            <h2>Choose a recovery path</h2>
            <p>
              If you edited the file, correct it in the VOCO config directory and retry.
              Resetting creates clean defaults and preserves the previous entry as a
              timestamped recovery backup in that directory.
            </p>
          </div>

          {confirmReset ? (
            <div className="voco-config-recovery__confirmation" role="alert">
              <strong>Reset local settings?</strong>
              <span>
                Your hotkey and preferences return to defaults. The current config entry is
                preserved for manual recovery.
              </span>
            </div>
          ) : null}

          {actionError ? (
            <p className="voco-panel__error" role="alert">
              Recovery action failed: {actionError}
            </p>
          ) : null}

          <div className="voco-config-recovery__actions">
            <button
              type="button"
              className="voco-button voco-button--primary"
              disabled={busyAction !== null}
              onClick={() => void runAction("retry", onRetry)}
            >
              {busyAction === "retry" ? "Checking…" : "Retry loading settings"}
            </button>
            <button
              type="button"
              className="voco-button voco-button--secondary"
              disabled={busyAction !== null}
              onClick={() => void runAction("open", onOpenDirectory)}
            >
              {busyAction === "open" ? "Opening…" : "Open config directory"}
            </button>
            <button
              type="button"
              className="voco-button voco-button--ghost"
              disabled={busyAction !== null}
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true);
                  setActionError(null);
                  return;
                }
                void runAction("reset", onReset);
              }}
            >
              {busyAction === "reset"
                ? "Resetting…"
                : confirmReset
                  ? "Confirm reset"
                  : "Reset to defaults"}
            </button>
            {confirmReset ? (
              <button
                type="button"
                className="voco-button voco-button--ghost"
                disabled={busyAction !== null}
                onClick={() => setConfirmReset(false)}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
