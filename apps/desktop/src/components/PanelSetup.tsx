import { useEffect, useRef, useState } from "react";
import { copyDesktopText, enableGnomePanel, getPanelSetupStatus, openExternalUrl } from "@/lib/tauri";
import type { PanelSetupStatus } from "@/lib/tauri";

// GNOME's own install prompt, as extensions.gnome.org's button opens it, for
// a browser without GNOME's browser integration. The snap can't call it.
export const INSTALL_PANEL_COMMAND = "gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.InstallRemoteExtension voco-panel@sergiopesch.com";

const unavailable: PanelSetupStatus = { status: "unavailable", canEnable: false,
  detail: "Panel status is unavailable. Use the VOCO tray menu for status and Stop." };

/** `note` stands in for the panel's own status line. */
export function PanelSetup({ disabled = false, note = null }: { disabled?: boolean; note?: string | null }) {
  const [status, setStatus] = useState<PanelSetupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
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
  // The button stays enabled while it runs so keyboard focus never falls to
  // the page; `pending` blocks a second check.
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
  async function copyCommand() {
    try {
      await copyDesktopText(INSTALL_PANEL_COMMAND).catch(() => navigator.clipboard.writeText(INSTALL_PANEL_COMMAND));
      if (mounted.current) setCopied("copied");
    } catch { if (mounted.current) setCopied("failed"); }
  }
  return <div className="voco-panel-setup" role="group" aria-label="Panel setup">
    <p role="status">{note ?? status?.detail ?? "Checking your panel…"}</p>
    {status?.url ?
      <button className="voco-button voco-button--secondary" disabled={disabled}
        onClick={() => void openExternalUrl(status.url!).catch(() => {})}>
        Get the VOCO panel
      </button> : null}
    {status && !["active", "other-desktop", "unsupported"].includes(status.status) ?
      <button className="voco-button voco-button--ghost" disabled={disabled}
        onClick={() => void check(status.canEnable)}>
        {busy ? "Checking panel…" : status.canEnable ? "Enable live panel" : "Check panel again"}
      </button> : null}
    {status?.url && status.status !== "optional" ?
      <details className="voco-panel-setup__terminal"><summary>Install without the website</summary>
        <p>If the website asks for GNOME’s browser integration, you can open GNOME’s own install prompt from Terminal instead. Copy this command, paste it into Terminal and press Enter, then choose Install.</p>
        <code>{INSTALL_PANEL_COMMAND}</code>
        <button className="voco-button voco-button--ghost" disabled={disabled} onClick={() => void copyCommand()}>Copy command</button>
        {copied ? <p role="status">{copied === "copied" ? "Command copied." : "Copy failed. Select the command and copy it."}</p> : null}
      </details> : null}
  </div>;
}
