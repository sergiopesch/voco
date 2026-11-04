import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import {
  canCancel,
  cancelUpdateInstall,
  formatBytes,
  IDLE_INSTALL,
  INSTALL_STEPS,
  installBusy,
  stepStatuses,
  installUpdate,
  reduceInstall,
  stageHeadline,
  startingInstall,
  updateInstallAvailability,
  type UpdateInstallAvailability,
  type UpdateInstallEvent,
  type UpdateInstallState,
} from "@/lib/updateInstall";
import { StatusMark } from "./StatusMark";
import "./updateInstall.css";

interface UpdateInstallProps {
  /** The newer release the update check found, if it found one. */
  availableVersion: string | null;
  releaseUrl: string | null;
  dictating: boolean;
  onOpenReleasePage: (url: string) => Promise<void>;
}

/**
 * Install update and its window. Rust owns every step; this only shows the
 * stage it reports and asks it to start or cancel.
 */
export function UpdateInstall({ availableVersion, releaseUrl, dictating, onOpenReleasePage }: UpdateInstallProps) {
  const [availability, setAvailability] = useState<UpdateInstallAvailability | null>(null);
  const [state, setState] = useState<UpdateInstallState>(IDLE_INSTALL);
  const headline = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    updateInstallAvailability()
      .then((result) => { if (active) setAvailability(result); })
      .catch(() => { if (active) setAvailability({ available: false }); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let disposed = false;
    void getCurrentWindow()
      .listen<UpdateInstallEvent>("voco:update-install", ({ payload }) => setState((current) => reduceInstall(current, payload)))
      .then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; })
      .catch(() => {});
    return () => { disposed = true; stop?.(); };
  }, []);

  const shown = state.stage !== "idle";
  useEffect(() => {
    if (shown) headline.current?.focus();
  }, [shown]);

  const start = (version: string) => {
    setState(startingInstall(version));
    installUpdate(version).catch((error: unknown) => {
      setState({ ...startingInstall(version), stage: "failed", progress: null, message: String(error) });
    });
  };

  return (
    <UpdateInstallView
      state={state}
      available={availability?.available === true}
      availableVersion={availableVersion}
      releaseUrl={releaseUrl}
      dictating={dictating}
      headlineRef={headline}
      onStart={start}
      onCancel={() => void cancelUpdateInstall()}
      onClose={() => setState(IDLE_INSTALL)}
      onOpenReleasePage={onOpenReleasePage}
    />
  );
}

interface UpdateInstallViewProps {
  state: UpdateInstallState;
  available: boolean;
  availableVersion: string | null;
  releaseUrl: string | null;
  dictating: boolean;
  headlineRef?: React.Ref<HTMLHeadingElement>;
  onStart: (version: string) => void;
  onCancel: () => void;
  onClose: () => void;
  onOpenReleasePage: (url: string) => Promise<void>;
}

/** Presentation only, from the state Rust last reported. */
export function UpdateInstallView({
  state, available, availableVersion, releaseUrl, dictating, headlineRef, onStart, onCancel, onClose, onOpenReleasePage,
}: UpdateInstallViewProps) {
  if (state.stage === "idle") {
    if (!available || !availableVersion) return null;
    return (
      <div className="voco-update-offer">
        <button className="voco-button voco-button--primary" disabled={dictating} onClick={() => onStart(availableVersion)}>
          Install update
        </button>
        <p className="voco-preferences__helper">
          {dictating
            ? "Finish dictating first."
            : "VOCO downloads this release, checks its signature, asks for your password to install it, then restarts."}
        </p>
      </div>
    );
  }

  const busy = installBusy(state);
  const statuses = stepStatuses(state);
  const ended = state.stage === "failed" || state.stage === "cancelled";
  const indeterminate = state.stage === "downloading" && state.progress === null;
  const percent = Math.round((state.progress ?? 0) * 100);

  return (
    <section className="voco-update-window" data-stage={state.stage} aria-labelledby="voco-update-window-title">
      <div className="voco-update-window__glow" aria-hidden="true" />
      <h3 id="voco-update-window-title" ref={headlineRef} tabIndex={-1} role="status" aria-live="polite">
        <StatusMark state={ended ? "attention" : state.stage === "restarting" || state.stage === "installed" ? "success" : "working"} />
        {stageHeadline(state)}
      </h3>

      <ol className="voco-update-steps" aria-label="Update steps">
        {INSTALL_STEPS.map((item, index) => {
          const status = statuses[index];
          return (
            <li key={item.key} className="voco-update-steps__step" data-status={status}>
              <span className="voco-update-steps__dot" aria-hidden="true" />
              <span>{item.label}</span>
              <span className="voco-visually-hidden">{status === "done" ? ", done" : status === "active" ? ", in progress" : ""}</span>
            </li>
          );
        })}
      </ol>

      {state.stage === "starting" || state.stage === "downloading" ? (
        <div className="voco-update-progress">
          <div
            className="voco-update-progress__track"
            role="progressbar"
            aria-label="Download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={indeterminate ? undefined : percent}
            data-indeterminate={indeterminate}
          >
            <span className="voco-update-progress__fill" style={{ transform: `scaleX(${indeterminate ? 1 : state.progress ?? 0})` }} />
          </div>
          <p className="voco-preferences__helper">
            {state.bytes
              ? state.bytes.total ? `${formatBytes(state.bytes.received)} of ${formatBytes(state.bytes.total)}` : formatBytes(state.bytes.received)
              : "Fetching the signed checksums…"}
          </p>
        </div>
      ) : null}

      {state.stage === "authorizing" ? (
        <p className="voco-preferences__helper">Your system asks for an administrator’s password. VOCO never sees it.</p>
      ) : null}

      {ended && state.message ? <p className="voco-update-window__message">{state.message}</p> : null}

      {canCancel(state) || ended ? <div className="voco-preferences__actions">
        {canCancel(state) ? (
          <button className="voco-button voco-button--secondary" onClick={onCancel}>Cancel</button>
        ) : null}
        {ended ? (
          <>
            {state.version && available ? (
              <button className="voco-button voco-button--primary" disabled={dictating} onClick={() => onStart(state.version!)}>Try again</button>
            ) : null}
            {releaseUrl ? (
              <button className="voco-button voco-button--secondary" onClick={() => void onOpenReleasePage(releaseUrl)}>Open release page</button>
            ) : null}
            <button className="voco-button voco-button--secondary" onClick={onClose}>Close</button>
          </>
        ) : null}
      </div> : null}
      {busy && !canCancel(state) ? <p className="voco-preferences__helper">Keep VOCO open until it restarts.</p> : null}
    </section>
  );
}
