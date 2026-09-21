import { useEffect, useRef, useState } from "react";
import { enableGnomePanel, getPanelSetupStatus } from "@/lib/tauri";
import type { PanelSetupStatus } from "@/lib/tauri";

const unavailable: PanelSetupStatus = { status: "unavailable", canEnable: false,
  detail: "Panel status is unavailable. Use the VOCO tray menu for status and Stop." };

export function PanelSetup({ disabled = false }: { disabled?: boolean }) {
  const [status, setStatus] = useState<PanelSetupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    void getPanelSetupStatus().then(value => {
      if (alive) setStatus(value);
    }).catch(() => { if (alive) setStatus(unavailable); });
    return () => { alive = false; mounted.current = false; };
  }, []);
  async function check(enable: boolean) {
    if (disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const value = await (enable ? enableGnomePanel() : getPanelSetupStatus());
      if (mounted.current) setStatus(value);
    } catch { if (mounted.current) setStatus(unavailable); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className="voco-panel-setup" aria-label="Tray setup">
    <p role="status">{status?.detail ?? "Checking your panel…"}</p>
    {status && !["active", "other-desktop", "unsupported"].includes(status.status) ?
      <button className="voco-button voco-button--ghost" disabled={disabled || busy}
        onClick={() => void check(status.canEnable)}>
        {busy ? "Checking panel…" : status.canEnable ? "Enable live panel" : "Check panel again"}
      </button> : null}
  </div>;
}
