import { StatusMark } from "./StatusMark";
import { RecordingVoiceSignal } from "./VoiceSignal";
import { SettingsIcon } from "./SettingsIcon";
import { PanelSetup } from "./PanelSetup";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DictationStatus, EnglishSpelling } from "@/types";
import { useStore } from "@/store/useStore";
import { ENGLISH_VARIETIES } from "@/lib/englishSpelling";

interface OnboardingProps {
  microphone: string;
  status: DictationStatus;
  passed: boolean;
  failed: boolean;
  attempted: boolean;
  setupError?: string | null;
  desktopSetupError?: string | null;
  checkingDesktopSetup?: boolean;
  onCheckDesktopSetup?: () => void;
  onOpenDesktopSetupGuide?: () => void;
  onRetrySetup?: () => void;
  preparing: boolean;
  saving: boolean;
  blocked: boolean;
  hotkey: string;
  microphoneControls?: (onSelected: () => void) => ReactNode;
  desktopReady?: boolean;
  onStart: () => void;
  onStop: () => void;
  onFinish: () => Promise<void>;
  /** The test's suggested sentence shows this spelling. */
  spelling?: EnglishSpelling;
  /** After the spelling question, focus moves straight to Start test. */
  focusPrimary?: boolean;
  /** Setup's words step is behind; the passed test then hands off with Done. */
  wordsDone?: boolean;
  /** Whether the person said a word in that step and left words listed; if
   * not, Done reminds them where My words is. */
  wordsChecked?: boolean;
  /** Leaves the passed voice test for the words step. */
  onContinue?: () => void;
}

export function Onboarding({ microphone, status, passed,
  failed, preparing, saving, blocked, hotkey, microphoneControls, desktopReady = false,
  onStart, onStop, onFinish, attempted, setupError, onRetrySetup, desktopSetupError,
  checkingDesktopSetup, onCheckDesktopSetup, onOpenDesktopSetupGuide, spelling = "british", focusPrimary = false,
  wordsDone = true, wordsChecked = true, onContinue }: OnboardingProps) {
  // Only this view shows recognition text, so only it re-renders per hypothesis.
  const transcript = useStore((state) => state.dictationPurpose === "onboarding" ? state.transcript : "");
  const [changingMicrophone, setChangingMicrophone] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const previousPhase = useRef("");
  const recording = status === "recording";
  const busy = Boolean(checkingDesktopSetup || preparing || status === "starting" || status === "processing" || saving);
  const tested = passed && !failed && !setupError && !recording && !busy;
  const ready = tested && desktopReady;
  // A passed test moves on to the words step whatever desktop setup needs; the
  // last screen checks it before Done hands off.
  const toWords = tested && !wordsDone;
  const handoff = ready && wordsDone;
  // The test's own words and controls, until the words step is behind.
  const testing = !wordsDone || !passed;
  const choosing = changingMicrophone && !ready && !toWords;
  const phase = choosing ? "microphone" : handoff ? "ready" : toWords ? "passed" : busy ? "working" : recording ? "listening" : desktopSetupError ? "desktop" : "test";
  useEffect(() => {
    if (previousPhase.current && previousPhase.current !== phase && !busy) primaryRef.current?.focus();
    previousPhase.current = phase;
  }, [phase, busy]);
  const initialFocus = useRef(focusPrimary);
  useEffect(() => { if (initialFocus.current) primaryRef.current?.focus(); }, []);
  const suggestion = spelling === "as-recognised" ? "This is my voice, typed." : ENGLISH_VARIETIES[spelling].prompt;
  const problem = setupError || (failed || status === "error" ? "The voice test couldn't finish. Try again." : null);
  const statusText = checkingDesktopSetup ? "Checking desktop setup…"
    : preparing || status === "starting" ? "Getting ready…"
    : recording ? problem ? "Finish the test, then try again." : "Listening…"
    : status === "processing" ? "Finishing your test…"
    : problem ? problem
    : desktopSetupError ? passed ? "Your voice test worked. Desktop setup needs one more step." : "Desktop setup needs one more step."
    : passed ? "Voice test complete."
    : attempted ? "No speech detected. Try speaking a little closer."
    : "Ready when you are.";
  const state = problem || desktopSetupError ? "attention" : busy ? "working" : recording ? "listening" : passed ? "success" : "idle";

  return <section className="voco-panel__content voco-setup" aria-label="Voice setup" data-phase={phase}>
    <div className="voco-setup__intro"><h2>{choosing ? "Choose your microphone." : handoff ? "Your voice, ready." : toWords ? "VOCO heard you."
      : wordsDone && passed ? "One more step." : "Say something. See it here."}</h2></div>
    {!ready && !toWords && !wordsDone ? <div className="voco-setup__devices">
      <div><span className="voco-setup__device-label">Microphone</span><strong>{microphone}</strong></div>
      {microphoneControls ? <button className="voco-button voco-button--ghost" disabled={recording || busy}
        aria-expanded={changingMicrophone} aria-controls="voco-setup-microphone"
        onClick={() => setChangingMicrophone(value => !value)}>{changingMicrophone ? "Back to test" : "Change microphone"}</button> : null}
    </div> : null}
    {choosing ? <div id="voco-setup-microphone" className="voco-setup__microphone">{microphoneControls?.(() => setChangingMicrophone(false))}</div> : <>
    <div className="voco-setup__status" role={problem || desktopSetupError ? "alert" : "status"}>
      <StatusMark state={state} /><span>{statusText}</span>
    </div>
    {desktopSetupError ? <details className="voco-setup__details"><summary>Details</summary><p>{desktopSetupError}</p></details> : null}
    {desktopSetupError && onOpenDesktopSetupGuide ? <button className="voco-button voco-button--ghost" onClick={onOpenDesktopSetupGuide}>Open setup instructions</button> : null}
    {testing ? <div className="voco-setup__transcript" role="region" aria-label="Test transcript" tabIndex={0}>
      {transcript && transcript !== "(no speech detected)" ? transcript : <span>Try saying “{suggestion}”</span>}
    </div> : null}
    {handoff ? <div className="voco-setup__handoff">
      <p>Click where you want the text and press <kbd className="voco-glass voco-shortcut">{hotkey}</kbd>. Press again to finish.</p>
      <p>VOCO stays in your tray. You can reopen it from your app launcher.</p>
      <PanelSetup disabled={busy || blocked} />
      {!wordsChecked ? <p className="voco-setup__later">You can always come back and personalise VOCO in Settings, under My words.</p> : null}
    </div> : testing ? <p className="voco-setup__privacy">{!passed && !recording && !busy ? "Start test turns on your microphone. " : ""}Speech stays on this computer; this test only displays words here.</p> : null}
    <div className="voco-setup__actions">
      {passed && !recording ? <>
        <button ref={primaryRef} className="voco-button voco-button--primary" disabled={busy || blocked || failed || Boolean(setupError)}
          onClick={handoff ? () => void onFinish() : toWords ? onContinue : onCheckDesktopSetup}>
          {saving ? "Saving…" : checkingDesktopSetup ? "Checking setup…" : handoff ? "Done" : toWords ? "Continue" : "Check desktop setup"}</button>
        {!wordsDone ? <button className="voco-button voco-button--ghost" disabled={busy || blocked} onClick={onStart}>Test again</button> : null}
      </> : <div className="voco-voice-control" data-recording={recording}>
        <button ref={primaryRef} className="voco-button voco-button--primary voco-voice-pill" disabled={recording ? busy : busy || blocked}
          onClick={recording ? onStop : problem && onRetrySetup ? onRetrySetup : onStart}><SettingsIcon name="microphone" /><span>{status === "processing" ? "Finishing…" : busy ? "Preparing…" : recording ? "Finish test" : problem && onRetrySetup ? "Retry microphone setup" : attempted || problem ? "Test again" : "Start test"}</span></button>
        <span className="voco-voice-pill__reveal"><RecordingVoiceSignal active={recording} /></span>
      </div>}
    </div>
    </>}
  </section>;
}
