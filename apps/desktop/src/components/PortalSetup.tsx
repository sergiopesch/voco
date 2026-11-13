import { useEffect, useRef, useState } from "react";
import { allowPortalTyping, chooseGnomeShortcut, getPortalSetupStatus, holdGnomeShortcut } from "@/lib/tauri";
import type { PortalSetupStatus } from "@/lib/tauri";
import { StatusMark } from "./StatusMark";

type Asking = "typing" | "shortcut" | null;

/** The shortcuts VOCO offers by name, in the tray's order. */
const PRESETS = ["Super+X", "Alt+D", "Alt+Shift+D"];

/** Whether GNOME holds the saved shortcut for VOCO, through its keyboard
 * shortcuts or the panel. Setup's Done waits for it. */
export function shortcutReady(status: PortalSetupStatus): boolean {
  return status.shortcutBound || (status.panelAttached && status.panelHoldsShortcut);
}

/**
 * The snap's desktop step on GNOME Wayland (AGENTS.md, Onboarding): GNOME's
 * permission to type, asked from the person's click with what GNOME will show
 * said first, then the shortcut, which VOCO adds to GNOME's keyboard shortcuts
 * by itself. Nothing outside VOCO and GNOME.
 */
export function PortalSetup({ hotkey, disabled = false, changeHint = "You can change it in VOCO’s Settings, under Shortcut.", addShortcut = false, typingOnly = false, onChanged, onStatus, onShortcutRefused }: {
  hotkey: string;
  disabled?: boolean;
  /** Where to change the shortcut: Settings' Shortcut page, which has the
   * editor under this, says so itself. */
  changeHint?: string;
  /** Setup adds the shortcut without being asked, and offers VOCO's other
   * shortcuts when GNOME can't hold this one. Settings offers a button,
   * since the person may have removed it in GNOME Settings, and has its
   * editor for other keys. */
  addShortcut?: boolean;
  /** Setup's typing step, before the voice test: the shortcut comes on its
   * last screen. */
  typingOnly?: boolean;
  /** After GNOME answered: setup checks its desktop input again. */
  onChanged?: (status: PortalSetupStatus) => void;
  /** Every status it shows, and null when GNOME's setup couldn't be read. */
  onStatus?: (status: PortalSetupStatus | null) => void;
  /** GNOME's keyboard shortcuts refused the saved keys, or took them after
   * all: setup then offers to finish without a shortcut. */
  onShortcutRefused?: (refused: boolean) => void;
}) {
  const [status, setStatus] = useState<PortalSetupStatus | null>(null);
  const [unread, setUnread] = useState(false);
  const [asking, setAsking] = useState<Asking>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  // Setup's own add ran for these keys; a failure then waits for the person.
  const added = useRef<string | null>(null);
  function show(value: PortalSetupStatus) {
    setStatus(value);
    onStatus?.(value);
  }
  function refuse(reason: string | null, what: Asking) {
    setProblem(reason);
    if (what === "shortcut") onShortcutRefused?.(reason !== null);
  }
  useEffect(() => {
    mounted.current = true;
    void getPortalSetupStatus().then(value => { if (mounted.current) show(value); })
      .catch(() => { if (mounted.current) { setUnread(true); onStatus?.(null); } });
    return () => { mounted.current = false; };
  }, []);
  // The button keeps focus while GNOME's dialog is open; `pending` blocks a
  // second request.
  async function ask(what: Exclude<Asking, null>) {
    if (disabled || pending.current) return;
    pending.current = true;
    setAsking(what);
    refuse(null, what);
    try {
      const value = await (what === "typing" ? allowPortalTyping() : holdGnomeShortcut());
      if (!mounted.current) return;
      show(value);
      onChanged?.(value);
    } catch (error) {
      if (mounted.current) refuse(reason(error, "GNOME didn't answer. Try again."), what);
    } finally {
      pending.current = false;
      if (mounted.current) setAsking(null);
    }
  }
  function reason(error: unknown, fallback: string) {
    return typeof error === "string" ? error : error instanceof Error ? error.message : fallback;
  }
  async function choose(other: string) {
    if (disabled || pending.current) return;
    pending.current = true;
    setAsking("shortcut");
    refuse(null, "shortcut");
    try {
      const value = await chooseGnomeShortcut(other);
      if (!mounted.current) return;
      show(value);
      onChanged?.(value);
    } catch (error) {
      if (mounted.current) refuse(reason(error, "VOCO couldn't save that shortcut. Try again."), "shortcut");
    } finally {
      pending.current = false;
      if (mounted.current) setAsking(null);
    }
  }
  // An attached panel types, whatever GNOME's own permission says.
  const typing = Boolean(status && (status.panelAttached || status.typingAllowed));
  const missing = Boolean(!typingOnly && status?.applies && typing && status.shortcutAvailable && !shortcutReady(status));
  // GNOME's keyboard shortcuts ask nobody, so setup adds VOCO's as soon as
  // VOCO can type, once for each set of keys.
  useEffect(() => {
    if (!addShortcut || !missing || disabled || added.current === hotkey) return;
    added.current = hotkey;
    void ask("shortcut");
  }, [addShortcut, missing, disabled, hotkey]);

  if (unread) return null;
  if (!status) return <div className="voco-portal-setup" role="group" aria-label="Typing and shortcut"><p role="status">Checking GNOME’s permissions…</p></div>;
  if (!status.applies) return null;
  if (status.panelAttached && status.panelHoldsShortcut && !typingOnly) {
    return <div className="voco-portal-setup" role="group" aria-label="Typing and shortcut">
      <p className="voco-portal-setup__done" role="status"><StatusMark state="success" /><span>The VOCO panel types for VOCO and holds <strong>{hotkey}</strong>.</span></p>
    </div>;
  }
  const adding = asking === "shortcut";
  return <div className="voco-portal-setup" role="group" aria-label="Typing and shortcut">
    {status.panelAttached ? <p className="voco-portal-setup__done" role="status"><StatusMark state="success" /><span>The VOCO panel types for VOCO.</span></p>
      : status.typingAllowed ? <p className="voco-portal-setup__done" role="status"><StatusMark state="success" /><span>VOCO can type into your apps. While you dictate, GNOME shows an orange icon in the top bar; choosing Stop there ends the dictation.</span></p>
      : <div className="voco-portal-setup__step">
        <p>VOCO types your words into the app you’re using, through GNOME. GNOME asks you once: turn on <strong>Allow Remote Interaction</strong>, then choose <strong>Share</strong>.</p>
        <button className="voco-button voco-button--secondary" disabled={disabled} onClick={() => void ask("typing")}>
          {asking === "typing" ? "Waiting for GNOME…" : "Allow typing"}</button>
        {asking === "typing" ? <p role="status">GNOME’s dialog is open. Turn on Allow Remote Interaction, then choose Share.</p> : null}
      </div>}
    {!typing || typingOnly ? null : status.shortcutBound ? <p className="voco-portal-setup__done" role="status"><StatusMark state="success" /><span><strong>{hotkey}</strong> starts and stops dictation.{changeHint ? ` ${changeHint}` : ""}</span></p>
      : !status.shortcutAvailable ? <div className="voco-portal-setup__step">
        <p>To start and stop dictation with <strong>{hotkey}</strong>, open GNOME Settings, then Keyboard, then View and Customize Shortcuts, then Custom Shortcuts. Add a shortcut named VOCO with the command <code>voco --toggle</code> and the shortcut {hotkey}.</p>
      </div>
      : addShortcut && !problem ? <p role="status">Adding <strong>{hotkey}</strong> to GNOME’s keyboard shortcuts…</p>
      : <div className="voco-portal-setup__step">
        {problem ? <p className="voco-portal-setup__problem" role="alert">{problem}</p>
          : <p><strong>{hotkey}</strong> isn’t in GNOME’s keyboard shortcuts, so it doesn’t reach VOCO. VOCO can add it, and the app you’re typing in then never receives it.</p>}
        <button className="voco-button voco-button--secondary" disabled={disabled || adding} onClick={() => void ask("shortcut")}>
          {adding ? "Adding…" : problem ? `Try ${hotkey} again` : `Add ${hotkey}`}</button>
        {problem && addShortcut ? PRESETS.filter(preset => preset !== hotkey).map(preset =>
          <button key={preset} className="voco-button voco-button--ghost" disabled={disabled || adding} onClick={() => void choose(preset)}>Use {preset}</button>) : null}
      </div>}
    {problem && !typing ? <p className="voco-portal-setup__problem" role="alert">{problem}</p> : null}
  </div>;
}
