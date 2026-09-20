import { useState } from "react";
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
  onRetrySetup?: () => void;
  preparing: boolean;
  saving: boolean;
  blocked: boolean;
  hotkey: string;
  onStart: () => void;
  onStop: () => void;
  onFinish: () => Promise<void>;
}

export function Onboarding({ microphone, status, audioLevel, transcript, passed,
  failed, preparing, saving, blocked, hotkey, onStart, onStop, onFinish, attempted, setupError, onRetrySetup }: OnboardingProps) {
  const [speakerError, setSpeakerError] = useState<string | null>(null);
  const [speakerPlaying, setSpeakerPlaying] = useState(false);
  const recording = status === "recording";
  const busy = preparing || status === "starting" || status === "processing" || saving;
  const level = recording ? Math.max(0, Math.min(1, audioLevel)) : 0;

  async function testSpeaker() {
    if (speakerPlaying) return;
    setSpeakerPlaying(true);
    setSpeakerError(null);
    let context: AudioContext | null = null;
    try {
      context = new AudioContext();
      await context.resume();
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.frequency.value = 440;
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(0.08, context.currentTime + 0.02);
      gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.25);
      tone.connect(gain).connect(context.destination);
      const ended = new Promise<void>(resolve => { tone.onended = () => resolve(); });
      tone.start();
      tone.stop(context.currentTime + 0.3);
      await ended;
    } catch {
      setSpeakerError("Could not play the test sound. Check your system sound output.");
    } finally {
      await context?.close().catch(() => {});
      setSpeakerPlaying(false);
    }
  }

  return <section className="voco-panel__content voco-setup" aria-label="Voice setup">
    <div className="voco-setup__intro">
      <span className="voco-setup__eyebrow">LET’S TRY YOUR VOICE</span>
      <h2>Say something. See it here.</h2>
      <p>Your system microphone and speaker are selected. Start a short test to check your voice before you dictate in other apps.</p>
    </div>
    <div className="voco-setup__devices">
      <div><span className="voco-setup__device-label">Microphone</span><strong>{microphone}</strong></div>
      <div><span className="voco-setup__device-label">Speaker</span><strong>System default</strong>
        <button className="voco-button voco-button--ghost" disabled={recording || busy || speakerPlaying}
          onClick={() => void testSpeaker()}>{speakerPlaying ? "Playing…" : "Test speaker"}</button>
      </div>
    </div>
    {setupError ? <p role="alert">{setupError} {onRetrySetup ? <button className="voco-button voco-button--ghost" disabled={busy || recording} onClick={onRetrySetup}>Retry microphone setup</button> : null}</p> : null}
    {speakerError ? <p role="alert">{speakerError}</p> : null}
    <div className="voco-setup__meter" role="meter" aria-label="Microphone signal"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      <div className="voco-setup__signal" aria-hidden="true" style={{ transform: `scaleX(${level})` }} />
      <span className="voco-setup__meter-center" aria-hidden="true" />
    </div>
    <p className="voco-setup__status" role="status">{preparing || status === "starting" ? "Getting your microphone ready…"
      : recording && failed ? "Test paused. Stop Test, then try again."
      : recording ? "Listening — speak naturally and watch your words appear."
      : status === "processing" ? "Finishing your test…"
      : passed ? "Your voice test worked. You’re ready to finish onboarding."
      : status === "error" ? "The test could not finish. Check the message above, then try again."
      : attempted ? "No speech was recognized. Try again and speak for a few seconds."
      : "Click Start Test when you’re ready to speak."}</p>
    <div className="voco-setup__transcript" role="region" aria-label="Test transcript" tabIndex={0}>
      {transcript && transcript !== "(no speech detected)" ? transcript : <span>Your words will appear here…</span>}
    </div>
    <p className="voco-setup__privacy">Start Test turns on your microphone. Your speech stays on this computer; this test only displays words here.</p>
    <div className="voco-setup__actions">
      <button className="voco-button voco-button--secondary" disabled={busy || blocked || speakerPlaying}
        onClick={recording ? onStop : onStart}>{recording ? "Stop Test" : passed || status === "error" ? "Test again" : "Start Test"}</button>
      <button className="voco-button voco-button--primary" disabled={busy || blocked || failed || !(passed || (recording && transcript.trim() && transcript !== "(no speech detected)"))}
        onClick={() => void onFinish()}>Finish Onboarding</button>
    </div>
    <p className="voco-setup__next">After setup, click in a text field and press <kbd>{hotkey}</kbd> to start or stop dictation.</p>
  </section>;
}
