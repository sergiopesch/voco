import { StatusMark } from "./StatusMark";
import { VoiceSignal } from "./VoiceSignal";
import { SettingsIcon } from "./SettingsIcon";
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
  onChangeMicrophone?: () => void;
  onStart: () => void;
  onStop: () => void;
  onFinish: () => Promise<void>;
}

export function Onboarding({ microphone, status, audioLevel, transcript, passed,
  failed, preparing, saving, blocked, hotkey, onChangeMicrophone, onStart, onStop, onFinish, attempted, setupError, onRetrySetup, desktopSetupError, checkingDesktopSetup, onCheckDesktopSetup, onOpenDesktopSetupGuide }: OnboardingProps) {
  const recording = status === "recording";
  const busy = checkingDesktopSetup || preparing || status === "starting" || status === "processing" || saving;
  const level = recording ? Math.max(0, Math.min(1, audioLevel)) : 0;

  return <section className="voco-panel__content voco-setup" aria-label="Voice setup">
    <div className="voco-setup__intro">
      <h2>Say something. See it here.</h2>
    </div>
    <div className="voco-setup__devices">
      <div><span className="voco-setup__device-label">Microphone</span><strong>{microphone}</strong></div>
      {onChangeMicrophone ? <button className="voco-button voco-button--ghost" disabled={recording || busy} onClick={onChangeMicrophone}>Change microphone</button> : null}
    </div>
    {setupError ? <p role="alert">{setupError} {onRetrySetup ? <button className="voco-button voco-button--ghost" disabled={busy || recording} onClick={onRetrySetup}>Retry microphone setup</button> : null}</p> : null}
    {desktopSetupError ? <div role="alert"><p><strong>Desktop setup needs attention.</strong> {desktopSetupError}</p>
      <p>You can test your voice here, but dictation in other apps is not ready. Complete the desktop input setup in the installation guide, then check again.</p>
      <button className="voco-button voco-button--secondary" disabled={busy || recording} onClick={onCheckDesktopSetup}>Check desktop setup</button>
      {onOpenDesktopSetupGuide ? <button className="voco-button voco-button--ghost" onClick={onOpenDesktopSetupGuide}>Open setup instructions</button> : null}
    </div> : null}
    <p className="voco-setup__status" role="status"><StatusMark state={setupError || desktopSetupError || failed || status === "error" ? "attention" : busy ? "working" : recording ? "listening" : passed ? "success" : "idle"} /><span>{checkingDesktopSetup ? "Checking desktop input…"
      : preparing || status === "starting" ? "Getting your microphone ready…"
      : recording && failed ? "Finish the test, then try again."
      : recording ? "Listening…"
      : status === "processing" ? "Finishing your test…"
      : passed && desktopSetupError ? "Voice test complete. Desktop setup needs attention."
      : passed ? "Voice test complete. Choose Done to check desktop setup."
      : status === "error" ? "The test could not finish."
      : attempted ? "No speech was recognized. Try again and speak for a few seconds."
      : "Ready when you are."}</span></p>
    <div className="voco-setup__transcript" role="region" aria-label="Test transcript" tabIndex={0}>
      {transcript && transcript !== "(no speech detected)" ? transcript : <span>Your words will appear here…</span>}
    </div>
    <p className="voco-setup__privacy">{!passed && !recording ? "Start test turns on your microphone. " : ""}Speech stays on this computer; this test only displays words here.</p>
    <div className="voco-setup__actions">
      {passed && !recording ? <>
        <button className="voco-button voco-button--primary" disabled={busy || blocked || failed || Boolean(desktopSetupError)} onClick={() => void onFinish()}>Done</button>
        <button className="voco-button voco-button--ghost" disabled={busy || blocked} onClick={onStart}>Test again</button>
      </> : <div className="voco-voice-control" data-recording={recording}>
        <button className="voco-button voco-button--primary voco-voice-pill" disabled={recording ? busy : busy || blocked}
          onClick={recording ? onStop : onStart}><SettingsIcon name="microphone" /><span>{recording ? "Finish test" : attempted || status === "error" ? "Test again" : "Start test"}</span></button>
        <span className="voco-voice-pill__reveal"><VoiceSignal level={level} active={recording} /></span>
      </div>}
    </div>
    {passed && !recording ? <p className="voco-setup__next">Next, click in a text field and press <kbd>{hotkey}</kbd> to dictate.</p> : null}
  </section>;
}
