import { useEffect, useId, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { dismissCrashRecovery, listCrashRecovery } from "@/lib/crashRecovery";
import type { CrashRecoveryEntry } from "@/lib/crashRecovery";
import { copyDesktopText } from "@/lib/tauri";
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
  const headingId = useId();
  const transcriptRef = useRef<HTMLTextAreaElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);
  // Keep or Discard, whichever is shown; each replaces the other when used.
  const actionRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"document" | "action" | null>(null);
  const selected = entries.find(entry => entry.id === selectedId) ?? entries[0];

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    void listCrashRecovery().then(result => {
      if (alive) setEntries(result);
    }).catch(() => {
      if (alive) setError("Could not load interrupted dictations. Choose Hide to tray, then open Review again.");
    }).finally(() => {
      if (!alive) return;
      focusNext.current = "document";
      setLoading(false);
    });
    return () => { alive = false; mounted.current = false; };
  }, []);

  // Moves focus once the control it targets has rendered, so it never falls to the page.
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === "action" ? actionRef.current : transcriptRef.current ?? emptyRef.current)?.focus();
  });

  // Listens on the window so Escape works before anything in Review has focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!confirmDiscard) {
        onClose();
        return;
      }
      focusNext.current = "action";
      setConfirmDiscard(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDiscard, onClose]);

  // Copy stays enabled while it runs so keyboard focus never falls to the
  // page; `pending` blocks a second copy.
  async function copy() {
    if (!selected || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      // The desktop copy also sets PRIMARY, which terminals paste with Shift+Insert.
      await copyDesktopText(selected.text).catch(() => navigator.clipboard.writeText(selected.text));
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
        focusNext.current = "document";
      }
    } catch {
      if (mounted.current) {
        setError("Could not discard this transcript. It has been kept.");
        focusNext.current = "action";
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function toggleConfirm(open: boolean) {
    focusNext.current = "action";
    setConfirmDiscard(open);
  }

  return <main className="voco-review">
    <header className="voco-review__header" onPointerDown={event => {
      if (event.button === 0 && !(event.target as HTMLElement).closest("button"))
        void getCurrentWindow().startDragging().catch(() => {});
    }}>
      <div className="voco-review__brand"><img src={vocoBrandImage} alt="" /><span>VOCO</span><h1>Review</h1></div>
      <div className="voco-review__actions">
        <Tooltip text="Open settings" align="end"><button className="voco-icon-button" aria-label="Settings" onClick={onOpenSettings}><img src="/icons/settings.svg" className="voco-ui-icon" alt="" /></button></Tooltip>
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
        <section className="voco-review__document" aria-labelledby={headingId}>
          <div className="voco-review__document-heading"><h2 id={headingId}>Interrupted dictation</h2><p>Some words may already be in your text field.</p></div>
          <textarea ref={transcriptRef} aria-label="Recovered transcript" readOnly value={selected.text} spellCheck={false} />
        </section>
      </div>
      <footer className="voco-review__footer">
        <div className="voco-review__feedback">{error ? <p role="alert">{error}</p> : <p role="status">{feedback ?? "Kept until you discard it."}</p>}</div>
        <div className="voco-review__actions">
          {confirmDiscard ? <><span>Discard this transcript?</span><button ref={actionRef} className="voco-button voco-button--ghost" disabled={busy} onClick={() => toggleConfirm(false)}>Keep</button><button className="voco-button voco-button--secondary" disabled={busy} onClick={() => void discard()}>Discard transcript</button></> : <>
            <button ref={actionRef} className="voco-button voco-button--ghost" disabled={busy} onClick={() => toggleConfirm(true)}>Discard</button>
            <button className="voco-button voco-button--primary" onClick={() => void copy()}>Copy transcript</button>
          </>}
        </div>
      </footer>
    </> : <div className="voco-review__empty"><p ref={emptyRef} tabIndex={-1} role={error ? "alert" : "status"}>{error ?? "No interrupted dictation."}</p></div>}
  </main>;
}
