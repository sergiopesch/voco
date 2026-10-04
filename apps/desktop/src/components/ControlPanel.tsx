import { DeviceSelect } from "./DeviceSelect";
import { StatusMark } from "./StatusMark";
import { RecordingVoiceSignal } from "./VoiceSignal";
import { Tooltip } from "./Tooltip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AppConfig,
  AudioDeviceOption,
  DictationStatus,
  DesktopInputStatus,
  MicrophonePermission,
  RuntimeDiagnostics,
  UpdateCheckState,
} from "@/types";
import { isDictationActive } from "@/lib/activityMode";
import { calculateVisualAudioLevelFromSamples } from "@/lib/audioLevel";
import { openMicrophoneStream } from "@/lib/audioInput";
import { createAnimationFrameLease } from "@/lib/animationFrameLease";
import { DIAGNOSTICS_TIMEOUT_MS, microphoneLabel, shortcutPresentation, withTimeout } from "@/lib/shortcutPresentation";
import { getDesktopInputStatus, traceHotkeyEvent } from "@/lib/tauri";
import { Onboarding } from "@/components/Onboarding";
import { PanelSetup } from "@/components/PanelSetup";
import { useStore } from "@/store/useStore";
import { NativeMicrophoneSettings } from "@/components/NativeMicrophoneSettings";
import type { NativeMicrophoneControls } from "@/hooks/useNativeCaptureSettings";
import { SettingsIcon } from "@/components/SettingsIcon";
import { useGlassPointer } from "@/hooks/useGlassPointer";
import vocoBrandImage from "../../../../assets/voco-symbol-ui.png";

interface ControlPanelProps {
  nativeMicrophone?: NativeMicrophoneControls;
  onStartTest?: () => void;
  onStopTest?: () => void;
  onFinishTest?: () => Promise<boolean>;
  testPreparing?: boolean;
  surface: "onboarding" | "settings" | "popover";
  config: AppConfig;
  errorMessage: string | null;
  statusLabel: string;
  updateState: UpdateCheckState;
  runtimeDiagnostics: RuntimeDiagnostics | null;
  dictationStatus: DictationStatus;
  captureNotice?: string | null;
  canCancelDictation?: boolean;
  cancellationPending?: boolean;
  onCancelDictation?: () => void;
  onPrepareDictation?: () => void;
  onDraftStateChange?: (dirty: boolean) => void;
  onShortcutCaptureChange?: (active: boolean) => void;
  closeRequestId?: number;
  requestedSection: PanelSection;
  requestedSectionRequestId: number;
  selectedDeviceId: string | null;
  availableDevices: AudioDeviceOption[];
  microphonePermission: MicrophonePermission;
  onSurfaceChange: (surface: "hidden" | "onboarding" | "settings" | "popover") => void;
  onConfigChange: (patch: Partial<AppConfig>) => Promise<void>;
  onRefreshDevices: () => Promise<void>;
  onRequestMicrophoneAccess: () => Promise<boolean>;
  onCheckForUpdates: () => Promise<void>;
  onOpenReleasePage: (url: string) => Promise<void>;
  onRefreshRuntimeDiagnostics: () => Promise<void>;
  onOpenSettings: (section?: PanelSection) => Promise<void>;
}

const DESKTOP_SETUP_GUIDE = "https://github.com/sergiopesch/voco/blob/master/docs/platform/README.md#wayland-paste-keys";

export type PanelSection = "General" | "Audio" | "Hotkeys" | "Updates" | "Advanced";

export function shouldOpenMicrophonePreview(
  surface: ControlPanelProps["surface"],
  activeSection: PanelSection,
  dictationBusy = false,
): boolean {
  return !dictationBusy && surface === "settings" && activeSection === "Audio";
}

const PANEL_SECTION_LABELS: Record<PanelSection, string> = {
  General: "Settings",
  Audio: "Microphone",
  Hotkeys: "Shortcut",
  Updates: "Updates",
  Advanced: "Help",
};

export function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "shiftKey" | "metaKey">): string | null {
  if (["Alt", "Control", "Shift", "Meta"].includes(event.key)) return null;
  const modifiers = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super"].filter(Boolean);
  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return event.ctrlKey || event.altKey || event.metaKey ? [...modifiers, key].join("+") : null;
}

export function ControlPanel({
  nativeMicrophone,
  onStartTest,
  onStopTest,
  onFinishTest,
  testPreparing = false,
  surface,
  config,
  errorMessage,
  statusLabel,
  updateState,
  runtimeDiagnostics,
  dictationStatus,
  captureNotice,
  canCancelDictation,
  cancellationPending,
  onCancelDictation,
  onPrepareDictation,
  onDraftStateChange,
  onShortcutCaptureChange,
  closeRequestId = 0,
  requestedSection,
  requestedSectionRequestId,
  selectedDeviceId,
  availableDevices,
  microphonePermission,
  onSurfaceChange,
  onConfigChange,
  onRefreshDevices,
  onRequestMicrophoneAccess,
  onCheckForUpdates,
  onOpenReleasePage,
  onRefreshRuntimeDiagnostics,
  onOpenSettings,
}: ControlPanelProps) {
  async function handleHeaderPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, select, textarea, a, label")) {
      return;
    }

    try {
      await getCurrentWindow().startDragging();
    } catch (error) {
      console.warn("Failed to start window drag:", error);
    }
  }

  const glassPointer = useGlassPointer();
  const isPopover = surface === "popover";
  const isOnboarding = surface === "onboarding";
  const [activeSection, setActiveSection] = useState<PanelSection>(() =>
    surface === "settings" ? requestedSection : "General",
  );
  const [savingCount, setSavingCount] = useState(0);
  const [finishingTest, setFinishingTest] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [saveOutcome, setSaveOutcome] = useState<"idle" | "success" | "attention">("idle");
  const [confirmHide, setConfirmHide] = useState(false);
  const [microphoneChecked, setMicrophoneChecked] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState(false);
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const shortcutEditButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditingShortcut = useRef(false);
  const headingContainerRef = useRef<HTMLElement>(null);
  const saving = savingCount > 0;
  const mainSettings = ["General", "Audio"].includes(activeSection);
  const [microphoneSaveError, setMicrophoneSaveError] = useState<string | null>(null);
  const previousCloseRequestRef = useRef(closeRequestId);
  const microphoneSaveRequestRef = useRef(0);
  const [hotkeyDraft, setHotkeyDraft] = useState(config.hotkey);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const nativePreviewDisabled = Boolean(nativeMicrophone && nativeMicrophone.mode !== "webkit");
  const waylandDesktop = runtimeDiagnostics?.sessionType.toLowerCase() === "wayland";
  const [inputReadiness, setInputReadiness] = useState<DesktopInputStatus | null>(null);
  const [checkingInput, setCheckingInput] = useState(false);
  const inputCheckRequest = useRef(0);
  const checkedVoiceTest = useRef(false);
  const previousMicrophone = useRef(nativeMicrophone?.selected?.selectionToken ?? selectedDeviceId);
  const desktopInput = isOnboarding ? inputReadiness ?? runtimeDiagnostics?.desktopInput : runtimeDiagnostics?.desktopInput;
  const desktopSetupError = desktopInput?.available === false ? desktopInput.detail : null;
  const testPassed = useStore(state => state.onboardingTestPassed);
  const testPurpose = useStore(state => state.dictationPurpose);
  const hotkeyDirty = hotkeyDraft !== config.hotkey;
  const dictationBusy = isDictationActive(dictationStatus);
  // The live level goes straight to the meter; a state update per animation
  // frame would re-render the whole panel.
  const meterFillRef = useRef<HTMLDivElement>(null);
  const setPreviewLevel = useCallback((level: number) => {
    if (meterFillRef.current) meterFillRef.current.style.transform = `scaleX(${level})`;
  }, []);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [microphoneRetryRevision, setMicrophoneRetryRevision] = useState(0);
  const previewRetryRequest = useRef(0);
  useEffect(() => {
    previewRetryRequest.current += 1;
    return () => { previewRetryRequest.current += 1; };
  }, [selectedDeviceId, surface, activeSection]);
  const retryMicrophone = async () => {
    const request = ++previewRetryRequest.current;
    if (await onRequestMicrophoneAccess() === true && request === previewRetryRequest.current) {
      setMicrophoneRetryRevision((revision) => revision + 1);
    }
  };
  const selectedDeviceLabel = microphoneLabel(nativeMicrophone?.mode, nativeMicrophone?.selected, selectedDeviceId, availableDevices);
  const deviceOptions = useMemo(() => [
    { value: "", label: "System default" },
    ...availableDevices.map((device) => ({ value: device.deviceId, label: device.label })),
  ], [availableDevices]);
  const shortcut = shortcutPresentation(config.hotkey, runtimeDiagnostics?.shortcut, desktopInput);
  // The tray tooltip keeps any readiness detail; the popover heading stays short.
  const statusHeading = desktopSetupError ? "Setup needed" : statusLabel.startsWith("Ready") ? "Ready" : statusLabel;
  const updateInstallCopy = config.installChannel === "source"
    ? "You build VOCO from source. To update, check out the newer release tag and rebuild."
    : "VOCO only checks for updates; it never downloads or installs them. To update, run the newer release's installer from its release page.";
  const updateStatusCopy = useMemo(() => {
    switch (updateState.status) {
      case "checking":
        return "Checking GitHub Releases for a newer VOCO build.";
      case "available":
        return `VOCO ${updateState.latestRelease?.version ?? ""} is available on the ${config.updateChannel} channel.`;
      case "up-to-date":
        return "This installation is current for the selected update channel.";
      case "error":
        return updateState.error ?? "VOCO could not complete the update check.";
      default:
        return "Not checked yet.";
    }
  }, [config.updateChannel, updateState.error, updateState.latestRelease?.version, updateState.status]);
  const upgradePrompt = useMemo(() => {
    if (updateState.status !== "available" || !updateState.latestRelease) {
      return null;
    }

    return config.installChannel === "source"
      ? `Check out voco.${updateState.latestRelease.version} and rebuild.`
      : `Run the ${updateState.latestRelease.version} installer from its release page. It upgrades VOCO in place and keeps your settings.`;
  }, [config.installChannel, updateState.latestRelease, updateState.status]);
  const lastCheckedLabel = useMemo(() => {
    if (!updateState.lastCheckedAt) {
      return "Not checked yet";
    }
    return new Date(updateState.lastCheckedAt).toLocaleString();
  }, [updateState.lastCheckedAt]);
  const runtimeSessionLabel = useMemo(() => {
    switch (runtimeDiagnostics?.sessionType) {
      case "wayland":
        return "Wayland";
      case "x11-or-other":
        return "X11 or other";
      default:
        return "Unavailable";
    }
  }, [runtimeDiagnostics?.sessionType]);
  const typeSimulationLabel = useMemo(() => {
    if (!runtimeDiagnostics) {
      return "Runtime checks unavailable.";
    }
    const keys = runtimeDiagnostics.typeSimulation;
    if (keys.available) {
      return "Ready";
    }
    // Wayland's virtual keyboard is not a command, so it reports a reason instead.
    return keys.missingCommands.length > 0 ? `Missing: ${keys.missingCommands.join(", ")}` : keys.detail;
  }, [runtimeDiagnostics]);
  const clipboardLabel = useMemo(() => {
    if (!runtimeDiagnostics || !desktopInput) {
      return "Runtime checks unavailable.";
    }
    if (desktopSetupError) return "Setup needed";
    return "Ready";
  }, [runtimeDiagnostics, desktopInput, desktopSetupError]);
  const ibusShortcutLabel = useMemo(() => {
    if (!runtimeDiagnostics) {
      return "Runtime checks unavailable.";
    }
    switch (runtimeDiagnostics.ibusShortcut.setupState) {
      case "ready":
        return "Ready";
      case "not-enabled":
        return "Input source not enabled";
      case "not-installed":
        return "Input source not installed";
      case "incompatible":
        return "Package refresh required";
      case "runtime-unavailable":
        return "Desktop session unavailable";
      default:
        return runtimeDiagnostics.ibusShortcut.available
          ? "Ready"
          : "Unavailable";
    }
  }, [runtimeDiagnostics]);
  useEffect(() => {
    if (confirmHide) headingContainerRef.current?.querySelector<HTMLElement>('[aria-label="Unsaved changes"]')?.focus();
  }, [confirmHide]);

  useEffect(() => {
    onDraftStateChange?.(hotkeyDirty);
    return () => onDraftStateChange?.(false);
  }, [hotkeyDirty, onDraftStateChange]);

  useEffect(() => {
    if (previousCloseRequestRef.current !== closeRequestId && hotkeyDirty) setConfirmHide(true);
    previousCloseRequestRef.current = closeRequestId;
  }, [closeRequestId, hotkeyDirty]);

  useEffect(() => () => onShortcutCaptureChange?.(false), [onShortcutCaptureChange]);

  useEffect(() => { setSaveFeedback(null); }, [activeSection, surface]);

  useEffect(() => {
    headingContainerRef.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [surface, activeSection]);

  useEffect(() => { setMicrophoneChecked(false); }, [selectedDeviceId]);

  useEffect(() => {
    if (surface === "settings") {
      setActiveSection(requestedSection);
    }
  }, [requestedSection, requestedSectionRequestId, surface]);

  useEffect(() => {
    if (surface === "onboarding") {
      void onRefreshDevices();
    }
  }, [onRefreshDevices, surface]);

  useEffect(() => {
    if (editingShortcut) headingContainerRef.current?.querySelector<HTMLInputElement>('input[aria-describedby="voco-hotkey-feedback"]')?.focus();
    else if (wasEditingShortcut.current) shortcutEditButtonRef.current?.focus();
    wasEditingShortcut.current = editingShortcut;
  }, [editingShortcut]);

  useEffect(() => {
    setHotkeyDraft(config.hotkey);
    setHotkeyError(null);
  }, [config.hotkey]);

  useEffect(() => {
    const shouldPreview = shouldOpenMicrophonePreview(surface, activeSection, dictationBusy);
    if (!shouldPreview || nativePreviewDisabled) {
      setPreviewLevel(0);
      setPreviewError(null);
      return;
    }
    setMicrophoneChecked(false);

    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let data: Float32Array | null = null;
    const animationFrame = createAnimationFrameLease(
      (callback) => window.requestAnimationFrame(callback),
      (frameId) => window.cancelAnimationFrame(frameId),
    );

    const releasePreview = () => {
      animationFrame.stop();
      const ownedSource = source;
      const ownedAnalyser = analyser;
      const ownedContext = audioContext;
      const ownedStream = stream;
      source = null;
      analyser = null;
      audioContext = null;
      stream = null;
      data = null;
      ownedSource?.disconnect();
      ownedAnalyser?.disconnect();
      void ownedContext?.close().catch(() => {});
      ownedStream?.getTracks().forEach((track) => track.stop());
    };

    const tick = () => {
      if (cancelled || !animationFrame.isActive() || !analyser || !data) {
        return;
      }
      analyser.getFloatTimeDomainData(data as unknown as Float32Array<ArrayBuffer>);
      const level = calculateVisualAudioLevelFromSamples(data);
      setPreviewLevel(level);
      if (level > 0.02) setMicrophoneChecked(true);
      animationFrame.schedule(tick);
    };

    void openMicrophoneStream(selectedDeviceId)
      .then(async (nextStream) => {
        if (cancelled) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = nextStream;
        const nextContext = new AudioContext();
        audioContext = nextContext;
        if (nextContext.state !== "running") {
          await nextContext.resume();
        }
        if (cancelled || audioContext !== nextContext) {
          return;
        }
        if (nextContext.state !== "running") {
          throw new Error("Microphone preview audio context did not start.");
        }
        setPreviewError(null);
        analyser = nextContext.createAnalyser();
        analyser.fftSize = 512;
        data = new Float32Array(
          new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT),
        );
        source = audioContext.createMediaStreamSource(nextStream);
        source.connect(analyser);
        tick();
      })
      .catch((error) => {
        releasePreview();
        if (cancelled) {
          return;
        }
        const detail = error instanceof Error ? error.message : String(error);
        setPreviewError(detail);
        setMicrophoneChecked(false);
        setPreviewLevel(0);
      });

    return () => {
      cancelled = true;
      releasePreview();
    };
  }, [activeSection, dictationBusy, selectedDeviceId, surface, microphoneRetryRevision, nativePreviewDisabled, setPreviewLevel]);

  async function savePatch(
    patch: Partial<AppConfig>,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    setSavingCount((count) => count + 1);
    setSaveFeedback(null);
    setSaveOutcome("idle");
    try {
      await onConfigChange(patch);
      setSaveFeedback("Saved on this device.");
      setSaveOutcome("success");
      return { ok: true };
    } catch (error) {
      setSaveFeedback("Changes could not be saved. Review the error and try again.");
      setSaveOutcome("attention");
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "VOCO could not save those settings.",
      };
    } finally {
      setSavingCount((count) => Math.max(0, count - 1));
    }
  }

  async function selectMicrophone(deviceId: string | null): Promise<boolean> {
    const requestId = microphoneSaveRequestRef.current + 1;
    microphoneSaveRequestRef.current = requestId;
    setMicrophoneSaveError(null);
    const result = await savePatch({ selectedMic: deviceId });
    if (microphoneSaveRequestRef.current !== requestId) {
      return false;
    }
    if (!result.ok) {
      setMicrophoneSaveError(result.message);
    }
    return result.ok;
  }

  async function retryMicrophonePreview() {
    try { await retryMicrophone(); }
    catch (error) { setPreviewError(error instanceof Error ? error.message : "Microphone access failed."); }
  }

  function endShortcutCapture() {
    setRecordingShortcut(false);
    onShortcutCaptureChange?.(false);
  }

  function beginShortcutCapture() {
    onShortcutCaptureChange?.(true);
    setRecordingShortcut(true);
    headingContainerRef.current?.querySelector<HTMLInputElement>('input[aria-describedby="voco-hotkey-feedback"]')?.focus();
  }

  function hidePanel() {
    onDraftStateChange?.(false);
    onSurfaceChange("hidden");
  }

  function prepareDictation() {
    if (hotkeyDirty) { setConfirmHide(true); return; }
    onDraftStateChange?.(false);
    if (onPrepareDictation) onPrepareDictation();
    else onSurfaceChange("hidden");
  }

  function captureShortcut(event: KeyboardEvent<HTMLInputElement>) {
    if (!recordingShortcut) return;
    event.preventDefault();
    if (event.key === "Escape") { endShortcutCapture(); return; }
    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) return;
    setHotkeyDraft(shortcut);
    setHotkeyError(null);
    endShortcutCapture();
  }

  function requestHide() {
    if (isOnboarding && (dictationBusy || testPreparing)) return;
    if (hotkeyDirty) setConfirmHide(true);
    else hidePanel();
  }

  async function saveAndHide() {
    if (hotkeyDirty && !(await saveHotkey())) return;
    hidePanel();
  }

  const checkDesktopSetup = useCallback(async (): Promise<boolean> => {
    const request = ++inputCheckRequest.current;
    setCheckingInput(true);
    try {
      const result = await withTimeout(getDesktopInputStatus(), DIAGNOSTICS_TIMEOUT_MS);
      if (!result || typeof result.available !== "boolean") throw new Error("Missing readiness result");
      if (request !== inputCheckRequest.current) return false;
      setInputReadiness(result);
      return result.available;
    } catch {
      if (request === inputCheckRequest.current) setInputReadiness({ available: false, detail: "Couldn’t check desktop setup. Check again, or open the setup instructions." });
      return false;
    } finally {
      if (request === inputCheckRequest.current) setCheckingInput(false);
    }
  }, []);

  useEffect(() => () => { inputCheckRequest.current += 1; checkedVoiceTest.current = false; }, []);
  useEffect(() => {
    if (!testPassed) {
      checkedVoiceTest.current = false;
      return;
    }
    if (isOnboarding && !dictationBusy && !checkedVoiceTest.current) {
      checkedVoiceTest.current = true;
      void checkDesktopSetup();
    }
  }, [testPassed, isOnboarding, dictationBusy, checkDesktopSetup]);
  useEffect(() => {
    const microphone = nativeMicrophone?.selected?.selectionToken ?? selectedDeviceId;
    if (microphone !== previousMicrophone.current && isOnboarding) useStore.getState().setOnboardingTestPassed(false);
    previousMicrophone.current = microphone;
  }, [nativeMicrophone?.selected?.selectionToken, selectedDeviceId, isOnboarding]);

  async function prepareFirstDictation() {
    if (saving || finishingTest || testPreparing || checkingInput) return;
    if (dictationBusy && (dictationStatus !== "recording" || !onFinishTest)) return;
    setFinishingTest(true);
    void traceHotkeyEvent("onboarding_handoff_requested").catch(() => {});
    try {
      const passed = onFinishTest ? await onFinishTest() : testPassed;
      if (!passed || !(await checkDesktopSetup())) return;
      const result = await savePatch({ onboardingCompleted: true });
      if (result.ok) {
        useStore.getState().clearTranscript();
        useStore.getState().setDictationPurpose("cursor");
        onDraftStateChange?.(false);
        onSurfaceChange("hidden");
      }
    } finally { setFinishingTest(false); }
  }

  async function saveHotkey(): Promise<boolean> {
    const normalizedHotkey = hotkeyDraft.trim() || "Alt+D";
    setHotkeyDraft(normalizedHotkey);
    setHotkeyError(null);
    // The native shortcut parser validates supported aliases and reserved shortcuts.
    const result = await savePatch({ hotkey: normalizedHotkey });
    if (result.ok) {
      setEditingShortcut(false);
      return true;
    }

    setHotkeyError(result.message);
    return false;
  }

  function renderSettingsNavigation(section: PanelSection) {
    return <button key={section} className="voco-preferences__nav-item"
      aria-current={(section === "General" ? mainSettings : activeSection === section) ? "page" : undefined}
      onClick={() => setActiveSection(section)}>
      <SettingsIcon name={section} /><span>{PANEL_SECTION_LABELS[section]}</span>
    </button>;
  }

  function keepEditing() {
    setConfirmHide(false);
    let selector = "input:not(:disabled), textarea:not(:disabled)";
    if (surface === "settings") {
      if (hotkeyDirty) {
        setActiveSection("Hotkeys");
        setEditingShortcut(true);
        selector = 'input[aria-describedby="voco-hotkey-feedback"]';
      }
    }
    requestAnimationFrame(() => {
      const container = headingContainerRef.current;
      const input = container?.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
      const target = input && !input.disabled ? input : container?.querySelector<HTMLElement>("h2");
      target?.focus();
    });
  }

  return (
    <main className="voco-panel" data-surface={surface} ref={headingContainerRef}>
      <section className="voco-panel__shell">
        {surface !== "settings" ? <header
          className="voco-panel__hero"
          onPointerDown={(event) => void handleHeaderPointerDown(event)}
        >
          <div className="voco-panel__brand">
            {!isPopover ? <div className="voco-panel__brand-mark" aria-hidden="true">
              <img
                className="voco-panel__brand-mark-image"
                src={vocoBrandImage}
                alt=""
              />
            </div> : null}
            <div>
              {isOnboarding ? <p className="voco-panel__eyebrow">Setup</p> : null}
              <h1 className="voco-panel__title">VOCO</h1>
            </div>
          </div>
          <div className="voco-panel__hero-actions">
            {isPopover ? <Tooltip text="Open settings" align="end"><button className="voco-glass voco-icon-button" aria-label="Settings" onClick={() => void onOpenSettings()}>
              <img src="/icons/settings.svg" className="voco-ui-icon" alt="" />
            </button></Tooltip> : <button
              className="voco-button voco-button--ghost voco-button--compact"
              onClick={requestHide}
              disabled={isOnboarding && (dictationBusy || testPreparing)}
            >
              Hide to tray
            </button>}
          </div>
        </header> : null}

        <div className="voco-panel__error-slot">
        {confirmHide ? <section className="voco-unsaved-notice" role="alert" aria-label="Unsaved changes" tabIndex={-1}>
          <strong>You have an unsaved shortcut.</strong>
          <p>Save it before hiding VOCO, or discard it.</p>
          <div className="voco-settings__actions">
            <button className="voco-button voco-button--primary" disabled={saving} onClick={() => void saveAndHide()}>Save and hide</button>
            <button className="voco-button voco-button--secondary" disabled={saving} onClick={hidePanel}>Discard and hide</button>
            <button className="voco-button voco-button--ghost" onClick={keepEditing}>Keep editing</button>
          </div>
        </section> : null}
          {errorMessage && !isOnboarding ? (
            <section className="voco-panel__error" aria-live="polite">
              {errorMessage}
            </section>
          ) : null}
        </div>

        {isPopover ? (
          <section className="voco-popover" data-priority={dictationBusy || statusHeading.length > 30 ? "status" : undefined}>
            <div className="voco-lens" data-recording={dictationStatus === "recording"}>
              <img src={vocoBrandImage} alt="" />
              <span className="voco-lens__signal"><RecordingVoiceSignal active={dictationStatus === "recording"} /></span>
            </div>
            <div className="voco-popover__state">
              <div className="voco-popover__state-main">
                <strong role="status" aria-live="polite"><StatusMark state={desktopSetupError || dictationStatus === "error" ? "attention" : dictationStatus === "recording" ? "listening" : dictationBusy ? "working" : "idle"} />{statusHeading}</strong>
                <kbd className="voco-glass voco-shortcut">{config.hotkey}</kbd>
              </div>
              {dictationBusy ?
                <p>{dictationStatus === "starting" ? "Wait for Listening before speaking." : dictationStatus === "recording" ? `Press ${config.hotkey} to finish.` : "Finishing your dictation…"}</p> :
                <p>{desktopSetupError ? "Open Help to finish desktop setup." : shortcut.available ? "Click where you want the text, then use your shortcut." : shortcut.unavailable ? "Check shortcut setup in Help." : "Click where you want the text, then start dictation."}</p>}
            </div>
            {captureNotice ? <div className="voco-inline-note" role="status">{captureNotice}</div> : null}
            {(canCancelDictation || cancellationPending) ? (
              <button className="voco-button voco-button--secondary" type="button" onClick={onCancelDictation} disabled={!canCancelDictation}>
                {cancellationPending ? "Cancelling output…" : "Cancel dictation"}
              </button>
            ) : null}
            <div className="voco-popover__actions">
              <button {...glassPointer} className="voco-button voco-glass voco-glass--primary" disabled={saving || dictationBusy}
                onClick={prepareDictation}>Hide to tray</button>
            </div>
            <div className="voco-popover__footer">
              <Tooltip text="Open microphone settings"><button className="voco-device-picker" aria-label={`Microphone: ${selectedDeviceLabel}`} onClick={() => void onOpenSettings("Audio")}>
                <span>{selectedDeviceLabel}</span><img src="/icons/chevron-right.svg" className="voco-ui-icon" alt="" />
              </button></Tooltip>
              <button className="voco-button voco-button--ghost voco-popover__help" onClick={() => void onOpenSettings("Advanced")}>Help</button>
            </div>
            {microphoneSaveError ? <p className="voco-inline-note voco-inline-note--error" role="alert">{microphoneSaveError}</p> : null}
          </section>
        ) : isOnboarding ? (
          <Onboarding
            microphone={nativeMicrophone?.mode === "native"
              ? nativeMicrophone.selected?.label || nativeMicrophone.sources?.sources.find(source => source.selectionToken === nativeMicrophone.sources?.defaultSelectionToken)?.label || "System default"
              : selectedDeviceLabel}
            status={dictationStatus}
            passed={testPassed}
            failed={Boolean(errorMessage)}
            attempted={testPurpose === "onboarding"}
            setupError={nativeMicrophone?.error ?? errorMessage}
            onRetrySetup={nativeMicrophone?.error ? () => void nativeMicrophone.initialize().catch(() => {}) : undefined}
            desktopSetupError={desktopSetupError}
            onCheckDesktopSetup={() => void checkDesktopSetup()}
            onOpenDesktopSetupGuide={() => void onOpenReleasePage(DESKTOP_SETUP_GUIDE)}
            checkingDesktopSetup={checkingInput}
            preparing={testPreparing || finishingTest}
            saving={saving}
            blocked={!onStartTest || nativeMicrophone?.mode === "pending"}
            desktopReady={inputReadiness?.available === true}
            microphoneControls={onSelected => nativePreviewDisabled && nativeMicrophone
              ? <NativeMicrophoneSettings controls={nativeMicrophone} disabled={dictationBusy || testPreparing} onSelected={onSelected} />
              : <div className="voco-preferences__form"><DeviceSelect label="Microphone" value={selectedDeviceId ?? ""} disabled={saving || dictationBusy || testPreparing}
                  onChange={value => void selectMicrophone(value || null).then(ok => { if (ok) onSelected(); })} options={deviceOptions} />
                <button className="voco-button voco-button--ghost" disabled={saving || dictationBusy || testPreparing} onClick={() => void onRefreshDevices()}>Refresh devices</button>
                {microphoneSaveError ? <p role="alert">{microphoneSaveError}</p> : null}</div>}
            hotkey={config.hotkey}
            onStart={() => onStartTest?.()}
            onStop={() => onStopTest?.()}
            onFinish={prepareFirstDictation}
          />
        ) : (
          <section className="voco-settings voco-preferences">
            <aside className="voco-preferences__sidebar">
              <div className="voco-preferences__brand" onPointerDown={(event) => void handleHeaderPointerDown(event)}>
                <img src={vocoBrandImage} alt="" /><h1>VOCO</h1>
              </div>
              <nav className="voco-preferences__nav" aria-label="Settings sections">
                {renderSettingsNavigation("General")}
                {renderSettingsNavigation("Hotkeys")}
              </nav>
              <nav className="voco-preferences__nav-bottom" aria-label="App settings">
                {(["Updates", "Advanced"] as const).map(renderSettingsNavigation)}
              </nav>
            </aside>

            <div className="voco-preferences__content">
              <div className="voco-preferences__window-actions" onPointerDown={(event) => void handleHeaderPointerDown(event)} aria-label="Move VOCO window">{!config.onboardingCompleted ? <button className="voco-button voco-button--ghost voco-button--compact" disabled={saving || dictationBusy || hotkeyDirty} onClick={() => onSurfaceChange("onboarding")}>Back to setup</button> : null}<button className="voco-button voco-button--ghost voco-button--compact" onClick={requestHide}>Hide to tray</button></div>
              {mainSettings ? <div className="voco-preferences__heading"><h2 tabIndex={-1}>Settings</h2></div> : null}
              {mainSettings ? <>
                  {desktopSetupError ? <div className="voco-inline-note" role="status">Desktop setup needed. <button className="voco-button voco-button--ghost" onClick={() => setActiveSection("Advanced")}>Open Help</button></div>
                    : desktopInput?.setupArea === "panel" ? <div className="voco-inline-note" role="status">{desktopInput.detail} <button className="voco-button voco-button--ghost" onClick={() => setActiveSection("Advanced")}>Open Help</button></div> : null}
              </> : null}

              {mainSettings ? (
                <section className="voco-preferences__page">
                  <h3 className="voco-preferences__group-title">Microphone</h3>
                  {nativePreviewDisabled && nativeMicrophone ? <NativeMicrophoneSettings controls={nativeMicrophone} disabled={dictationBusy} /> : <>
                  <div className="voco-preferences__group">
                    <div className="voco-preferences__card voco-preferences__form">
                      <div className="voco-field voco-preferences__field-row"><span>Input device</span>
                        <DeviceSelect label="Input device" value={selectedDeviceId ?? ""} disabled={saving || dictationBusy}
                          onChange={value => void selectMicrophone(value || null)}
                          options={deviceOptions} />
                      </div>
                      {microphoneSaveError ? <div className="voco-inline-note voco-inline-note--error" role="alert">{microphoneSaveError}</div> : null}
                      <div className="voco-preferences__actions"><button className="voco-button voco-button--ghost" disabled={saving || dictationBusy || testPreparing} onClick={() => void onRefreshDevices()}>Refresh devices</button></div>
                    </div>
                  </div>
                  {activeSection !== "Audio" ? <button className="voco-button voco-button--secondary" disabled={dictationBusy} onClick={() => setActiveSection("Audio")}>Test microphone</button> : <div className="voco-preferences__group"><h3 className="voco-preferences__group-title">Sound check</h3>
                    <div className="voco-preferences__card voco-preferences__form">
                      <p className="voco-preferences__status" role="status">{dictationBusy ? "Microphone check paused during dictation." : previewError || microphonePermission === "denied" ? "Microphone access needs attention." : microphoneChecked ? "Audio detected during this check" : "Waiting for sound"}</p>
                      {!dictationBusy && !previewError && microphonePermission !== "denied" ? <p className="voco-preferences__helper">Speak a few words. This checks microphone sound, not transcription.</p> : null}
                      <div className="voco-meter"><span className="voco-meter__label">Live level</span>
                        <div className="voco-meter__track" aria-hidden="true"><div ref={meterFillRef} className="voco-meter__fill" style={{ transform: "scaleX(0)" }} /></div>
                      </div>
                      {previewError ? <div className="voco-inline-note voco-inline-note--error" role="alert">{previewError}</div> : null}
                      {previewError || microphonePermission === "denied" ? <div className="voco-preferences__actions"><button className="voco-button voco-button--secondary" disabled={dictationBusy} onClick={() => void retryMicrophonePreview()}>Retry microphone access</button></div> : null}
                    </div>
                  </div>}
                  </>}
                </section>
              ) : null}

              {activeSection === "Hotkeys" ? (
                <section className="voco-preferences__page">
                  <div className="voco-preferences__heading"><h2 tabIndex={-1}>Shortcut</h2></div>
                  <div className="voco-preferences__group">
                    <div className="voco-preferences__card voco-preferences__form">
                      {!editingShortcut ? <div className="voco-preferences__shortcut-summary"><span>Start and stop dictation</span><kbd className="voco-glass voco-shortcut">{config.hotkey}</kbd><button className="voco-button voco-button--secondary" ref={shortcutEditButtonRef} onClick={() => setEditingShortcut(true)}>Change shortcut</button></div> : <div className="voco-preferences__shortcut-editor">
                        <label className="voco-field"><span>Start and stop dictation</span><input disabled={saving} value={recordingShortcut ? "Press your shortcut…" : hotkeyDraft} aria-invalid={Boolean(hotkeyError)} aria-describedby="voco-hotkey-feedback"
                          onBlur={() => { if (recordingShortcut) endShortcutCapture(); }} onChange={(event) => setHotkeyDraft(event.target.value)}
                          onKeyDown={(event) => { if (recordingShortcut) { captureShortcut(event); return; } if (event.key === "Enter") { event.preventDefault(); void saveHotkey(); } }} /></label>
                        <Tooltip text="Press a modifier and key; Escape cancels."><button className="voco-button voco-button--secondary" disabled={saving} onClick={beginShortcutCapture}>Record keys</button></Tooltip>
                        {hotkeyDirty || hotkeyError ? <button className="voco-button voco-button--primary" onClick={() => void saveHotkey()} disabled={saving}>Apply shortcut</button> : null}
                        <button className="voco-button voco-button--ghost" disabled={saving} onClick={() => { endShortcutCapture(); setHotkeyDraft(config.hotkey); setHotkeyError(null); setEditingShortcut(false); }}>Cancel</button>
                      </div>}
                      <p className="voco-preferences__helper" id="voco-hotkey-feedback" role="status">{hotkeyError ?? (recordingShortcut ? "Press a modifier and key. Escape cancels." : shortcut.instruction)}</p>
                      <details className="voco-preferences__disclosure"><summary>Shortcut help</summary><p className="voco-preferences__helper">{shortcut.detail}</p>
                      {shortcut.setup ? <p className="voco-preferences__helper">{shortcut.setup}</p> : null}
                      {waylandDesktop ? <div className="voco-inline-note">
                        <strong>Desktop shortcut</strong>
                        <p>You can assign <code>voco --toggle</code> to a non-repeating shortcut in your desktop settings.
                          Keep VOCO running and use that shortcut to start and stop dictation.
                          Use an unused key such as F8, and let the binding ignore modifiers: VOCO briefly holds Shift while pasting.</p>
                        <p>The shortcut above and its status describe VOCO’s built-in keyboard handling.
                          Your desktop controls external bindings; VOCO cannot verify which keys you assigned.</p>
                      </div> : null}</details>
                    </div>
                  </div>
                </section>
              ) : null}

              {activeSection === "Updates" ? (
                <section className="voco-preferences__page">
                  <div className="voco-preferences__heading"><h2 tabIndex={-1}>Updates</h2></div>
                  <div className="voco-preferences__card voco-preferences__form">
                    <div className="voco-preferences__row"><span className="voco-preferences__row-copy"><strong>Installed version</strong></span><span className="voco-preferences__row-value">{updateState.currentVersion ?? "Checking…"}</span></div>
                    <p className="voco-preferences__status" role="status">{updateStatusCopy}</p>
                    <div className="voco-preferences__actions">
                      <button className="voco-button voco-button--primary" disabled={updateState.status === "checking"} onClick={() => void onCheckForUpdates()}>{updateState.status === "checking" ? "Checking…" : "Check for updates"}</button>
                      {updateState.latestRelease?.url ? <button className="voco-button voco-button--secondary" onClick={() => void onOpenReleasePage(updateState.latestRelease!.url)}>Open latest release</button> : null}
                    </div>
                  </div>
                  <details className="voco-preferences__card voco-preferences__disclosure"><summary>Update settings</summary>
                    <div className="voco-preferences__form">
                      <label className="voco-field voco-preferences__field-row"><span>Installation method for update instructions</span><select value={config.installChannel} onChange={(event) => void savePatch({ installChannel: event.target.value as AppConfig["installChannel"] })}>
                        <option value="github-release">GitHub Release</option><option value="source">Source build</option>
                      </select></label>
                      <p className="voco-preferences__helper">{updateInstallCopy}</p>
                      <label className="voco-field voco-preferences__field-row"><span>Update channel</span><select value={config.updateChannel} onChange={(event) => void savePatch({ updateChannel: event.target.value as AppConfig["updateChannel"] })}><option value="stable">Stable</option><option value="beta">Beta</option></select></label>
                      <p className="voco-preferences__helper">{config.updateChannel === "beta" ? "Beta releases change more often." : "Recommended for everyday use."}</p>
                      <p><strong>Last checked:</strong> {lastCheckedLabel}</p>
                      {updateState.latestRelease ? <p><strong>Latest release:</strong> <code>{updateState.latestRelease.version}</code></p> : null}
                      {upgradePrompt ? <p><strong>Upgrade path:</strong> {upgradePrompt}</p> : null}
                      {updateState.latestRelease?.url ? <p><strong>Release page:</strong> <code>{updateState.latestRelease.url}</code></p> : null}
                    </div>
                  </details>
                </section>
              ) : null}

              {activeSection === "Advanced" ? (
                <section className="voco-preferences__page">
                  <div className="voco-preferences__heading"><h2 tabIndex={-1}>Help</h2></div>
                  <PanelSetup disabled={saving || dictationBusy} />
                  <details className="voco-preferences__card voco-preferences__disclosure"><summary>How to dictate</summary><p>Click where you want your words and press <kbd>{config.hotkey}</kbd>. VOCO’s bars move once it is listening. Press again to finish.</p><p>VOCO pastes into whichever app has keyboard focus, including terminals and browsers. It replaces clipboard text and never presses Enter.</p><p>In an enabled Chromium tab, use <kbd>Alt+Shift+V</kbd> for direct delivery to a plain text field.</p></details>
                  <details className="voco-preferences__card voco-preferences__disclosure"><summary>My microphone is not working</summary><p>Check the selected microphone and allow access for this session.</p><button className="voco-button voco-button--secondary" onClick={() => setActiveSection("Audio")}>Microphone settings</button></details>
                  <details className="voco-preferences__card voco-preferences__disclosure"><summary>My shortcut is not working</summary><p>{shortcut.detail}</p>{shortcut.setup ? <p>{shortcut.setup}</p> : null}<button className="voco-button voco-button--secondary" onClick={() => setActiveSection("Hotkeys")}>Shortcut settings</button></details>
                  <details className="voco-preferences__card voco-preferences__disclosure"><summary>My words are not appearing</summary><p>Keep the app you’re dictating into focused. If VOCO can’t paste there, it copies the rest of your words to the clipboard when you stop; check the field, then paste with Shift+Insert or Ctrl+V. If the copy fails too, or VOCO exits unexpectedly, choose Review in VOCO’s menu to get your words back.</p>{desktopSetupError ? <p role="status">{desktopSetupError}</p> : null}<button className="voco-button voco-button--secondary" onClick={() => void onOpenReleasePage(DESKTOP_SETUP_GUIDE)}>Open setup instructions</button></details>
                  <details className="voco-preferences__card voco-preferences__disclosure"><summary>Technical details</summary>
                  <div className="voco-preferences__group"><h3 className="voco-preferences__group-title">Runtime checks</h3>
                    <div className="voco-preferences__card">
                      <div className="voco-preferences__row"><span className="voco-preferences__row-copy"><strong>Session</strong></span><span className="voco-preferences__row-value">{runtimeSessionLabel}</span></div>
                      <div className="voco-preferences__row"><span className="voco-preferences__row-copy"><strong>IBus shortcut (optional)</strong></span><span className="voco-preferences__row-value">{ibusShortcutLabel}</span></div>
                      <div className="voco-preferences__row"><span className="voco-preferences__row-copy"><strong>Paste keys</strong></span><span className="voco-preferences__row-value">{typeSimulationLabel}</span></div>
                      <div className="voco-preferences__row"><span className="voco-preferences__row-copy"><strong>Clipboard</strong></span><span className="voco-preferences__row-value">{clipboardLabel}</span></div>
                    </div>
                  </div>
                  {runtimeDiagnostics ? <details className="voco-preferences__card voco-preferences__disclosure"><summary>Diagnostic details</summary>
                    <div className="voco-preferences__form"><p><strong>IBus shortcut (optional):</strong> {runtimeDiagnostics.ibusShortcut.detail}</p><p><strong>Paste keys:</strong> {runtimeDiagnostics.typeSimulation.detail}</p><p><strong>Clipboard:</strong> {runtimeDiagnostics.clipboard.detail}</p></div>
                  </details> : null}
                  </details>
                  <div className="voco-preferences__actions">
                    <button className="voco-button voco-button--secondary" onClick={() => void onRefreshRuntimeDiagnostics()}>Refresh runtime checks</button>
                    {desktopSetupError ? <button className="voco-button voco-button--secondary" onClick={() => void onOpenReleasePage(DESKTOP_SETUP_GUIDE)}>Open setup instructions</button> : null}
                    <button className="voco-button voco-button--ghost" disabled={saving || hotkeyDirty} title={hotkeyDirty ? "Apply or cancel your shortcut before restarting setup." : undefined}
                      onClick={async () => { const result = await savePatch({ onboardingCompleted: false }); if (result.ok) onSurfaceChange("onboarding"); }}>Run setup again</button>
                  </div>
                </section>
              ) : null}
              {saving || hotkeyDirty || saveFeedback ? <p className="voco-preferences__feedback voco-motion-feedback" role="status"><StatusMark state={saving ? "working" : hotkeyDirty ? "idle" : saveOutcome} />{saving ? "Saving…" : hotkeyDirty ? "Unsaved shortcut — apply or cancel it." : saveFeedback}</p> : null}
            </div>
          </section>
        )}

        {isOnboarding && (saving || saveFeedback) ? (
          <footer className="voco-panel__footer">
            <span className="voco-save-status" role="status">{saving ? "Saving…" : hotkeyDirty ? "Unsaved shortcut — apply or cancel it." : saveFeedback}</span>
          </footer>
        ) : null}
      </section>
    </main>
  );
}
