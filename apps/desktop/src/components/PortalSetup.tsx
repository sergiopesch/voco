import { useEffect, useRef, useState } from "react";
import { allowPortalShortcut, allowPortalTyping, getPortalSetupStatus } from "@/lib/tauri";
import type { PortalSetupStatus } from "@/lib/tauri";
import { StatusMark } from "./StatusMark";

/** "Super+X" from GNOME's trigger description, such as "Press <Super>x". */
export function triggerLabel(trigger: string | null | undefined, fallback: string): string {
  const description = trigger?.replace(/^Press\s+/i, "").trim();
  if (!description) return fallback;
  const modifiers = [...description.matchAll(/<([^>]+)>/g)].map(([, name = ""]) => {
    const lower = name.toLowerCase();
    return lower === "control" || lower === "primary" ? "Ctrl" : lower === "super" ? "Super" : name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  });
  const key = description.replace(/<[^>]+>/g, "").trim();
  if (!key) return fallback;
  return [...modifiers, key.length === 1 ? key.toUpperCase() : key].join("+");
}

type Asking = "typing" | "shortcut" | null;

/**
 * The snap's desktop step on GNOME Wayland (AGENTS.md, Onboarding): GNOME's
 * permission to type, then its shortcut, each asked from the person's click,
 * with what GNOME will show said first. Nothing outside VOCO and GNOME.
 */
export function PortalSetup({ hotkey, disabled = false, changeHint = "You can change it in VOCO’s Settings, under Shortcut.", onChanged, onStatus }: {
  hotkey: string;
  disabled?: boolean;
  /** Where to change a shortcut GNOME holds: Settings' Shortcut page, which
   * has the editor under this, says so itself. */
  changeHint?: string;
  /** After GNOME answered: setup checks its desktop input again. */
  onChanged?: (status: PortalSetupStatus) => void;
  /** Every status it shows, so Settings can tell GNOME holds the shortcut. */
  onStatus?: (status: PortalSetupStatus) => void;
}) {
  const [status, setStatus] = useState<PortalSetupStatus | null>(null);
  const [asking, setAsking] = useState<Asking>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void getPortalSetupStatus().then(value => { if (mounted.current) { setStatus(value); onStatus?.(value); } }).catch(() => {});
    return () => { mounted.current = false; };
  }, []);
  // The button keeps focus while GNOME's dialog is open; `pending` blocks a
  // second request.
  async function ask(what: Exclude<Asking, null>) {
    if (disabled || pending.current) return;
    pending.current = true;
    setAsking(what);
    setProblem(null);
    try {
      const value = await (what === "typing" ? allowPortalTyping() : allowPortalShortcut());
      if (!mounted.current) return;
      setStatus(value);
      onStatus?.(value);
      onChanged?.(value);
    } catch (error) {
      if (mounted.current) setProblem(typeof error === "string" ? error : error instanceof Error ? error.message : "GNOME didn't answer. Try again.");
    } finally {
      pending.current = false;
      if (mounted.current) setAsking(null);
    }
  }
  if (!status) return <div className="voco-portal-setup" role="group" aria-label="Typing and shortcut"><p role="status">Checking GNOME’s permissions…</p></div>;
  if (!status.applies) return null;
  if (status.panelAttached && status.panelHoldsShortcut) {
    return <div className="voco-portal-setup" role="group" aria-label="Typing and shortcut">
      <p className="voco-portal-setup__done" role="status"><StatusMark state="success" /><span>The VOCO panel types for VOCO and holds <strong>{hotkey}</strong>.</span></p>
    </div>;
  }
  const shortcut = triggerLabel(status.shortcutTrigger, hotkey);
  // An attached panel types; one before version 23 can't hold Super+X, so
  // GNOME's shortcut step still shows.
  const typing = status.panelAttached || status.typingAllowed;
  return <div className="voco-portal-setup" role="group" aria-label="Typing and shortcut">
    {status.panelAttached ? <p className="voco-portal-setup__done" role="status"><StatusMark state="success" /><span>The VOCO panel types for VOCO.</span></p>
      : status.typingAllowed ? <p className="voco-portal-setup__done" role="status"><StatusMark state="success" /><span>VOCO can type into your apps. While you dictate, GNOME shows an orange icon in the top bar; choosing Stop there ends the dictation.</span></p>
      : <div className="voco-portal-setup__step">
        <p>VOCO types your words into the app you’re using, through GNOME. GNOME asks you once: turn on <strong>Allow Remote Interaction</strong>, then choose <strong>Share</strong>.</p>
        <button className="voco-button voco-button--secondary" disabled={disabled} onClick={() => void ask("typing")}>
          {asking === "typing" ? "Waiting for GNOME…" : "Allow typing"}</button>
        {asking === "typing" ? <p role="status">GNOME’s dialog is open. Turn on Allow Remote Interaction, then choose Share.</p> : null}
      </div>}
    {typing ? status.shortcutBound ? <p className="voco-portal-setup__done" role="status"><StatusMark state="success" /><span><strong>{shortcut}</strong> starts and stops dictation.{changeHint ? ` ${changeHint}` : ""}</span></p>
      : status.shortcutPortal ? <div className="voco-portal-setup__step">
        <p>GNOME can keep <strong>{hotkey}</strong> for VOCO, so the app you’re typing in never receives it. GNOME asks you once: choose <strong>Add</strong>.</p>
        <button className="voco-button voco-button--secondary" disabled={disabled} onClick={() => void ask("shortcut")}>
          {asking === "shortcut" ? "Waiting for GNOME…" : `Add ${hotkey}`}</button>
        {asking === "shortcut" ? <p role="status">GNOME’s dialog is open. Choose Add.</p> : null}
      </div>
      : status.shortcutCustom ? <div className="voco-portal-setup__step">
        <p>VOCO can add <strong>{hotkey}</strong> to GNOME’s keyboard shortcuts, so the app you’re typing in never receives it.</p>
        <button className="voco-button voco-button--secondary" disabled={disabled} onClick={() => void ask("shortcut")}>
          {asking === "shortcut" ? "Adding…" : `Add ${hotkey}`}</button>
      </div>
      : <div className="voco-portal-setup__step">
        <p>To start and stop dictation with <strong>{hotkey}</strong>, open GNOME Settings, then Keyboard, then View and Customize Shortcuts, then Custom Shortcuts. Add a shortcut named VOCO with the command <code>voco --toggle</code> and the shortcut {hotkey}.</p>
      </div> : null}
    {problem ? <p className="voco-portal-setup__problem" role="alert">{problem}</p> : null}
  </div>;
}
