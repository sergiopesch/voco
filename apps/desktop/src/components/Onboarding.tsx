import { StatusMark } from "./StatusMark";
import { VoiceSignal } from "./VoiceSignal";
import { SettingsIcon } from "./SettingsIcon";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DictationStatus } from "@/types";

interface OnboardingProps {
  microphone: string;
  status: DictationStatus;
  audioLevel: number;
  transcript: string;
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
  microphoneControls?: ReactNode;
  desktopReady?: boolean;
  onStart: () => void;
  onStop: () => void;
  onFinish: () => Promise<void>;
}

export function Onboarding({ microphone, status, audioLevel, transcript, passed,
  failed, preparing, saving, blocked, hotkey, microphoneControls, desktopReady = false,
  onStart, onStop, onFinish, attempted, setupError, onRetrySetup, desktopSetupError,
  checkingDesktopSetup, onCheckDesktopSetup, onOpenDesktopSetupGuide }: OnboardingProps) {
  const [changingMicrophone, setChangingMicrophone] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const previousPhase = useRef("");
  const recording = status === "recording";
  const busy = Boolean(checkingDesktopSetup || preparing || status === "starting" || status === "processing" || saving);
  const ready = passed && desktopReady && !failed && !setupError && !recording && !busy;
  const phase = ready ? "ready" : busy ? "working" : recording ? "listening" : desktopSetupError ? "desktop" : "test";
  useEffect(() => {
    if (previousPhase.current && previousPhase.current !== phase && !busy) primaryRef.current?.focus();
    previousPhase.current = phase;
  }, [phase, busy]);
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
    <div className="voco-setup__intro"><h2>{ready ? "Your voice, ready." : "Say something. See it here."}</h2></div>
    {!ready ? <div className="voco-setup__devices">
      <div><span className="voco-setup__device-label">Microphone</span><strong>{microphone}</strong></div>
      {microphoneControls ? <button className="voco-button voco-button--ghost" disabled={recording || busy}
        aria-expanded={changingMicrophone} aria-controls="voco-setup-microphone"
        onClick={() => setChangingMicrophone(value => !value)}>{changingMicrophone ? "Back to test" : "Change microphone"}</button> : null}
    </div> : null}
    {changingMicrophone && !ready ? <div id="voco-setup-microphone" className="voco-setup__microphone">{microphoneControls}</div> : null}
    <div className="voco-setup__status" role={problem || desktopSetupError ? "alert" : "status"}>
      <StatusMark state={state} /><span>{statusText}</span>
    </div>
    {desktopSetupError ? <details className="voco-setup__details"><summary>Details</summary><p>{desktopSetupError}</p></details> : null}
    {desktopSetupError && onOpenDesktopSetupGuide ? <button className="voco-button voco-button--ghost" onClick={onOpenDesktopSetupGuide}>Open setup instructions</button> : null}
    <div className="voco-setup__transcript" role="region" aria-label="Test transcript" tabIndex={0}>
      {transcript && transcript !== "(no speech detected)" ? transcript : <span>Try saying “This is my voice, typed.”</span>}
    </div>
    {ready ? <div className="voco-setup__handoff">
      <p>Click in a text field and press <kbd className="voco-glass voco-shortcut">{hotkey}</kbd>. Press again to finish.</p>
      <p>VOCO stays in your tray.</p>
    </div> : <p className="voco-setup__privacy">{!passed && !recording && !busy ? "Start test turns on your microphone. " : ""}Speech stays on this computer; this test only displays words here.</p>}
    <div className="voco-setup__actions">
      {passed && !recording ? <>
        <button ref={primaryRef} className="voco-button voco-button--primary" disabled={busy || blocked || failed || Boolean(setupError)}
          onClick={ready ? () => void onFinish() : onCheckDesktopSetup}>{saving ? "Saving…" : checkingDesktopSetup ? "Checking setup…" : ready ? "Done" : "Check desktop setup"}</button>
        <button className="voco-button voco-button--ghost" disabled={busy || blocked} onClick={onStart}>Test again</button>
      </> : <div className="voco-voice-control" data-recording={recording}>
        <button ref={primaryRef} className="voco-button voco-button--primary voco-voice-pill" disabled={recording ? busy : busy || blocked}
          onClick={recording ? onStop : problem && onRetrySetup ? onRetrySetup : onStart}><SettingsIcon name="microphone" /><span>{status === "processing" ? "Finishing…" : busy ? "Preparing…" : recording ? "Finish test" : problem && onRetrySetup ? "Retry microphone setup" : attempted || problem ? "Test again" : "Start test"}</span></button>
        <span className="voco-voice-pill__reveal"><VoiceSignal level={recording ? audioLevel : 0} active={recording} /></span>
      </div>}
    </div>
  </section>;
}
