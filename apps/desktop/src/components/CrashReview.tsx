import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { dismissCrashRecovery, listCrashRecovery } from "@/lib/crashRecovery";
import type { CrashRecoveryEntry } from "@/lib/crashRecovery";
import { Tooltip } from "./Tooltip";
import vocoBrandImage from "../../../../assets/voco-symbol-ui.png";
import "./crashReview.css";

export function CrashReview({ onClose, onOpenSettings }: {
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const [entries, setEntries] = useState<CrashRecoveryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  const selected = entries.find(entry => entry.id === selectedId) ?? entries[0];

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    void listCrashRecovery().then(result => {
      if (alive) setEntries(result);
    }).catch(() => {
      if (alive) setError("Could not open crash recovery. Close this window and try again.");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; mounted.current = false; };
  }, []);

  async function copy() {
    if (!selected || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await navigator.clipboard.writeText(selected.text);
      if (mounted.current) setFeedback("Copied.");
    } catch {
      if (mounted.current) setError("Copy failed. Your text is still available.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function discard() {
    if (!selected || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const id = selected.id;
    try {
      await dismissCrashRecovery(id);
      if (mounted.current) {
        setEntries(current => current.filter(entry => entry.id !== id));
        setSelectedId(null);
        setConfirmDiscard(false);
        setFeedback(null);
      }
    } catch {
      if (mounted.current) setError("Could not discard this transcript. It has been kept.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <main className="voco-review" onKeyDown={event => {
    if (event.key === "Escape") {
      if (confirmDiscard) setConfirmDiscard(false);
      else onClose();
    }
  }}>
    <header className="voco-review__header" onPointerDown={event => {
      if (event.button === 0 && !(event.target as HTMLElement).closest("button"))
        void getCurrentWindow().startDragging().catch(() => {});
    }}>
      <div className="voco-review__brand"><img src={vocoBrandImage} alt="" /><span>VOCO</span><h1>Review</h1></div>
      <div className="voco-review__actions">
        <Tooltip text="Settings" align="end"><button className="voco-icon-button" aria-label="Settings" onClick={onOpenSettings}><img src="/icons/settings.svg" className="voco-ui-icon" alt="" /></button></Tooltip>
        <button className="voco-button voco-button--ghost" onClick={onClose}>Hide to tray</button>
      </div>
    </header>
    {loading ? <p className="voco-review__empty" role="status">Loading…</p> : selected ? <>
      <div className="voco-review__body">
        {entries.length > 1 ? <nav className="voco-review__list" aria-label="Interrupted dictations">
          {entries.map((entry, index) => <button key={entry.id} className="voco-review__item"
            disabled={busy} aria-current={entry.id === selected.id ? "page" : undefined}
            onClick={() => { setSelectedId(entry.id); setFeedback(null); setError(null); setConfirmDiscard(false); }}>
            <strong>Dictation {index + 1}</strong><time dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleString()}</time>
          </button>)}
        </nav> : null}
        <section className="voco-review__document" aria-label="Crash recovery">
          <div className="voco-review__document-heading"><h2>Interrupted dictation</h2><p>Some words may already be in your text field.</p></div>
          <textarea aria-label="Recovered transcript" readOnly value={selected.text} spellCheck={false} />
        </section>
      </div>
      <footer className="voco-review__footer">
        <div className="voco-review__feedback">{error ? <p role="alert">{error}</p> : <p role="status">{feedback ?? "Recovered after an unexpected exit."}</p>}</div>
        <div className="voco-review__actions">
          {confirmDiscard ? <><span>Discard this transcript?</span><button className="voco-button voco-button--ghost" disabled={busy} onClick={() => setConfirmDiscard(false)}>Keep</button><button className="voco-button voco-button--secondary" disabled={busy} onClick={() => void discard()}>Discard transcript</button></> : <>
            <button className="voco-button voco-button--ghost" disabled={busy} onClick={() => setConfirmDiscard(true)}>Discard</button>
            <button className="voco-button voco-button--primary" disabled={busy} onClick={() => void copy()}>Copy transcript</button>
          </>}
        </div>
      </footer>
    </> : <div className="voco-review__empty"><p role={error ? "alert" : "status"}>{error ?? "No interrupted dictation."}</p></div>}
  </main>;
}
