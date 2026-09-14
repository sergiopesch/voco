import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AppConfig,
  AudioDeviceOption,
  CursorDeliveryState,
  DictationStatus,
  MicrophonePermission,
  RuntimeDiagnostics,
  RealtimeStatus,
  RecoverableTranscript,
  UpdateCheckState,
} from "@/types";
import { calculateVisualAudioLevelFromSamples } from "@/lib/audioLevel";
import { openMicrophoneStream } from "@/lib/audioInput";
import { createAnimationFrameLease } from "@/lib/animationFrameLease";
import type { DictationRecovery } from "@/lib/dictationRecovery";
import { testLocalLlm } from "@/lib/tauri";
import { microphoneLabel, shortcutPresentation } from "@/lib/shortcutPresentation";
import { formatLocalModelTestStatus } from "@/lib/localModelStatus";
import { RealtimeMicVisual } from "@/components/RealtimeMicVisual";
import { NativeMicrophoneSettings } from "@/components/NativeMicrophoneSettings";
import type { NativeMicrophoneControls } from "@/hooks/useNativeCaptureSettings";
import { SettingsIcon } from "@/components/SettingsIcon";
import { useGlassPointer } from "@/hooks/useGlassPointer";
import vocoBrandImage from "../../../../assets/voco-symbol-ui.png";

interface ControlPanelProps {
  nativeMicrophone?: NativeMicrophoneControls;
  surface: "onboarding" | "settings" | "popover";
  onboardingStep: number;
  config: AppConfig;
  errorMessage: string | null;
  statusLabel: string;
  updateState: UpdateCheckState;
  runtimeDiagnostics: RuntimeDiagnostics | null;
  dictationStatus: DictationStatus;
  cursorDeliveryState: CursorDeliveryState;
  transcript: string;
  rawTranscript?: string;
  recovery?: DictationRecovery | null;
  captureNotice?: string | null;
  canCancelDictation?: boolean;
  cancellationPending?: boolean;
  onCancelDictation?: () => void;
  onRetryRecovery?: () => void;
  onDiscardRecovery?: () => void;
  recoverableTranscripts?: RecoverableTranscript[];
  onDismissRecoverableTranscript?: (id: string) => void;
  onPrepareDictation?: () => void;
  onDraftStateChange?: (dirty: boolean) => void;
  onShortcutCaptureChange?: (active: boolean) => void;
  closeRequestId?: number;
  lastDictationResult?: { completedAt: number; outcome: "delivered" | "needs-recovery" } | null;
  requestedSection: PanelSection;
  requestedSectionRequestId: number;
  isRealtimeActive: boolean;
  isRealtimeMuted: boolean;
  realtimeActivationAllowed: boolean;
  realtimeStatus: RealtimeStatus;
  realtimeDetail: string;
  realtimeError: string | null;
  realtimeLevel: number;
  selectedDeviceId: string | null;
  availableDevices: AudioDeviceOption[];
  microphonePermission: MicrophonePermission;
  onSurfaceChange: (surface: "hidden" | "onboarding" | "settings" | "popover") => void;
  onOnboardingStepChange: (step: number) => void;
  onConfigChange: (patch: Partial<AppConfig>) => Promise<void>;
  onRefreshDevices: () => Promise<void>;
  onRequestMicrophoneAccess: () => Promise<boolean>;
  onCheckForUpdates: () => Promise<void>;
  onOpenReleasePage: (url: string) => Promise<void>;
  onRefreshRuntimeDiagnostics: () => Promise<void>;
  onOpenSettings: (section?: "General" | "Audio" | "Hotkeys" | "Integrations") => Promise<void>;
  onToggleRealtime: () => void;
}

const PANEL_SECTIONS = [
  "General",
  "Audio",
  "Output",
  "Hotkeys",
  "Appearance",
  "Integrations",
  "Updates",
  "Advanced",
] as const;

type PanelSection = (typeof PANEL_SECTIONS)[number];

export function shouldOpenMicrophonePreview(
  surface: ControlPanelProps["surface"],
  onboardingStep: number,
  activeSection: PanelSection,
  isRealtimeActive: boolean,
  dictationStatus: DictationStatus = "idle",
): boolean {
  if (isRealtimeActive || dictationStatus === "starting" || dictationStatus === "recording" || dictationStatus === "processing") {
    return false;
  }
  return (
    (surface === "onboarding" && onboardingStep === 1) ||
    (surface === "settings" && activeSection === "Audio")
  );
}

const PANEL_SECTION_LABELS: Record<PanelSection, string> = {
  General: "Overview",
  Audio: "Microphone",
  Output: "Dictation",
  Integrations: "Integrations",
  Hotkeys: "Shortcuts",
  Appearance: "Appearance",
  Updates: "Updates",
  Advanced: "Troubleshooting",
};

export function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "shiftKey" | "metaKey">): string | null {
  if (["Alt", "Control", "Shift", "Meta"].includes(event.key)) return null;
  const modifiers = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super"].filter(Boolean);
  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return event.ctrlKey || event.altKey || event.metaKey ? [...modifiers, key].join("+") : null;
}

const TRAY_STATE_LEGEND = [
  { label: "Ready", image: "/tray/ready.png" },
  { label: "Listening", image: "/tray/recording.png" },
  { label: "Transcribing", image: "/tray/processing.png" },
  { label: "Needs attention", image: "/tray/not-ready.png" },
] as const;

export function ControlPanel({
  nativeMicrophone,
  surface,
  onboardingStep,
  config,
  errorMessage,
  statusLabel,
  updateState,
  runtimeDiagnostics,
  dictationStatus,
  cursorDeliveryState,
  transcript,
  rawTranscript,
  recovery,
  captureNotice,
  canCancelDictation,
  cancellationPending,
  onCancelDictation,
  onRetryRecovery,
  onDiscardRecovery,
  recoverableTranscripts,
  onDismissRecoverableTranscript,
  onPrepareDictation,
  onDraftStateChange,
  onShortcutCaptureChange,
  closeRequestId = 0,
  lastDictationResult = null,
  requestedSection,
  requestedSectionRequestId,
  isRealtimeActive,
  isRealtimeMuted,
  realtimeActivationAllowed,
  realtimeStatus,
  realtimeDetail,
  realtimeError,
  realtimeLevel,
  selectedDeviceId,
  availableDevices,
  microphonePermission,
  onSurfaceChange,
  onOnboardingStepChange,
  onConfigChange,
  onRefreshDevices,
  onRequestMicrophoneAccess,
  onCheckForUpdates,
  onOpenReleasePage,
  onRefreshRuntimeDiagnostics,
  onOpenSettings,
  onToggleRealtime,
}: ControlPanelProps) {
  async function handleHeaderPointerDown(event: MouseEvent<HTMLElement>) {
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
  const [systemReducedMotion, setSystemReducedMotion] = useState<boolean | null>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : null,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setSystemReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener("change", updatePreference);
    return () => preference.removeEventListener("change", updatePreference);
  }, []);
  const isPopover = surface === "popover";
  const isOnboarding = surface === "onboarding";
  const [activeSection, setActiveSection] = useState<PanelSection>(() =>
    surface === "settings" ? requestedSection : "General",
  );
  const [savingCount, setSavingCount] = useState(0);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [confirmHide, setConfirmHide] = useState(false);
  const [microphoneChecked, setMicrophoneChecked] = useState(false);
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const headingContainerRef = useRef<HTMLElement>(null);
  const [testingLocalModel, setTestingLocalModel] = useState(false);
  const saving = savingCount > 0 || testingLocalModel;
  const [microphoneSaveError, setMicrophoneSaveError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<{ id: string; text: string } | null>(null);
  const previousCloseRequestRef = useRef(closeRequestId);
  const microphoneSaveRequestRef = useRef(0);
  const copyRequestRef = useRef(0);
  const latestTranscriptRef = useRef(transcript);
  latestTranscriptRef.current = transcript;
  const latestRawTranscriptRef = useRef(rawTranscript);
  latestRawTranscriptRef.current = rawTranscript;
  const hasCurrentRecovery = Boolean(recovery) || (recoverableTranscripts === undefined &&
    transcript.trim().length > 0 &&
    (cursorDeliveryState === "unreconciled" || dictationStatus === "error"));
  const recoveryEntries: RecoverableTranscript[] = recoverableTranscripts !== undefined ? recoverableTranscripts :
    transcript.trim().length > 0 && (cursorDeliveryState === "unreconciled" || dictationStatus === "error")
      ? [{ id: "current", text: transcript, createdAt: 0, isPartial: false, reason: cursorDeliveryState === "unreconciled" ? "delivery-unconfirmed" as const : "output-failed" as const }]
      : [];
  const hasRecoverableTranscript = hasCurrentRecovery || recoveryEntries.length > 0;
  const [hotkeyDraft, setHotkeyDraft] = useState(config.hotkey);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [openClawAgentDraft, setOpenClawAgentDraft] = useState(config.openclawAgent);
  const [openClawPromptDraft, setOpenClawPromptDraft] = useState(
    config.openclawPromptPrefix,
  );
  const [openClawError, setOpenClawError] = useState<string | null>(null);
  const [localLlmEndpointDraft, setLocalLlmEndpointDraft] = useState(
    config.localLlmEndpoint,
  );
  const [localLlmModelDraft, setLocalLlmModelDraft] = useState(
    config.localLlmModel ?? "",
  );
  const [localLlmStatus, setLocalLlmStatus] = useState<{
    kind: "ok" | "error";
    detail: string;
    endpoint: string;
    model: string | null;
  } | null>(null);
  const normalizedLocalEndpoint = localLlmEndpointDraft.trim() || "http://127.0.0.1:8080/v1/chat/completions";
  const normalizedLocalModel = localLlmModelDraft.trim() || null;
  const visibleLocalLlmStatus = localLlmStatus?.endpoint === normalizedLocalEndpoint &&
    localLlmStatus.model === normalizedLocalModel ? localLlmStatus : null;
  const isOpenClawTarget =
    config.transcriptTarget === "openclaw-agent" ||
    config.transcriptTarget === "openclaw-speech";
  const nativePreviewDisabled = Boolean(nativeMicrophone && nativeMicrophone.mode !== "webkit");
  const [localModelOpen, setLocalModelOpen] = useState(config.transcriptTarget === "local-agent" || config.transcriptEnhancement === "conservative");
  const [openClawOpen, setOpenClawOpen] = useState(isOpenClawTarget);
  const hotkeyDirty = hotkeyDraft !== config.hotkey;
  const localModelDirty = localLlmEndpointDraft !== config.localLlmEndpoint || localLlmModelDraft !== (config.localLlmModel ?? "");
  const openClawDirty = openClawAgentDraft !== config.openclawAgent || openClawPromptDraft !== config.openclawPromptPrefix;
  const hasUnsavedChanges = hotkeyDirty || localModelDirty || openClawDirty;
  const dictationBusy = dictationStatus === "starting" || dictationStatus === "recording" || dictationStatus === "processing";
  const inputSourceReady = runtimeDiagnostics?.ownedPreedit.setupState === "ready";
  const [previewLevel, setPreviewLevel] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [microphoneRetryRevision, setMicrophoneRetryRevision] = useState(0);
  const previewRetryRequest = useRef(0);
  useEffect(() => {
    previewRetryRequest.current += 1;
    return () => { previewRetryRequest.current += 1; };
  }, [selectedDeviceId, surface, onboardingStep, activeSection, isRealtimeActive]);
  const retryMicrophone = async () => {
    const request = ++previewRetryRequest.current;
    if (await onRequestMicrophoneAccess() === true && request === previewRetryRequest.current) {
      setMicrophoneRetryRevision((revision) => revision + 1);
    }
  };
  const selectedDeviceLabel = microphoneLabel(nativeMicrophone?.mode, nativeMicrophone?.selected, selectedDeviceId, availableDevices);
  const shortcut = shortcutPresentation(config.hotkey, runtimeDiagnostics?.shortcut);
  const updateInstallCopy = useMemo(() => {
    switch (config.installChannel) {
      case "appimage":
        return "AppImage publication is paused while its packaging toolchain is being pinned. Move to the verified GitHub Release .deb or rebuild from source for updates.";
      case "source":
        return "This build is treated as self-managed from source. Pull the repo and rebuild when you want to update.";
      case "flatpak":
        return "Flatpak distribution is not currently verified. Choose GitHub Release (.deb) or Source for accurate update instructions.";
      case "snap":
        return "Snap distribution is not currently verified. Choose GitHub Release (.deb) or Source for accurate update instructions.";
      default:
        return "This build is treated as a GitHub Release install. Download and install the next release manually.";
    }
  }, [config.installChannel]);
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
        return "Update checks run against GitHub Releases for the selected channel.";
    }
  }, [config.updateChannel, updateState.error, updateState.latestRelease?.version, updateState.status]);
  const upgradePrompt = useMemo(() => {
    if (updateState.status !== "available" || !updateState.latestRelease) {
      return null;
    }

    switch (config.installChannel) {
      case "appimage":
        return `AppImage publication is paused. Install the verified ${updateState.latestRelease.version} .deb from GitHub Releases or rebuild that tag from source.`;
      case "source":
        return `Pull the repo, checkout ${updateState.latestRelease.version} or newer, and rebuild locally.`;
      case "flatpak":
        return "This legacy Flatpak setting is not a verified update path. Use the GitHub release instead.";
      case "snap":
        return "This legacy Snap setting is not a verified update path. Use the GitHub release instead.";
      default:
        return `Download the ${updateState.latestRelease.version} release from GitHub and install it over your current build.`;
    }
  }, [config.installChannel, updateState.latestRelease, updateState.status]);
  const lastCheckedLabel = useMemo(() => {
    if (!updateState.lastCheckedAt) {
      return "Not checked yet";
    }
    return new Date(updateState.lastCheckedAt).toLocaleString();
  }, [updateState.lastCheckedAt]);
  const panelTitle = isOnboarding
    ? "VOCO"
    : isPopover
      ? "VOCO"
      : "VOCO settings";
  const panelEyebrow = isOnboarding ? "Setup" : isPopover ? "Command panel" : "VOCO";
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
    if (
      runtimeDiagnostics.typeSimulation.available &&
      runtimeDiagnostics.typeSimulation.optionalMissingCommands.length > 0
    ) {
      return `Degraded: ${runtimeDiagnostics.typeSimulation.optionalMissingCommands.join(", ")}`;
    }
    return runtimeDiagnostics.typeSimulation.available
      ? "Ready"
      : `Missing: ${runtimeDiagnostics.typeSimulation.missingCommands.join(", ")}`;
  }, [runtimeDiagnostics]);
  const clipboardLabel = useMemo(() => {
    if (!runtimeDiagnostics) {
      return "Runtime checks unavailable.";
    }
    return runtimeDiagnostics.clipboard.available
      ? "Ready"
      : `Missing: ${runtimeDiagnostics.clipboard.missingCommands.join(", ")}`;
  }, [runtimeDiagnostics]);
  const ownedPreeditLabel = useMemo(() => {
    if (!runtimeDiagnostics) {
      return "Runtime checks unavailable.";
    }
    switch (runtimeDiagnostics.ownedPreedit.setupState) {
      case "ready":
        return "Ready";
      case "safety-disabled":
        return "Manual copy available";
      case "not-enabled":
        return "Input source not enabled";
      case "not-installed":
        return "Input source not installed";
      case "incompatible":
        return "Package refresh required";
      case "runtime-unavailable":
        return "Desktop session unavailable";
      default:
        return runtimeDiagnostics.ownedPreedit.available
          ? "Ready"
          : "Unavailable (preview-only fallback)";
    }
  }, [runtimeDiagnostics]);
  const effectiveDeliveryLabel = useMemo(() => {
    if (config.transcriptTarget !== "cursor") {
      return "One final response is delivered after the selected local or OpenClaw action.";
    }
    if (config.transcriptEnhancement !== "off") {
      return "Live transcript panel, then an enhanced result for Copy or the authorized browser field.";
    }
    switch (config.liveCursorMode) {
      case "stable-cursor-streaming":
        return "Canonical checkpoints in supported browser fields; a transcript for Copy elsewhere.";
      case "preview-overlay-only":
        return "Live transcript panel, then a final result for Copy or the authorized browser field.";
      case "final-text-only":
        return "No live preview; one final transcript for Copy or the authorized browser field.";
    }
  }, [config.liveCursorMode, config.transcriptEnhancement, config.transcriptTarget]);
  useEffect(() => {
    if (config.transcriptTarget === "local-agent" || config.transcriptEnhancement === "conservative") setLocalModelOpen(true);
  }, [config.transcriptTarget, config.transcriptEnhancement]);
  useEffect(() => { if (isOpenClawTarget) setOpenClawOpen(true); }, [isOpenClawTarget]);
  useEffect(() => {
    if (confirmHide) headingContainerRef.current?.querySelector<HTMLElement>('[aria-label="Unsaved changes"]')?.focus();
  }, [confirmHide]);

  useEffect(() => {
    onDraftStateChange?.(hasUnsavedChanges);
    return () => onDraftStateChange?.(false);
  }, [hasUnsavedChanges, onDraftStateChange]);

  useEffect(() => {
    if (previousCloseRequestRef.current !== closeRequestId && hasUnsavedChanges) setConfirmHide(true);
    previousCloseRequestRef.current = closeRequestId;
  }, [closeRequestId, hasUnsavedChanges]);

  useEffect(() => () => onShortcutCaptureChange?.(false), [onShortcutCaptureChange]);

  useEffect(() => {
    headingContainerRef.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [surface, onboardingStep, activeSection]);

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
    setHotkeyDraft(config.hotkey);
    setHotkeyError(null);
  }, [config.hotkey]);

  useEffect(() => {
    setOpenClawAgentDraft(config.openclawAgent);
    setOpenClawPromptDraft(config.openclawPromptPrefix);
    setOpenClawError(null);
  }, [config.openclawAgent, config.openclawPromptPrefix]);

  useEffect(() => {
    setLocalLlmEndpointDraft(config.localLlmEndpoint);
    setLocalLlmModelDraft(config.localLlmModel ?? "");
    // A config echo can arrive after a fast test result in the same React batch.
    // Keep the result bound to its tested target; the render hides it for other drafts.
  }, [config.localLlmEndpoint, config.localLlmModel]);

  useEffect(() => {
    const shouldPreview = shouldOpenMicrophonePreview(
      surface,
      onboardingStep,
      activeSection,
      isRealtimeActive,
      dictationBusy ? "recording" : "idle",
    );
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
  }, [activeSection, dictationBusy, isRealtimeActive, onboardingStep, selectedDeviceId, surface, microphoneRetryRevision, nativePreviewDisabled]);

  useEffect(() => {
    copyRequestRef.current += 1;
    setCopyStatus(null);
  }, [cursorDeliveryState, dictationStatus, transcript]);

  useEffect(() => {
    if (!isRealtimeActive) {
      return;
    }
    microphoneSaveRequestRef.current += 1;
    setMicrophoneSaveError(null);
    setPreviewError(null);
    setPreviewLevel(0);
  }, [isRealtimeActive]);

  async function savePatch(
    patch: Partial<AppConfig>,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    setSavingCount((count) => count + 1);
    setSaveFeedback(null);
    try {
      await onConfigChange(patch);
      setSaveFeedback("Saved on this device.");
      return { ok: true };
    } catch (error) {
      setSaveFeedback("Changes could not be saved. Review the error and try again.");
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "VOCO could not save those settings.",
      };
    } finally {
      setSavingCount((count) => Math.max(0, count - 1));
    }
  }

  async function selectMicrophone(deviceId: string | null): Promise<void> {
    if (isRealtimeActive) {
      setMicrophoneSaveError("Stop realtime to change microphone.");
      return;
    }
    const requestId = microphoneSaveRequestRef.current + 1;
    microphoneSaveRequestRef.current = requestId;
    setMicrophoneSaveError(null);
    const result = await savePatch({ selectedMic: deviceId });
    if (microphoneSaveRequestRef.current !== requestId) {
      return;
    }
    if (!result.ok) {
      setMicrophoneSaveError(result.message);
    }
  }

  async function retryMicrophonePreview() {
    try { await retryMicrophone(); }
    catch (error) { setPreviewError(error instanceof Error ? error.message : "Microphone access failed."); }
  }

  async function copyRecoveredTranscript(entry: RecoverableTranscript | string = transcript): Promise<void> {
    const copiedTranscript = typeof entry === "string" ? entry : entry.text;
    const entryId = typeof entry === "string" ? "current" : entry.id;
    const requestId = copyRequestRef.current + 1;
    copyRequestRef.current = requestId;
    try {
      await navigator.clipboard.writeText(copiedTranscript);
      if (
        copyRequestRef.current !== requestId ||
        (typeof entry === "string" && latestTranscriptRef.current !== copiedTranscript && latestRawTranscriptRef.current !== copiedTranscript)
      ) {
        return;
      }
      setCopyStatus({ id: entryId, text: "Copied to clipboard. The transcript stays here until you dismiss it." });
    } catch (error) {
      if (
        copyRequestRef.current !== requestId ||
        (typeof entry === "string" && latestTranscriptRef.current !== copiedTranscript && latestRawTranscriptRef.current !== copiedTranscript)
      ) {
        return;
      }
      setCopyStatus({ id: entryId, text: `Copy failed: ${error instanceof Error ? error.message : String(error)}` });
    }
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
    if (hasUnsavedChanges) { setConfirmHide(true); return; }
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
    if (hasUnsavedChanges) setConfirmHide(true);
    else hidePanel();
  }

  async function saveAndHide() {
    if (hotkeyDirty && !(await saveHotkey())) return;
    if (localModelDirty && !(await saveLocalLlmSettings())) return;
    if (openClawDirty && !(await saveOpenClawSettings())) return;
    hidePanel();
  }

  async function prepareFirstDictation(previewOnly = false) {
    if (saving || dictationBusy || isRealtimeActive) return;
    const result = await savePatch({ onboardingCompleted: true, voiceProfile: "default",
      transcriptTarget: "cursor", transcriptEnhancement: "off",
      liveCursorMode: previewOnly ? "preview-overlay-only" : "stable-cursor-streaming" });
    if (result.ok) {
      onDraftStateChange?.(false);
      if (onPrepareDictation) onPrepareDictation();
      else hidePanel();
    }
  }

  async function saveHotkey(): Promise<boolean> {
    const normalizedHotkey = hotkeyDraft.trim() || "Alt+D";
    setHotkeyDraft(normalizedHotkey);
    setHotkeyError(null);
    // The native shortcut parser validates supported aliases and reserved shortcuts.
    const result = await savePatch({ hotkey: normalizedHotkey });
    if (result.ok) {
      return true;
    }

    setHotkeyError(result.message);
    return false;
  }

  async function saveOpenClawSettings(): Promise<boolean> {
    const normalizedAgent = openClawAgentDraft.trim() || "main";
    setOpenClawAgentDraft(normalizedAgent);
    setOpenClawError(null);

    const result = await savePatch({
      openclawAgent: normalizedAgent,
      openclawPromptPrefix: openClawPromptDraft,
    });
    if (result.ok) {
      return true;
    }

    setOpenClawError(result.message);
    return false;
  }

  async function saveLocalLlmSettings(): Promise<boolean> {
    const normalizedEndpoint =
      localLlmEndpointDraft.trim() ||
      "http://127.0.0.1:8080/v1/chat/completions";
    const normalizedModel = localLlmModelDraft.trim();
    setLocalLlmEndpointDraft(normalizedEndpoint);
    setLocalLlmModelDraft(normalizedModel);
    setLocalLlmStatus(null);

    const result = await savePatch({
      localLlmEndpoint: normalizedEndpoint,
      localLlmModel: normalizedModel.length > 0 ? normalizedModel : null,
    });
    if (result.ok) {
      return true;
    }

    setLocalLlmStatus({ kind: "error", detail: result.message, endpoint: normalizedEndpoint, model: normalizedModel || null });
    return false;
  }

  async function testLocalModelConnection(): Promise<void> {
    setLocalModelOpen(true);
    const saved = await saveLocalLlmSettings();
    if (!saved) {
      return;
    }

    const endpoint =
      localLlmEndpointDraft.trim() ||
      "http://127.0.0.1:8080/v1/chat/completions";
    const model =
      localLlmModelDraft.trim().length > 0 ? localLlmModelDraft.trim() : null;
    setTestingLocalModel(true);
    try {
      const result = await testLocalLlm(endpoint, model);
      setLocalLlmStatus({ kind: result.ok ? "ok" : "error", detail: formatLocalModelTestStatus(endpoint, result), endpoint, model });
    } catch (error) {
      setLocalLlmStatus({ kind: "error", detail: error instanceof Error ? error.message : "The local model test failed.", endpoint, model });
    } finally {
      setTestingLocalModel(false);
    }
  }

  const outputSummary = config.transcriptTarget === "local-agent" ? "Local model answer"
    : config.transcriptTarget === "openclaw-agent" ? "OpenClaw answer"
    : config.transcriptTarget === "openclaw-speech" ? "OpenClaw spoken answer"
    : config.transcriptEnhancement !== "off" ? "Enhanced text for Copy or browser delivery"
    : config.liveCursorMode === "stable-cursor-streaming" ? "Browser checkpoints; Copy in other apps"
    : config.liveCursorMode === "preview-overlay-only" ? "Transcript panel, then Copy or browser delivery"
    : "Final text for Copy or browser delivery";

  function renderAppearanceRows() {
    return <div className="voco-preferences__card">
      <div className="voco-preferences__row">
        <span className="voco-preferences__badge"><SettingsIcon name="motion" /></span>
        <span className="voco-preferences__row-copy"><strong>Reduce motion</strong><small>System setting</small></span>
        <span className="voco-preferences__row-value">{systemReducedMotion === null ? "Unavailable" : systemReducedMotion ? "On" : "Off"}</span>
      </div>
    </div>;
  }

  function renderSettingsNavigation(section: PanelSection) {
    return <button key={section} className="voco-preferences__nav-item"
      aria-current={activeSection === section ? "page" : undefined}
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
        selector = 'input[aria-describedby="voco-hotkey-feedback"]';
      } else if (localModelDirty) {
        setActiveSection("Integrations");
        setLocalModelOpen(true);
        selector = localLlmEndpointDraft !== config.localLlmEndpoint ? "#voco-local-endpoint" : "#voco-local-model";
      } else if (openClawDirty) {
        setActiveSection("Integrations");
        setOpenClawOpen(true);
        selector = openClawAgentDraft !== config.openclawAgent ? "#voco-openclaw-agent" : "#voco-openclaw-prefix";
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
    <main className="voco-panel" data-surface={surface} data-visual-effects="full" ref={headingContainerRef}>
      <section className="voco-panel__shell">
        {surface !== "settings" ? <header
          className="voco-panel__hero"
          data-tauri-drag-region
          onMouseDown={(event) => void handleHeaderPointerDown(event)}
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
              {isOnboarding ? <p className="voco-panel__eyebrow">{panelEyebrow}</p> : null}
              <h1 className="voco-panel__title">{panelTitle}</h1>
            </div>
          </div>
          <div className="voco-panel__hero-actions">
            {isPopover ? <button className="voco-glass voco-icon-button" aria-label="Settings" title="Settings" onClick={() => void onOpenSettings()}>
              <img src="/icons/settings.svg" className="voco-ui-icon" alt="" />
            </button> : <button
              className="voco-button voco-button--ghost voco-button--compact"
              onClick={requestHide}
            >
              Hide to tray
            </button>}
          </div>
        </header> : null}

        <div className="voco-panel__error-slot">
        {confirmHide ? <section className="voco-unsaved-notice" role="alert" aria-label="Unsaved changes" tabIndex={-1}>
          <strong>You have unsaved text changes.</strong>
          <p>Save them before hiding VOCO, or discard the edits.</p>
          <div className="voco-settings__actions">
            <button className="voco-button voco-button--primary" disabled={saving} onClick={() => void saveAndHide()}>Save and hide</button>
            <button className="voco-button voco-button--secondary" disabled={saving} onClick={hidePanel}>Discard and hide</button>
            <button className="voco-button voco-button--ghost" onClick={keepEditing}>Keep editing</button>
          </div>
        </section> : null}
          {errorMessage ? (
            <section className="voco-panel__error" aria-live="polite">
              {errorMessage}
            </section>
          ) : null}
        </div>

        {isPopover ? (
          <section className="voco-popover" data-priority={hasRecoverableTranscript || dictationBusy || isRealtimeActive || statusLabel.length > 30 ? "status" : undefined}>
            <div className="voco-lens" aria-hidden="true">
              {isRealtimeActive ? <RealtimeMicVisual active={!isRealtimeMuted} level={isRealtimeMuted || systemReducedMotion ? 0 : realtimeLevel} status={realtimeStatus} /> : <img src={vocoBrandImage} alt="" />}
            </div>
            <div className="voco-popover__state">
              <div className="voco-popover__state-main">
                <strong role="status" aria-live="polite">{statusLabel === "Ready to listen" ? "Ready" : statusLabel}</strong>
                <kbd className="voco-glass voco-shortcut">{config.hotkey}</kbd>
              </div>
              {isRealtimeActive ? <p>{isRealtimeMuted ? "Microphone muted" : realtimeDetail}</p> : dictationBusy ?
                <p>{dictationStatus === "starting" ? "Wait for Listening before speaking." : dictationStatus === "recording" ? `Press ${config.hotkey} to finish.` : "Finishing your dictation…"}</p> :
                <p>{config.transcriptTarget === "openclaw-speech" ? "Hide, then press your shortcut to speak." : "Hide, then focus a text field."}</p>}
              {config.transcriptTarget !== "cursor" ? <span className="voco-popover__mode">{config.transcriptTarget === "local-agent" ? "Local model response" : config.transcriptTarget === "openclaw-speech" ? "OpenClaw spoken response" : "OpenClaw response"}</span> : null}
            </div>
            {captureNotice ? <div className="voco-inline-note" role="status">{captureNotice}</div> : null}
            {(canCancelDictation || cancellationPending) ? (
              <button className="voco-button voco-button--secondary" type="button" onClick={onCancelDictation} disabled={!canCancelDictation}>
                {cancellationPending ? "Cancelling output…" : "Cancel dictation"}
              </button>
            ) : null}
            {hasCurrentRecovery ? (
              <div className="voco-popover__recovery" data-kind={recovery?.kind ?? "failure"} role="status">
                <strong>
                  {transcript
                    ? recovery?.kind === "manual-copy" ? "Transcript ready to copy"
                      : cursorDeliveryState === "unreconciled" ? "Transcript kept safely in VOCO"
                        : "Latest transcript available to recover"
                    : recovery?.audioAvailable ? "Recording available to recover"
                      : "Recording needs attention"}
                </strong>
                <span>
                  {recovery?.reason ?? (cursorDeliveryState === "unreconciled"
                    ? "Cursor delivery could not be verified. Review the target before copying any missing text."
                    : "The selected output did not complete. Confirm this is your latest dictation, then copy it before trying again.")}
                </span>
                {transcript ? <p>{transcript}</p> : <span>No completed transcript is available yet.</span>}
                {recovery?.targetMayContainText ? <span>The original field may already contain part of this transcript. Recovery never inserts automatically.</span> : null}
                {recovery?.audioAvailable ? <span>Audio stays only in memory until recovery is completed, discarded, or VOCO closes.</span> : null}
                <div className="voco-popover__recovery-actions">
                {transcript ? <button
                  className="voco-button voco-button--primary"
                  type="button"
                  onClick={() => void copyRecoveredTranscript()}
                  disabled={recovery?.retrying}
                >
                  Copy transcript
                </button> : null}
                {rawTranscript && rawTranscript !== transcript ? <button className="voco-button voco-button--secondary" type="button" onClick={() => void copyRecoveredTranscript(rawTranscript)} disabled={recovery?.retrying}>
                  Copy original recognition
                </button> : null}
                {recovery?.audioAvailable ? <button className="voco-button voco-button--secondary" type="button" onClick={onRetryRecovery} disabled={recovery.retrying}>
                  {recovery.retrying ? "Recovering…" : "Retry transcription"}
                </button> : null}
                {recovery ? <button className="voco-button voco-button--ghost" type="button" onClick={onDiscardRecovery} disabled={recovery.retrying}>
                  {recovery.kind === "manual-copy" ? "Clear transcript" : "Discard recovery"}
                </button> : null}
                </div>
                {copyStatus?.id === "current" ? <span>{copyStatus.text}</span> : null}
                {recovery ? <span>{recovery.kind === "manual-copy" ? "Copy your text, then clear this transcript to start another recording." : "Copy any text you need, then discard this recovery to start another recording."}</span> : null}
              </div>
            ) : null}
            <div className="voco-inline-note voco-popover__dictation-hint">
              {shortcut.instruction} In an enabled Chromium tab, focus a plain text field and press <code>Alt+Shift+V</code> for direct delivery.
            </div>
            {!hasCurrentRecovery && recoveryEntries.length > 0 ? <section className="voco-popover__recovery" aria-label="Saved transcripts" role="region">
              <h2 tabIndex={-1}>Transcript kept safely in VOCO</h2>
              <p>{recoveryEntries.length} transcript{recoveryEntries.length === 1 ? "" : "s"} available to recover. Kept until VOCO exits.</p>
              {recoveryEntries.map((entry, index) => <article key={entry.id} className="voco-recovery-entry">
                <strong>Transcript {index + 1}{entry.createdAt > 0 ? ` · ${new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</strong>
                {entry.isPartial ? <strong>Partial transcript — final transcription did not finish.</strong> : null}
                <p>{entry.reason === "delivery-unconfirmed" ? "Some words may already be in your text field. Review it before pasting to avoid duplicates." : "The selected output did not complete. Check your text field before pasting; some words may already be there."}</p>
                <p className="voco-recovery-entry__text" tabIndex={0}>{entry.text}</p>
                <div className="voco-settings__actions">
                  <button className="voco-button voco-button--primary" onClick={() => void copyRecoveredTranscript(entry)}>Copy transcript</button>
                  {onDismissRecoverableTranscript && entry.id !== "current" ? <button className="voco-button voco-button--ghost" onClick={() => onDismissRecoverableTranscript(entry.id)}>Dismiss transcript</button> : null}
                </div>
                {copyStatus?.id === entry.id ? <span role="status">{copyStatus.text}</span> : null}
              </article>)}
            </section> : null}
            <div className="voco-popover__actions">
              <button {...glassPointer} className="voco-button voco-glass voco-glass--primary" disabled={saving || dictationBusy || isRealtimeActive}
                onClick={prepareDictation}>Hide to dictate</button>
            </div>
            <div className="voco-popover__footer">
              <button className="voco-device-picker" title={`Microphone: ${selectedDeviceLabel}`} aria-label={`Microphone: ${selectedDeviceLabel}`} onClick={() => void onOpenSettings("Audio")}>
                <span>{selectedDeviceLabel}</span><img src="/icons/chevron-right.svg" className="voco-ui-icon" alt="" />
              </button>
              <details className="voco-more" open={isRealtimeActive || realtimeStatus === "error" || undefined}
                onKeyDown={(event) => { if (event.key === "Escape" && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
                <summary>More<img src="/icons/chevron-right.svg" className="voco-ui-icon" alt="" /></summary>
                <div className="voco-more__content voco-glass">
                  <details className="voco-optional-feature">
                    <summary>How to dictate</summary>
                    <ol className="voco-dictation-guide">
                      <li>{config.transcriptTarget === "openclaw-speech" ? "Hide this panel." : "Hide this panel and focus a text field."}</li>
                      <li>Press <kbd>{config.hotkey}</kbd>. Wait for Listening, then speak.</li>
                      <li>Press <kbd>{config.hotkey}</kbd> again to finish.</li>
                    </ol>
                  </details>
                  <button className="voco-button voco-button--ghost" onClick={() => void onRefreshDevices()}>Refresh microphones</button>
                  <details className="voco-optional-feature" open={isRealtimeActive || realtimeStatus === "error" || undefined}>
                    <summary>Realtime conversation · optional</summary>
                    <p>Streams microphone audio to OpenAI while active. Normal dictation stays on your device.</p>
                    <p>Shortcut: <kbd>Alt+Shift+R</kbd></p>
                    <p role="status">Realtime: {isRealtimeMuted ? "Muted" : realtimeDetail}{realtimeError ? ` ${realtimeError}` : ""}</p>
                    <button className="voco-button voco-button--secondary" onClick={onToggleRealtime}
                      disabled={dictationBusy || (!isRealtimeActive && !realtimeActivationAllowed)}>
                      {isRealtimeActive ? "Stop realtime" : "Start realtime"}
                    </button>
                    {!realtimeActivationAllowed && !isRealtimeActive ? <p>Resolve the current readiness issue before starting a conversation.</p> : null}
                  </details>
                </div>
              </details>
            </div>
            {microphoneSaveError ? <p className="voco-inline-note voco-inline-note--error" role="alert">{microphoneSaveError}</p> : null}
          </section>
        ) : isOnboarding ? (
          <section className="voco-panel__content">
            <ol className="voco-onboarding__progress" aria-label="Setup progress">
              {["Welcome", "Microphone", "First dictation"].map((label, step) => <li key={label}
                className="voco-onboarding__progress-item" aria-current={onboardingStep === step ? "step" : undefined}>
                <span className={`voco-onboarding__dot ${onboardingStep === step ? "voco-onboarding__dot--active" : onboardingStep > step ? "voco-onboarding__dot--complete" : ""}`} aria-hidden="true" />
                <span className="voco-onboarding__step-label">{step + 1}. {label}</span>
              </li>)}
            </ol>

            {onboardingStep === 0 ? (
              <section className="voco-onboarding__step">
                <h2 tabIndex={-1}>Welcome to VOCO</h2>
                <p>
                  Your voice, typed. Built for Linux.
                </p>
                <div className="voco-onboarding__actions">
                  <button
                    className="voco-button voco-button--primary"
                    onClick={() => onOnboardingStepChange(1)}
                  >
                    Start setup
                  </button>
                  <button
                    className="voco-button voco-button--secondary"
                    disabled={saving}
                    onClick={async () => {
                      const result = await savePatch({ onboardingCompleted: true });
                      if (result.ok) hidePanel();
                    }}
                  >
                    Set up later
                  </button>
                </div>
              </section>
            ) : null}

            {onboardingStep === 1 ? (
              <section className="voco-onboarding__step">
                <h2 tabIndex={-1}>Microphone and hotkey</h2>
                <p>
                  Speak a few words to check your microphone, then choose your dictation shortcut.
                </p>
                {nativeMicrophone && nativeMicrophone.mode !== "webkit" ? (
                  <NativeMicrophoneSettings controls={nativeMicrophone}
                    disabled={isRealtimeActive || ["recording", "processing"].includes(dictationStatus)} />
                ) : <>
                <label className="voco-field">
                  <span>Input device</span>
                  <select
                    value={selectedDeviceId ?? ""}
                    disabled={saving || isRealtimeActive || dictationBusy}
                    onChange={(event) =>
                      void selectMicrophone(event.target.value || null)
                    }
                  >
                    <option value="">System default</option>
                    {availableDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                </label>
                {isRealtimeActive ? (
                  <div className="voco-inline-note">
                    Stop realtime to change microphone. Audio preview is paused while
                    realtime owns the microphone.
                  </div>
                ) : null}
                <div className="voco-inline-note" role="status">
                  <strong>Microphone:</strong> {selectedDeviceLabel} · {microphoneChecked ? "Audio detected" : "Waiting for audio"}
                </div>
                <div className="voco-meter">
                  <span className="voco-meter__label">Live level</span>
                  <div className="voco-meter__track" aria-hidden="true">
                    <div
                      className="voco-meter__fill"
                      style={{ transform: `scaleX(${previewLevel})` }}
                    />
                  </div>
                  <span className="voco-meter__hint">
                    Speak normally. The bar should move. Audio here is a microphone check, not a dictation test.
                  </span>
                </div>
                </>}
                <label className="voco-field">
                  <span>Dictation shortcut</span>
                  <input
                      disabled={saving}
                    value={recordingShortcut ? "Press your shortcut…" : hotkeyDraft}
                    aria-invalid={Boolean(hotkeyError)} aria-describedby="voco-hotkey-feedback"
                    onBlur={() => { if (recordingShortcut) endShortcutCapture(); }}
                    onChange={(event) => setHotkeyDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (recordingShortcut) { captureShortcut(event); return; }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveHotkey();
                      }
                    }}
                  />
                </label>
                <button className="voco-button voco-button--secondary" disabled={saving} onClick={beginShortcutCapture}>Record shortcut</button>
                <p id="voco-hotkey-feedback" role="status">{hotkeyError ?? (recordingShortcut ? "Press a modifier and key. Escape cancels." : shortcut.instruction)}</p>
                {previewError ? (
                  <div className="voco-inline-note voco-inline-note--error" role="alert">
                    {previewError}
                  </div>
                ) : null}
                {microphoneSaveError ? (
                  <div className="voco-inline-note voco-inline-note--error" role="alert">
                    {microphoneSaveError}
                  </div>
                ) : null}
                <div className="voco-onboarding__actions">
                  {(!nativeMicrophone || nativeMicrophone.mode === "webkit") ? (
                  <button
                    className="voco-button voco-button--ghost"
                    onClick={() => void retryMicrophonePreview()}
                    disabled={isRealtimeActive || dictationBusy}
                  >
                    Retry microphone access
                  </button>
                  ) : null}
                  <button
                    className="voco-button voco-button--secondary"
                    onClick={() => onOnboardingStepChange(0)}
                  >
                    Back
                  </button>
                  <button
                    className="voco-button voco-button--primary"
                    onClick={async () => {
                      const hotkeySaved = await saveHotkey();
                      if (hotkeySaved) {
                        onOnboardingStepChange(2);
                      }
                    }}
                    disabled={saving || dictationBusy || isRealtimeActive || !microphoneChecked || Boolean(previewError)}
                  >
                    Continue
                  </button>
                  <button className="voco-button voco-button--ghost" disabled={saving} onClick={async () => { if (await saveHotkey()) onOnboardingStepChange(2); }}>Set up microphone later</button>
                </div>
              </section>
            ) : null}

            {onboardingStep === 2 ? (
              <section className="voco-onboarding__step">
                <h2 tabIndex={-1}>Try your first dictation</h2>
                <div className="voco-readiness" aria-label="Dictation readiness">
                  <p className="voco-readiness__item" role="status" data-ready={microphoneChecked}>Microphone: {microphoneChecked ? "audio detected in setup" : "not checked yet"}</p>
                  <p className="voco-readiness__item" data-ready={inputSourceReady}>Recording integration: {ownedPreeditLabel}</p>
                  <p role="status">First dictation: {lastDictationResult?.outcome === "delivered" ? "a delivery completed this session; check the words in your text field" : "not yet verified"}</p>
                </div>
                <p>These trials use plain dictation with enhancement off.</p>
                <div className="voco-onboarding__actions">
                  <button className="voco-button voco-button--primary" disabled={saving || dictationBusy || isRealtimeActive || !microphoneChecked}
                    onClick={() => void prepareFirstDictation()}>Hide and try dictation</button>
                  <button className="voco-button voco-button--secondary" disabled={saving || dictationBusy || isRealtimeActive || !microphoneChecked}
                    onClick={() => void prepareFirstDictation(true)}>Try transcript panel instead</button>
                </div>
                <ol className="voco-dictation-guide">
                  <li>Hide this panel. The recording shortcut produces a transcript to copy.</li>
                  <li>Press <code>{config.hotkey}</code>, wait for Listening, then speak.</li>
                  <li>Press <code>{config.hotkey}</code> again, choose Copy transcript, paste into your app, then clear the transcript.</li>
                </ol>
                <details className="voco-settings__group" open={!inputSourceReady || undefined}>
                  <summary>Recording shortcuts and browser delivery</summary>
                  <p>{shortcut.instruction} {shortcut.setup} The optional VOCO Dictation input source supports recording shortcuts. It does not insert text. VOCO never switches it automatically.</p>
                  <p>{runtimeDiagnostics?.ownedPreedit.detail ?? "Refresh after selecting VOCO Dictation. Without it, recordings stay safely preview-only."}</p>
                  <p>For direct delivery, enable the packaged Chromium extension for your tab, focus a plain text field and press Alt+Shift+V. Passwords and rich editors are unsupported; browser undo history is not guaranteed.</p>
                  <button className="voco-button voco-button--secondary" onClick={() => void onRefreshRuntimeDiagnostics()}>Refresh input-source status</button>
                </details>
                <details className="voco-settings__group">
                  <summary>Tray states and checking your result</summary>
                  <div className="voco-tray-legend" aria-label="Tray icon states">
                    {TRAY_STATE_LEGEND.map((item) => <article key={item.label} className="voco-tray-legend__item">
                      <div className="voco-tray-legend__icon" aria-hidden="true"><img src={item.image} alt="" /></div>
                      <span>{item.label}</span>
                    </article>)}
                  </div>
                  <p>Reopen Overview from the tray to review the last delivery or recover your transcript.
                    Setup checks do not prove words reached your text field.</p>
                </details>
                <div className="voco-onboarding__actions">
                  <button className="voco-button voco-button--secondary" onClick={() => onOnboardingStepChange(1)}>Back</button>
                  <button className="voco-button voco-button--ghost" disabled={saving}
                    onClick={async () => { const result = await savePatch({ onboardingCompleted: true }); if (result.ok) hidePanel(); }}>Set up later</button>
                </div>
              </section>
            ) : null}
          </section>
        ) : (
          <section className="voco-settings voco-preferences">
            <aside className="voco-preferences__sidebar">
              <div className="voco-preferences__brand" data-tauri-drag-region onMouseDown={(event) => void handleHeaderPointerDown(event)}>
                <img src={vocoBrandImage} alt="" /><h1>VOCO</h1>
              </div>
              <nav className="voco-preferences__nav" aria-label="Settings sections">
                {PANEL_SECTIONS.filter((section) => section !== "Updates" && section !== "Advanced").map(renderSettingsNavigation)}
              </nav>
              <nav className="voco-preferences__nav-bottom" aria-label="App settings">
                {(["Updates", "Advanced"] as const).map(renderSettingsNavigation)}
              </nav>
            </aside>

            <div className="voco-preferences__content">
              <div className="voco-preferences__window-actions"><button className="voco-button voco-button--ghost voco-button--compact" onClick={requestHide}>Hide to tray</button></div>
              {activeSection === "General" ? (
                <section className="voco-preferences__page">
                  <div className="voco-preferences__heading"><h2 tabIndex={-1}>Overview</h2><p className="voco-preferences__status" role="status">{statusLabel}</p></div>
                  {hasRecoverableTranscript ? <div className="voco-preferences__recovery" role="status">
                    <strong>{hasCurrentRecovery ? recovery?.kind === "manual-copy" ? "Transcript ready to copy" : "Recording needs recovery" : recoveryEntries.length === 1 ? "A transcript needs attention" : `${recoveryEntries.length} transcripts need attention`}</strong>
                    <p>Kept in VOCO until you dismiss them or exit the app.</p>
                    <button className="voco-button voco-button--secondary" onClick={() => onSurfaceChange("popover")}>Review saved transcripts</button>
                  </div> : null}
                  <div className="voco-preferences__group">
                    <h3 className="voco-preferences__group-title">Your setup</h3>
                    <div className="voco-preferences__card">
                      <button className="voco-preferences__row voco-preferences__row--link" onClick={() => setActiveSection("Audio")}>
                        <span className="voco-preferences__badge"><SettingsIcon name="Audio" /></span>
                        <span className="voco-preferences__row-copy"><strong>Microphone</strong><small>{selectedDeviceLabel}</small></span>
                        <span className="voco-preferences__chevron" aria-hidden="true"><SettingsIcon name="chevron" /></span>
                      </button>
                      <button className="voco-preferences__row voco-preferences__row--link" onClick={() => setActiveSection("Hotkeys")}>
                        <span className="voco-preferences__badge"><SettingsIcon name="Hotkeys" /></span>
                        <span className="voco-preferences__row-copy"><strong>Shortcut</strong></span>
                        <kbd className="voco-preferences__row-value">{config.hotkey}</kbd><span className="voco-preferences__row-action">Change</span>
                      </button>
                      <button className="voco-preferences__row voco-preferences__row--link" onClick={() => setActiveSection("Output")}>
                        <span className="voco-preferences__badge"><SettingsIcon name="output" /></span>
                        <span className="voco-preferences__row-copy"><strong>Output</strong><small>{outputSummary}</small></span>
                        <span className="voco-preferences__chevron" aria-hidden="true"><SettingsIcon name="chevron" /></span>
                      </button>
                    </div>
                  </div>
                  <div className="voco-preferences__group"><h3 className="voco-preferences__group-title">Appearance</h3>{renderAppearanceRows()}</div>
                  <div className="voco-preferences__actions">
                    <button className="voco-button voco-button--primary" disabled={saving || dictationBusy || isRealtimeActive} onClick={prepareDictation}><SettingsIcon name="Audio" />Hide to dictate</button>
                  </div>
                  <p className="voco-preferences__helper">{shortcut.instruction}</p>
                  {!hasRecoverableTranscript && lastDictationResult?.outcome === "delivered" ? <p className="voco-preferences__helper" role="status">A dictation was delivered this session. {config.transcriptTarget === "openclaw-speech" ? "Check the spoken result." : "Check your text field to confirm the result."}</p> : null}
                </section>
              ) : null}

              {activeSection === "Audio" ? (
                <section className="voco-preferences__page">
                  <div className="voco-preferences__heading"><h2 tabIndex={-1}>Microphone</h2></div>
                  {nativePreviewDisabled && nativeMicrophone ? <NativeMicrophoneSettings controls={nativeMicrophone} disabled={isRealtimeActive || dictationBusy} /> : <>
                  <div className="voco-preferences__group"><h3 className="voco-preferences__group-title">Input</h3>
                    <div className="voco-preferences__card voco-preferences__form">
                      <label className="voco-field voco-preferences__field-row"><span>Input device</span>
                        <select value={selectedDeviceId ?? ""} disabled={saving || isRealtimeActive || dictationBusy}
                          onChange={(event) => void selectMicrophone(event.target.value || null)}>
                          <option value="">System default</option>
                          {availableDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
                        </select>
                      </label>
                      {microphoneSaveError ? <div className="voco-inline-note voco-inline-note--error" role="alert">{microphoneSaveError}</div> : null}
                      <div className="voco-preferences__actions"><button className="voco-button voco-button--ghost" onClick={() => void onRefreshDevices()}>Refresh devices</button></div>
                    </div>
                  </div>
                  <div className="voco-preferences__group"><h3 className="voco-preferences__group-title">Sound check</h3>
                    <div className="voco-preferences__card voco-preferences__form">
                      <p className="voco-preferences__status" role="status">{isRealtimeActive ? "Stop realtime to change microphone. Audio preview is paused while realtime owns the microphone." : dictationBusy ? "Microphone check paused during dictation." : previewError || microphonePermission === "denied" ? "Microphone access needs attention." : microphoneChecked ? "Audio detected during this check" : "Waiting for sound"}</p>
                      {!isRealtimeActive && !dictationBusy && !previewError && microphonePermission !== "denied" ? <p className="voco-preferences__helper">Speak a few words. This checks microphone sound, not transcription.</p> : null}
                      <div className="voco-meter"><span className="voco-meter__label">Live level</span>
                        <div className="voco-meter__track" aria-hidden="true"><div className="voco-meter__fill" style={{ transform: `scaleX(${previewLevel})` }} /></div>
                      </div>
                      {previewError ? <div className="voco-inline-note voco-inline-note--error" role="alert">{previewError}</div> : null}
                      {previewError || microphonePermission === "denied" ? <div className="voco-preferences__actions"><button className="voco-button voco-button--secondary" disabled={isRealtimeActive || dictationBusy} onClick={() => void retryMicrophonePreview()}>Retry microphone access</button></div> : null}
                    </div>
                  </div>
                  </>}
                </section>
              ) : null}

              {activeSection === "Output" ? (
                <section className="voco-preferences__page">
                  <div className="voco-preferences__heading"><h2 tabIndex={-1}>Dictation & output</h2></div>
                  <div className="voco-preferences__group"><h3 className="voco-preferences__group-title">Your words</h3>
                    <div className="voco-preferences__card voco-preferences__form">
                      <label className="voco-field voco-preferences__field-row"><span>After transcription</span>
                        <select aria-describedby="voco-target-help" value={config.transcriptTarget} onChange={(event) => void savePatch({ transcriptTarget: event.target.value as AppConfig["transcriptTarget"] })}>
                          <option value="cursor">Transcript for Copy or direct delivery</option><option value="local-agent">Ask local model for a text answer</option><option value="openclaw-agent">Ask OpenClaw for a text answer</option><option value="openclaw-speech">Ask OpenClaw and speak answer</option>
                        </select>
                      </label>
                      <p id="voco-target-help" className="voco-preferences__helper">{config.transcriptTarget === "cursor" ? "Copy your transcript or deliver it to an authorized browser field." : config.transcriptTarget === "local-agent" ? "Ask your local model for an answer to copy or deliver. Configure the model in Integrations." : "Send your transcript to your OpenClaw agent. Configure the agent in Integrations."}</p>
                      {config.transcriptTarget === "cursor" ? <label className="voco-field voco-preferences__field-row"><span>Live cursor mode</span>
                        <select aria-describedby="voco-delivery-help" value={config.liveCursorMode} onChange={(event) => void savePatch({ liveCursorMode: event.target.value as AppConfig["liveCursorMode"] })}>
                          <option value="stable-cursor-streaming">Browser checkpoints (enhancement off)</option><option value="preview-overlay-only">Live transcript panel</option><option value="final-text-only">Final text only</option>
                        </select>
                      </label> : null}
                      <label className="voco-field voco-preferences__field-row"><span>Transcript enhancement</span>
                        <select aria-describedby="voco-enhancement-help voco-delivery-help" value={config.transcriptEnhancement} onChange={(event) => void savePatch({ transcriptEnhancement: event.target.value as AppConfig["transcriptEnhancement"] })}>
                          <option value="off">Off</option><option value="commands-only">Voice formatting commands</option><option value="conservative">Conservative local polish</option>
                        </select>
                      </label>
                      <p id="voco-enhancement-help" className="voco-preferences__helper">{config.transcriptTarget === "cursor" && config.liveCursorMode === "stable-cursor-streaming" && config.transcriptEnhancement !== "off"
                        ? "Enhancement can revise earlier words, so live text stays in VOCO and the enhanced result is inserted once when you stop."
                        : config.transcriptEnhancement === "off" ? "Your transcript keeps the words you spoke. No transcript enhancement is applied."
                        : config.transcriptEnhancement === "commands-only" ? "Use supported voice commands to format your words without a language model."
                        : "Conservative polish uses your optional local language model. If it fails, VOCO keeps the original transcript."}</p>
                    </div>
                    <p id="voco-delivery-help" className="voco-preferences__helper" role="status"><strong>How your words arrive:</strong> {effectiveDeliveryLabel}</p>
                  </div>
                  {config.transcriptTarget === "cursor" ? <details className="voco-preferences__card voco-preferences__disclosure">
                    <summary>Browser delivery and recording shortcuts</summary>
                    <div className="voco-preferences__form"><p>In an enabled Chromium tab, Alt+Shift+V authorizes the exact supported field. With enhancement off, canonical transcript checkpoints can appear while you speak. Hypotheses remain inside VOCO. Moving focus or editing the field ends automatic delivery. Other apps and the configured recording shortcut, <code>{config.hotkey}</code>, produce a transcript for Copy. The transcript panel and final-only modes deliver one completed result to the authorized browser field.</p>
                      <p><strong>VOCO Dictation:</strong> {ownedPreeditLabel}{runtimeDiagnostics?.ownedPreedit.detail ? ` — ${runtimeDiagnostics.ownedPreedit.detail}` : ""}</p>
                    </div>
                  </details> : null}
                  <div className="voco-preferences__actions"><button className="voco-button voco-button--secondary" onClick={() => setActiveSection("Integrations")}>Configure optional integrations</button></div>
                </section>
              ) : null}

              {activeSection === "Appearance" ? <section className="voco-preferences__page">
                <div className="voco-preferences__heading"><h2 tabIndex={-1}>Appearance</h2></div>
                <div className="voco-preferences__group"><h3 className="voco-preferences__group-title">Visual effects</h3>{renderAppearanceRows()}</div>
                <p className="voco-preferences__helper">Glass is the default appearance. Your system’s accessibility preferences are always respected. The microphone sound meter remains active during a check.</p>
              </section> : null}

              {activeSection === "Integrations" ? (
                <section className="voco-preferences__page">
                  <div className="voco-preferences__heading"><h2 tabIndex={-1}>Integrations</h2></div>
                  <p className="voco-preferences__helper">Normal dictation does not need an assistant or a local language model.</p>
                  <details className="voco-preferences__card voco-preferences__disclosure" open={localModelOpen} onToggle={(event) => setLocalModelOpen(event.currentTarget.open)}>
                    <summary>Local language model</summary>
                    <div className="voco-preferences__form">
                      <p className="voco-preferences__helper">Optional answers and transcript polish through a model running on this device.</p>
                      <label className="voco-field voco-preferences__field-row"><span>Local model endpoint</span><input id="voco-local-endpoint" disabled={saving} value={localLlmEndpointDraft} onChange={(event) => setLocalLlmEndpointDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveLocalLlmSettings(); } }} /></label>
                      <label className="voco-field voco-preferences__field-row"><span>Local model name</span><input id="voco-local-model" disabled={saving} value={localLlmModelDraft} placeholder="Optional" onChange={(event) => setLocalLlmModelDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveLocalLlmSettings(); } }} /></label>
                      {visibleLocalLlmStatus ? <div role="status" className={`voco-inline-note${visibleLocalLlmStatus.kind === "error" ? " voco-inline-note--error" : ""}`}>{visibleLocalLlmStatus.detail}</div> : null}
                      <div className="voco-preferences__actions">
                        <button className="voco-button voco-button--secondary" onClick={() => void testLocalModelConnection()} disabled={saving}>{testingLocalModel ? "Testing local model…" : "Test local model"}</button>
                        <button className="voco-button voco-button--primary" onClick={() => void saveLocalLlmSettings()} disabled={saving || !localModelDirty}>Save local model settings</button>
                      </div>
                      {localModelDirty ? <p className="voco-preferences__helper" role="status">Local model settings have unsaved changes.</p> : null}
                    </div>
                  </details>
                  <details className="voco-preferences__card voco-preferences__disclosure" open={openClawOpen} onToggle={(event) => setOpenClawOpen(event.currentTarget.open)}>
                    <summary>OpenClaw assistant</summary>
                    <div className="voco-preferences__form">
                      <p className="voco-preferences__helper">Uses your configured OpenClaw agent. Its provider and data flow are separate from local dictation.</p>
                      <label className="voco-field voco-preferences__field-row"><span>OpenClaw agent</span><input id="voco-openclaw-agent" disabled={saving} value={openClawAgentDraft} onChange={(event) => setOpenClawAgentDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveOpenClawSettings(); } }} /></label>
                      <label className="voco-field"><span>OpenClaw instruction prefix</span><textarea id="voco-openclaw-prefix" disabled={saving} value={openClawPromptDraft} rows={4} onChange={(event) => setOpenClawPromptDraft(event.target.value)} /></label>
                      {openClawError ? <div className="voco-inline-note voco-inline-note--error" role="alert">{openClawError}</div> : null}
                      <p className="voco-preferences__helper">The prompt is prepended to your spoken text before VOCO calls OpenClaw.</p>
                      <div className="voco-preferences__actions"><button className="voco-button voco-button--primary" onClick={() => void saveOpenClawSettings()} disabled={saving || !openClawDirty}>Save OpenClaw settings</button></div>
                      {openClawDirty ? <p className="voco-preferences__helper" role="status">OpenClaw settings have unsaved changes.</p> : null}
                    </div>
                  </details>
                  <div className="voco-preferences__actions"><button className="voco-button voco-button--secondary" onClick={() => setActiveSection("Output")}>Choose dictation output</button></div>
                </section>
              ) : null}

              {activeSection === "Hotkeys" ? (
                <section className="voco-preferences__page">
                  <div className="voco-preferences__heading"><h2 tabIndex={-1}>Shortcuts</h2></div>
                  <div className="voco-preferences__group"><h3 className="voco-preferences__group-title">Dictation</h3>
                    <div className="voco-preferences__card voco-preferences__form">
                      <div className="voco-preferences__shortcut-editor">
                        <label className="voco-field"><span>Start and stop listening</span><input disabled={saving} value={recordingShortcut ? "Press your shortcut…" : hotkeyDraft} aria-invalid={Boolean(hotkeyError)} aria-describedby="voco-hotkey-feedback"
                          onBlur={() => { if (recordingShortcut) endShortcutCapture(); }} onChange={(event) => setHotkeyDraft(event.target.value)}
                          onKeyDown={(event) => { if (recordingShortcut) { captureShortcut(event); return; } if (event.key === "Enter") { event.preventDefault(); void saveHotkey(); } }} /></label>
                        <button className="voco-button voco-button--secondary" disabled={saving} onClick={beginShortcutCapture}>Record shortcut</button>
                        {hotkeyDirty || hotkeyError ? <button className="voco-button voco-button--primary" onClick={() => void saveHotkey()} disabled={saving}>Save hotkey</button> : null}
                      </div>
                      <p className="voco-preferences__helper" id="voco-hotkey-feedback" role="status">{hotkeyError ?? (recordingShortcut ? "Press a modifier and key. Escape cancels." : shortcut.instruction)}</p>
                    </div>
                  </div>
                  <div className="voco-preferences__group"><h3 className="voco-preferences__group-title">Conversation</h3>
                    <div className="voco-preferences__card"><div className="voco-preferences__row"><span className="voco-preferences__badge"><SettingsIcon name="Hotkeys" /></span><span className="voco-preferences__row-copy"><strong>Realtime conversation</strong></span><kbd className="voco-preferences__row-value">Alt+Shift+R</kbd></div></div>
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
                  <details className="voco-preferences__card voco-preferences__disclosure"><summary>Update preferences and installation details</summary>
                    <div className="voco-preferences__form">
                      <label className="voco-field voco-preferences__field-row"><span>Installation method for update instructions</span><select value={config.installChannel} onChange={(event) => void savePatch({ installChannel: event.target.value as AppConfig["installChannel"] })}>
                        <option value="github-release">GitHub Release (.deb)</option>{config.installChannel === "appimage" ? <option value="appimage" disabled>AppImage (legacy, publication paused)</option> : null}<option value="source">Source build</option>{config.installChannel === "flatpak" ? <option value="flatpak" disabled>Flatpak (legacy, unverified)</option> : null}{config.installChannel === "snap" ? <option value="snap" disabled>Snap (legacy, unverified)</option> : null}
                      </select></label>
                      <p className="voco-preferences__helper">VOCO currently publishes and verifies the GitHub Release .deb. AppImage, Flatpak, and Snap are not current published release channels.</p>
                      <label className="voco-field voco-preferences__field-row"><span>Update channel</span><select value={config.updateChannel} onChange={(event) => void savePatch({ updateChannel: event.target.value as AppConfig["updateChannel"] })}><option value="stable">Stable</option><option value="beta">Beta</option></select></label>
                      <p className="voco-preferences__helper">{updateInstallCopy}</p>
                      <p className="voco-preferences__helper">{config.updateChannel === "beta" ? "Beta updates should be treated as higher-churn builds with faster feedback cycles." : "Stable updates should remain the default for day-to-day use."}</p>
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
                  <div className="voco-preferences__heading"><h2 tabIndex={-1}>Troubleshooting</h2></div>
                  <div className="voco-preferences__group"><h3 className="voco-preferences__group-title">Text delivery</h3>
                    <div className="voco-preferences__card voco-preferences__form">
                      <p className="voco-preferences__helper">Automatic delivery uses only the verified original browser field. If that field changes or is unavailable, VOCO keeps the result for you to copy. The recording shortcut works independently of direct browser delivery.</p>
                    </div>
                  </div>
                  <div className="voco-preferences__group"><h3 className="voco-preferences__group-title">Runtime checks</h3>
                    <div className="voco-preferences__card">
                      <div className="voco-preferences__row"><span className="voco-preferences__row-copy"><strong>Session</strong></span><span className="voco-preferences__row-value">{runtimeSessionLabel}</span></div>
                      <div className="voco-preferences__row"><span className="voco-preferences__row-copy"><strong>IBus recording integration</strong></span><span className="voco-preferences__row-value">{ownedPreeditLabel}</span></div>
                      <div className="voco-preferences__row"><span className="voco-preferences__row-copy"><strong>Type simulation</strong></span><span className="voco-preferences__row-value">{typeSimulationLabel}</span></div>
                      <div className="voco-preferences__row"><span className="voco-preferences__row-copy"><strong>Clipboard insertion</strong></span><span className="voco-preferences__row-value">{clipboardLabel}</span></div>
                    </div>
                  </div>
                  {runtimeDiagnostics ? <details className="voco-preferences__card voco-preferences__disclosure"><summary>Diagnostic details</summary>
                    <div className="voco-preferences__form"><p><strong>IBus recording integration:</strong> {runtimeDiagnostics.ownedPreedit.detail}</p><p><strong>Type simulation:</strong> {runtimeDiagnostics.typeSimulation.detail}</p><p><strong>Clipboard insertion:</strong> {runtimeDiagnostics.clipboard.detail}</p></div>
                  </details> : null}
                  <div className="voco-preferences__actions">
                    <button className="voco-button voco-button--secondary" onClick={() => void onRefreshRuntimeDiagnostics()}>Refresh runtime checks</button>
                    <button className="voco-button voco-button--ghost" disabled={saving || hasUnsavedChanges} title={hasUnsavedChanges ? "Save text changes before restarting setup." : undefined}
                      onClick={async () => { const result = await savePatch({ onboardingCompleted: false }); if (result.ok) { onOnboardingStepChange(0); onSurfaceChange("onboarding"); } }}>Re-run onboarding</button>
                  </div>
                </section>
              ) : null}
              {saving || hasUnsavedChanges || saveFeedback ? <p className="voco-preferences__feedback" role="status">{testingLocalModel ? "Testing local model…" : saving ? "Saving…" : hasUnsavedChanges ? "Unsaved text changes — use the Save button for the edited group." : saveFeedback}</p> : null}
            </div>
          </section>
        )}

        {isOnboarding ? (
          <footer className="voco-panel__footer">
            <span className="voco-save-status" role="status">{testingLocalModel ? "Testing local model…" : saving ? "Saving…" : hasUnsavedChanges ? "Unsaved text changes — use the Save button for the edited group." : saveFeedback ?? "Choices save automatically. Text fields have a Save button."}</span>
          </footer>
        ) : null}
      </section>
    </main>
  );
}
