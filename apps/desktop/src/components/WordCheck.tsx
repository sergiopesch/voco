import type { ReactNode } from "react";
import { RecordingVoiceSignal } from "./VoiceSignal";
import { SettingsIcon } from "./SettingsIcon";
import { StatusMark } from "./StatusMark";
import type { WordCheckState } from "@/hooks/useWordCheck";
import { judgeCheck, termWords, type CheckOutcome, type Teaching } from "@/lib/myWords";
import type { HeardVersion } from "@/types";

/** The check's outcome for its entry, once VOCO has heard it. */
export function checkOutcome(state: WordCheckState, words: readonly string[], heard: readonly HeardVersion[]): CheckOutcome | null {
  if (state.phase !== "heard") return null;
  const index = words.indexOf(state.entry);
  if (index === -1) return null;
  return judgeCheck(state.transcript, words, heard, index, word => state.everyday.has(word));
}

interface SayItButtonProps {
  state: WordCheckState;
  /** The entry this button checks. */
  entry: string;
  /** Another check, a save or setup is busy. */
  disabled: boolean;
  compact?: boolean;
  onSay: () => void;
  onDone: () => void;
}

/** Keeps keyboard focus on an entry's Say it when the button that had it goes. */
export function focusSayIt(entry: string) {
  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`button[data-say-it="${CSS.escape(entry)}"]`)?.focus());
}

/** Say it, then Done while VOCO listens, with the live level beside it. */
export function SayItButton({ state, entry, disabled, compact = false, onSay, onDone }: SayItButtonProps) {
  const mine = "entry" in state && state.entry === entry;
  const listening = mine && state.phase === "listening";
  const busy = mine && (state.phase === "starting" || state.phase === "finishing");
  const again = mine && state.phase !== "starting" && state.phase !== "listening" && state.phase !== "finishing";
  const label = listening ? "Done" : busy ? state.phase === "starting" ? "Getting ready…" : "Checking…" : again ? "Say it again" : "Say it";
  return <span className="voco-voice-control voco-say-it" data-recording={listening} data-compact={compact}>
    {/* The check's own button never disables, so it keeps keyboard focus from Say it to Done. */}
    <button type="button" className="voco-button voco-button--secondary voco-voice-pill" data-say-it={entry}
      disabled={!mine && disabled} aria-disabled={busy || (mine && !listening && disabled) || undefined}
      aria-label={listening ? `Done saying ${entry}` : `${again ? "Say it again" : "Say it"}: ${entry}`}
      onClick={listening ? onDone : busy || (mine && disabled) ? undefined : onSay}>
      <SettingsIcon name="microphone" /><span>{label}</span>
    </button>
    <span className="voco-voice-pill__reveal"><RecordingVoiceSignal active={listening} /></span>
  </span>;
}

interface CheckResultProps {
  state: WordCheckState;
  entry: string;
  words: readonly string[];
  heard: readonly HeardVersion[];
  saving: boolean;
  /** Setup adds that My words stays in Settings for later. */
  inSetup?: boolean;
  /** A save's error, shown under the result. */
  error?: string | null;
  onTeach: (teaching: Teaching) => void;
  onSayAgain: () => void;
}

/** What VOCO heard, said plainly, with the one next step it suggests. */
export function CheckResult({ state, entry, words, heard, saving, inSetup = false, error, onTeach, onSayAgain: sayAgain }: CheckResultProps) {
  if (!("entry" in state) || state.entry !== entry) return null;
  // Try again records at once; focus follows to the Say it that ends it.
  const onSayAgain = () => { sayAgain(); focusSayIt(entry); };
  const outcome = checkOutcome(state, words, heard);
  const later = inSetup ? " You can always come back and personalise VOCO in Settings." : "";
  let mark: "listening" | "working" | "success" | "attention" | "idle" = "idle";
  // Only a check that couldn't finish is a problem; what VOCO heard is a note.
  let problem = false;
  let title: ReactNode;
  let detail: ReactNode = null;
  let actions: ReactNode = null;
  const again = <button type="button" className="voco-button voco-button--ghost voco-button--compact" disabled={saving} onClick={onSayAgain}>Try again</button>;
  switch (state.phase) {
    case "starting":
      mark = "working"; title = "Getting the microphone ready…"; break;
    case "listening":
      mark = "listening"; title = <>Say “{entry}”.</>; detail = "VOCO stops listening when you do."; break;
    case "finishing":
      mark = "working"; title = "Checking what VOCO heard…"; break;
    case "failed":
      mark = "attention"; problem = true; title = "The check couldn’t finish."; detail = <>{state.message}{later}</>; break;
    case "taught":
      mark = "success";
      title = <>VOCO learned “{state.teaching.heard}”.</>;
      detail = <>It writes “{state.teaching.writes}” whenever it hears that. Say it again to check.</>;
      break;
    case "heard":
      if (!outcome) return null;
      switch (outcome.kind) {
        case "right":
          mark = "success"; title = <>VOCO writes “{entry}”.</>; break;
        case "nothing":
          mark = "attention"; title = "VOCO didn’t hear anything.";
          detail = <>Check your microphone, then say it again.{later}</>; break;
        case "unclear":
          mark = "attention"; title = <>VOCO heard “{outcome.heard}”.</>;
          detail = outcome.pause ? <>Say “{entry}” again, without stopping between its words.</> : <>Say just “{entry}”, on its own.</>; break;
        case "partial":
          mark = "attention"; title = <>VOCO heard only “{outcome.heard}”.</>;
          detail = <>Say all of “{entry}”.</>; break;
        case "taken":
          mark = "attention"; title = <>VOCO heard “{outcome.heard}”.</>;
          detail = <>That already writes “{outcome.other}”, so VOCO can’t learn it for “{entry}”. Try saying it again.</>; break;
        case "full":
          mark = "attention"; title = <>VOCO heard “{outcome.heard}”.</>;
          detail = <>It already knows five versions of “{entry}”. Forget one in Settings to teach another.</>; break;
        case "teach": {
          const { teaching } = outcome;
          mark = "attention";
          title = <>VOCO heard <Heard text={outcome.heard} part={teaching.heard} />.</>;
          const teach = (anyway: boolean) => <button type="button"
            className={`voco-button voco-button--compact ${anyway ? "voco-button--ghost" : "voco-button--primary"}`}
            disabled={saving} onClick={() => onTeach(teaching)}>{anyway ? "Teach anyway" : "Teach VOCO"}</button>;
          if (teaching.everyday) {
            detail = <>“{teaching.heard}” {termWords(teaching.heard).length > 1 ? "are everyday words" : "is an everyday word"},
              so VOCO would write “{teaching.writes}” every time you say {termWords(teaching.heard).length > 1 ? "them" : "it"}. Try saying it again, a little slower.</>;
            actions = <><button type="button" className="voco-button voco-button--primary voco-button--compact" disabled={saving} onClick={onSayAgain}>Try again</button>{teach(true)}</>;
          } else {
            detail = <>Teach VOCO, and it writes “{teaching.writes}” whenever it hears “{teaching.heard}”.</>;
            actions = <>{teach(false)}{again}</>;
          }
          break;
        }
      }
      break;
    default:
      return null;
  }
  return <div className="voco-word-check" data-mark={mark} data-problem={problem}>
    {/* What VOCO heard and what it means are read out together; the buttons aren't. */}
    <div role="status">
      <p className="voco-word-check__title"><StatusMark state={mark} /><span>{title}</span></p>
      {detail ? <p className="voco-word-check__detail">{detail}</p> : null}
    </div>
    {error ? <p className="voco-inline-note voco-inline-note--error" role="alert">{error}</p> : null}
    {actions ? <div className="voco-word-check__actions">{actions}</div> : null}
  </div>;
}

/** What VOCO heard, in quotes, with the part it would learn marked. */
function Heard({ text, part }: { text: string; part: string }) {
  const at = part === text ? -1 : text.indexOf(part);
  if (at === -1) return <>“{text}”</>;
  return <>“{text.slice(0, at)}<mark>{part}</mark>{text.slice(at + part.length)}”</>;
}

/** The versions an entry was taught, each with a way to forget it. */
export function TaughtVersions({ versions, entry, disabled, onForget }: {
  versions: readonly HeardVersion[]; entry: string; disabled: boolean; onForget: (version: HeardVersion) => void;
}) {
  if (!versions.length) return null;
  return <div className="voco-taught" role="group" aria-label={`Versions VOCO learned for ${entry}`}>
    <span className="voco-taught__label">Heard as</span>
    {versions.map(version => <span key={version.heard} className="voco-taught__version">
      <span>{version.heard}{version.writes !== entry ? <span className="voco-taught__writes"> → {version.writes}</span> : null}</span>
      <button type="button" className="voco-taught__forget" disabled={disabled}
        aria-label={`Forget “${version.heard}”`} title="Forget this version" onClick={() => onForget(version)}>×</button>
    </span>)}
  </div>;
}
