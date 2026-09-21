import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/dpi";
import { availableMonitors, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "@/store/useStore";
import { errorMessage } from "@/lib/dictationRecovery";
import {
  getConfig,
  beginRuntimeStatusSession,
  getRuntimeDiagnostics,
  hasPendingHotkeyToggle,
  hideStatusOverlay,
  openExternalUrl,
  openConfigDirectory,
  reloadConfigFromDisk,
  resetConfigToDefaults,
  saveConfigPatch,
  showNotification,
  syncRuntimeStatus,
  syncPanelLevel,
  releaseBrowserRecording,
  traceHotkeyEvent,
  takeLauncherActivation,
} from "@/lib/tauri";
import {
  checkForUpdates,
  readCachedUpdateState,
  writeCachedUpdateState,
} from "@/lib/updates";
import { DiagnosticsRequestGate, unknownShortcut } from "@/lib/shortcutPresentation";
import { UpdateCheckCoordinator } from "@/lib/updateCheckCoordinator";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { useDictation } from "@/hooks/useDictation";
import { useNativeCaptureSettings } from "@/hooks/useNativeCaptureSettings";
import { ControlPanel } from "@/components/ControlPanel";
import { StatusMark } from "@/components/StatusMark";
import vocoBrandImage from "../../../assets/voco-symbol-ui.png";
import { ConfigRecoveryPanel } from "@/components/ConfigRecoveryPanel";
import { requiresVerifiedTextTarget } from "@/lib/dictationOutputPlan";
import { probeMicrophoneAccess } from "@/lib/audioInput";
import { MicrophoneRefresh, queryMicrophonePermission, microphoneAccessFailure } from "@/lib/microphoneRefresh";
import {
  deriveStatusLabel,
} from "@/lib/dictationPresentation";
import type { DictationTriggerAction } from "@/lib/dictationTrigger";
import {
  shouldApplyConfigSnapshot,
  shouldBlockRuntimeForConfigErrors,
} from "@/lib/configSnapshot";
import { placeTrayPopover } from "@/lib/popoverPlacement";
import { showInteractiveWindow, WindowRemapFocusGuard, isWaylandSession } from "@/lib/windowRemap";
import {
  canToggleDictationWithPermission,
  isDictationActive,
} from "@/lib/activityMode";
import type {
  AppConfig,
  AudioDeviceOption,
  ConfigSnapshot,
  RuntimeDiagnostics,
} from "@/types";

const PANEL_SIZE = new LogicalSize(1040, 760);

function getCaptureSelection() {
  const state = useStore.getState();
  if (state.captureBackendMode === "pending") throw new Error("Capture backend has not been verified. Retry capture setup in Audio settings.");
  return state.captureBackendMode === "native"
    ? { backend: "native" as const, selectionToken: state.nativeCaptureSource?.selectionToken ?? null }
    : { backend: "webkit" as const };
}
const PANEL_MIN_SIZE = new LogicalSize(760, 560);
const POPOVER_SIZE = new LogicalSize(420, 380);
const POPOVER_RECOVERY_SIZE = new LogicalSize(420, 660);

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

type TrayPopoverAnchor = {
  rectPositionX: number;
  rectPositionY: number;
  rectWidth: number;
  rectHeight: number;
};

function cleanupDeferredListener(
  registration: Promise<() => void>,
  label: string,
): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void registration
    .then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    })
    .catch((error) => {
      console.warn(`Failed to register ${label}:`, error);
    });

  return () => {
    disposed = true;
    unlisten?.();
    unlisten = null;
  };
}


function ResizeHandles() {
  const startResize =
    (direction: ResizeDirection) =>
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      void getCurrentWindow().startResizeDragging(direction).catch(() => {});
    };

  const zones: Array<{ direction: ResizeDirection; label: string }> = [
    { direction: "North", label: "Resize from top edge" },
    { direction: "South", label: "Resize from bottom edge" },
    { direction: "West", label: "Resize from left edge" },
    { direction: "East", label: "Resize from right edge" },
    { direction: "NorthWest", label: "Resize from top left corner" },
    { direction: "NorthEast", label: "Resize from top right corner" },
    { direction: "SouthWest", label: "Resize from bottom left corner" },
    { direction: "SouthEast", label: "Resize from bottom right corner" },
  ];

  return (
    <div className="voco-resize-zones" aria-hidden="true">
      {zones.map(({ direction, label }) => (
        <button
          key={direction}
          className={`voco-resize-zone voco-resize-zone--${direction.toLowerCase()}`}
          type="button"
          tabIndex={-1}
          aria-label={label}
          onPointerDown={startResize(direction)}
        />
      ))}
    </div>
  );
}

export function App() {
  const nativeMicrophone = useNativeCaptureSettings();
  const status = useStore((state) => state.status);
  const error = useStore((state) => state.error);
  const recovery = useStore((state) => state.recovery);
  const captureNotice = useStore((state) => state.captureNotice);
  const transcript = useStore((state) => state.transcript);
  const rawTranscript = useStore((state) => state.rawTranscript);
  const recoverableTranscripts = useStore((state) => state.recoverableTranscripts);
  const dismissRecoverableTranscript = useStore((state) => state.dismissRecoverableTranscript);
  const lastDictationResult = useStore((state) => state.lastDictationResult);
  const hasRecoverableTranscript = recoverableTranscripts.length > 0;
  const surface = useStore((state) => state.surface);
  const onboardingStep = useStore((state) => state.onboardingStep);
  const selectedDeviceId = useStore((state) => state.selectedDeviceId);
  const availableDevices = useStore((state) => state.availableDevices);
  const microphonePermission = useStore((state) => state.microphonePermission);
  const microphoneReady = useStore((state) => state.microphoneReady);
  const nativeMicrophoneReady = nativeMicrophone.mode === "webkit" ? null
    : nativeMicrophone.mode === "native" && Boolean(nativeMicrophone.selected) && microphoneReady;
  const ownedPreeditSetupState = useStore(
    (state) => state.ownedPreeditSetupState,
  );
  const config = useStore((state) => state.config);
  const setConfig = useStore((state) => state.setConfig);
  const setError = useStore((state) => state.setError);
  const setStatus = useStore((state) => state.setStatus);
  const setSurface = useStore((state) => state.setSurface);
  const setOnboardingStep = useStore((state) => state.setOnboardingStep);
  const setAvailableDevices = useStore((state) => state.setAvailableDevices);
  const setMicrophonePermission = useStore((state) => state.setMicrophonePermission);
  const setMicrophoneReadyState = useStore((state) => state.setMicrophoneReady);
  const setOwnedPreeditSetupState = useStore(
    (state) => state.setOwnedPreeditSetupState,
  );
  const updateState = useStore((state) => state.updateState);
  const setUpdateState = useStore((state) => state.setUpdateState);
  const [updateCheckCoordinator] = useState(
    () =>
      new UpdateCheckCoordinator({
        getCurrentChannel: () =>
          useStore.getState().config?.updateChannel ?? null,
        getUpdateState: () => useStore.getState().updateState,
        setUpdateState: (state) => useStore.getState().setUpdateState(state),
        readCachedState: readCachedUpdateState,
        checkForUpdates,
        writeCachedState: writeCachedUpdateState,
        showNotification,
      }),
  );
  const {
    prepareAudioEngine,
    primeRecordingStream,
    cursorDeliveryState,
    canCancel,
    cancellationPending,
    cancelRecording,
    retryRecovery,
    discardRecovery,
    finishOnboardingTest,
    toggle,
    onHotkeyPressed,
  } = useDictation({ getCaptureSelection });
  const [testPreparing, setTestPreparing] = useState(false);
  const startRequestRef = useRef<{ cancelled: boolean } | null>(null);
  const [activationRequest, setActivationRequest] = useState(0);
  const onboardingHandoffRef = useRef(false);
  const [initComplete, setInitComplete] = useState(false);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [runtimeStatusEpoch, setRuntimeStatusEpoch] = useState<number | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [startupConfigError, setStartupConfigError] = useState<string | null>(null);
  const [settingsRequest, setSettingsRequest] = useState<{
    section: "General" | "Audio" | "Hotkeys" | "Advanced" | "Output" | "Updates";
    id: number;
  }>({ section: "General", id: 0 });
  const [closeRequestId, setCloseRequestId] = useState(0);
  const draftsDirtyRef = useRef(false);
  const shortcutCaptureRef = useRef(false);
  const shortcutCaptureReleasedAtRef = useRef(Number.NEGATIVE_INFINITY);
  const handleDraftStateChange = useCallback((dirty: boolean) => {
    draftsDirtyRef.current = dirty;
  }, []);
  const handleShortcutCaptureChange = useCallback((active: boolean) => {
    const wasCapturing = shortcutCaptureRef.current;
    shortcutCaptureRef.current = active;
    if (wasCapturing && !active) shortcutCaptureReleasedAtRef.current = performance.now();
  }, []);
  const appStartMsRef = useRef(performance.now());
  const initStartedRef = useRef(false);
  const appMountedLoggedRef = useRef(false);
  const trayPopoverAnchorRef = useRef<TrayPopoverAnchor | null>(null);
  const panelSizeRef = useRef<LogicalSize>(PANEL_SIZE);
  const configSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const configSavePendingCountRef = useRef(0);
  const configSaveRequestVersionRef = useRef(0);
  const surfaceSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const surfaceSyncVersionRef = useRef(0);
  const runtimeSessionTypeRef = useRef<string | null>(null);
  const remapFocusGuardRef = useRef(new WindowRemapFocusGuard());
  const panelRequestVersionRef = useRef(0);
  const lastConfigRevisionRef = useRef(-1);
  const diagnosticsGateRef = useRef(new DiagnosticsRequestGate());
  const diagnosticsInFlightRef = useRef(false);
  const diagnosticsExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runtimeStatusRevisionRef = useRef(0);
  const microphoneRefreshRef = useRef(new MicrophoneRefresh());
  const dictationStatusRef = useRef(status);
  dictationStatusRef.current = status;
  const applyAuthoritativeConfig = useCallback(
    (snapshot: ConfigSnapshot): boolean => {
      if (
        !shouldApplyConfigSnapshot(
          lastConfigRevisionRef.current,
          snapshot.revision,
        )
      ) {
        return false;
      }
      lastConfigRevisionRef.current = snapshot.revision;
      if (useStore.getState().config?.onboardingCompleted === false && snapshot.config.onboardingCompleted) {
        onboardingHandoffRef.current = true;
      }
      setConfig(snapshot.config);
      return true;
    },
    [setConfig],
  );
  const dismissInteractiveSurface = useCallback((): boolean => {
    const state = useStore.getState();
    const currentSurface = state.surface;
    if (currentSurface === "onboarding" && (startRequestRef.current || isDictationActive(state.status))) return false;
    if (draftsDirtyRef.current && (currentSurface === "settings" || currentSurface === "onboarding")) {
      setCloseRequestId((request) => request + 1);
      return false;
    }
    panelRequestVersionRef.current += 1;
    surfaceSyncVersionRef.current += 1;
    remapFocusGuardRef.current.invalidate();
    setSurface("hidden");
    return true;
  }, [setSurface]);
  const handleSurfaceChange = useCallback(
    (nextSurface: "hidden" | "onboarding" | "settings" | "popover") => {
      if (nextSurface === "hidden") {
        dismissInteractiveSurface();
      } else {
        setSurface(nextSurface);
      }
    },
    [dismissInteractiveSurface, setSurface],
  );
  // Dictation never maps a transcript window over the destination.
  const recoveryAvailable = Boolean(recovery);
  const popoverSize =
    recovery || hasRecoverableTranscript || (transcript.trim().length > 0 &&
    (cursorDeliveryState === "unreconciled" || status === "error"))
      ? POPOVER_RECOVERY_SIZE
      : POPOVER_SIZE;
  // Presentation uses input prerequisites; an unfocused external field is not
  // missing setup. Recording still acquires and verifies its own target token.
  const cursorRequired = requiresVerifiedTextTarget(config) &&
    !(config?.transcriptTarget === "cursor" && runtimeDiagnostics?.desktopPaste?.enabled &&
      (runtimeDiagnostics.desktopInput?.available ?? runtimeDiagnostics.desktopPaste.available));
  const cursorSetupState =
    ownedPreeditSetupState ||
    runtimeDiagnostics?.ownedPreedit.setupState ||
    "";
  const runtimeConfigurationError = shouldBlockRuntimeForConfigErrors(
    startupConfigError,
    settingsError,
  );
  const canHandleHotkey =
    initComplete && config !== null && !runtimeConfigurationError;
  const handleToggleRequest = useCallback(async (triggerId?: string, action?: DictationTriggerAction) => {
    const rejectBrowserStart = () => {
      if (action === "start" && triggerId?.startsWith("browser:")) {
        void releaseBrowserRecording(triggerId).catch(() => {});
      }
    };
    if (shortcutCaptureRef.current || performance.now() - shortcutCaptureReleasedAtRef.current < 350) { rejectBrowserStart(); return; }
    // Stop (or a second toggle) must cancel admission while device setup awaits.
    // Duplicate explicit starts leave the original request in control.
    if (startRequestRef.current) {
      if (action !== "start") startRequestRef.current.cancelled = true;
      rejectBrowserStart();
      return;
    }
    const currentState = useStore.getState();
    if (currentState.surface === "onboarding" && currentState.dictationPurpose === "onboarding" && isDictationActive(currentState.status)) {
      toggle("onboarding:test", "stop");
      return;
    }
    const currentSurface = currentState.surface;
    if (currentSurface !== "hidden" && action !== "stop") {
      rejectBrowserStart();
      if (!dismissInteractiveSurface()) return;
      await hideStatusOverlay().catch(() => {});
      await showNotification(
        "Panel hidden",
        "Focus the target text field, then press the dictation hotkey again.",
      ).catch(() => {});
      return;
    }

    const dictationActive = isDictationActive(dictationStatusRef.current);
    if (!dictationActive && action === "stop") return;
    const captureState = useStore.getState();
    if (!dictationActive && captureState.captureBackendMode !== "webkit") {
      const request = { cancelled: false };
      startRequestRef.current = request;
      try {
        await nativeMicrophone.ensureDefault();
      } catch (cause) {
        rejectBrowserStart();
        if (request.cancelled) return;
        const message = errorMessage(cause);
        setError(message);
        await showNotification("Microphone setup required", message).catch(() => {});
        return;
      } finally { startRequestRef.current = null; }
      // Do not start from a stale request after an interactive panel opened.
      if (request.cancelled || useStore.getState().surface !== "hidden") { rejectBrowserStart(); return; }
    }
    if (
      captureState.captureBackendMode === "webkit" &&
      !canToggleDictationWithPermission(
        dictationStatusRef.current,
        useStore.getState().microphonePermission,
      )
    ) {
      rejectBrowserStart();
      await showNotification(
        "Microphone access is blocked",
        "Grant microphone access in VOCO settings before starting dictation.",
      ).catch(() => {});
      return;
    }
    toggle(triggerId, action);
  }, [dismissInteractiveSurface, nativeMicrophone.ensureDefault, setError, toggle]);
  const handleStartTest = useCallback(async () => {
    const state = useStore.getState();
    if (startRequestRef.current || isDictationActive(state.status) || state.surface !== "onboarding") return;
    if (state.recovery && state.dictationPurpose !== "onboarding") {
      setError("Finish recovering your previous dictation before starting the voice test.");
      return;
    }
    const request = { cancelled: false };
    startRequestRef.current = request;
    setTestPreparing(true);
    setError(null);
    try {
      if (state.dictationPurpose === "onboarding") discardRecovery();
      await nativeMicrophone.ensureDefault();
      if (request.cancelled || useStore.getState().surface !== "onboarding") return;
      toggle("onboarding:test", "start");
    } catch (cause) {
      if (!request.cancelled) setError(errorMessage(cause));
    } finally {
      startRequestRef.current = null;
      setTestPreparing(false);
    }
  }, [discardRecovery, nativeMicrophone.ensureDefault, setError, toggle]);

  const handlePrepareDictation = useCallback(async () => {
    if (isDictationActive(useStore.getState().status)) return;
    if (!dismissInteractiveSurface()) return;
    await hideStatusOverlay().catch(() => {});
    await showNotification(
      "Ready to try dictation",
      `Focus a text field, then press ${useStore.getState().config?.hotkey ?? "Alt+D"}. Wait for Listening before speaking.`,
    ).catch(() => {});
  }, [dismissInteractiveSurface]);

  useGlobalShortcut(
    handleToggleRequest,
    () => {
      return canHandleHotkey;
    },
    canHandleHotkey,
    appStartMsRef.current,
    onHotkeyPressed,
  );

  useEffect(() => {
    if (appMountedLoggedRef.current) {
      return;
    }

    appMountedLoggedRef.current = true;
    traceHotkeyEvent("frontend_app_mounted").catch(() => {});
  }, []);

  useEffect(() => {
    return cleanupDeferredListener(
      getCurrentWindow().listen<ConfigSnapshot>("voco:config-changed", (event) => {
        applyAuthoritativeConfig(event.payload);
      }),
      "configuration listener",
    );
  }, [applyAuthoritativeConfig]);


  useEffect(() => {
    const controller = microphoneRefreshRef.current;
    controller.activate();
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.selectedDeviceId !== previous.selectedDeviceId || state.status !== previous.status) {
        controller.invalidateRetry();
      }
    });
    return () => { unsubscribe(); controller.dispose(); };
  }, []);

  const refreshDevices = useCallback(async () => {
    if (useStore.getState().captureBackendMode !== "webkit") {
      await nativeMicrophone.refresh();
      return;
    }
    const current = microphoneRefreshRef.current.beginRefresh();
    // Permission support is advisory: panel refresh waits only for enumeration.
    void queryMicrophonePermission().then((permission) => {
      if (!current()) return;
      if (permission === "granted" || permission === "denied") setMicrophonePermission(permission);
      else if (permission === "prompt") setMicrophonePermission("unknown");
    });
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!current()) return;
      const options: AudioDeviceOption[] = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Microphone ${index + 1}` }));
      setAvailableDevices(options);
    } catch (error) {
      if (current()) console.warn("Failed to enumerate audio devices:", error);
    }
  }, [setAvailableDevices, setMicrophonePermission, nativeMicrophone.refresh]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const refresh = () => { void refreshDevices().catch(() => {}); };
    mediaDevices.addEventListener("devicechange", refresh);
    return () => mediaDevices.removeEventListener("devicechange", refresh);
  }, [refreshDevices]);

  const requestMicrophoneAccess = useCallback(async (): Promise<boolean> => {
    if (useStore.getState().captureBackendMode !== "webkit") return false;
    const controller = microphoneRefreshRef.current;
    const current = controller.beginRetry();
    const deviceId = useStore.getState().selectedDeviceId;
    const inactive = () => {
      const state = useStore.getState();
      return current() && !isDictationActive(state.status) && state.selectedDeviceId === deviceId &&
        state.status !== "recording" && state.status !== "processing";
    };
    if (!inactive()) return false;
    try {
      await probeMicrophoneAccess(deviceId);
      if (!inactive()) return false;
      setError(null);
      setMicrophonePermission("granted");
      setMicrophoneReadyState(true);
      setStatus("idle");
      void refreshDevices();
      return true;
    } catch (error) {
      if (!inactive()) return false;
      const failure = microphoneAccessFailure(error);
      if (failure.denied) setMicrophonePermission("denied");
      setMicrophoneReadyState(false);
      setStatus("error");
      setError(failure.message);
      return false;
    }
  }, [refreshDevices, setError, setMicrophonePermission, setMicrophoneReadyState, setStatus]);

  const invalidateShortcutDiagnostics = useCallback(() => {
    diagnosticsGateRef.current.invalidate();
    if (diagnosticsExpiryRef.current !== null) clearTimeout(diagnosticsExpiryRef.current);
    setRuntimeDiagnostics((current) => current ? {
      ...current,
      shortcut: unknownShortcut(useStore.getState().config?.hotkey ?? ""),
    } : null);
  }, []);

  const refreshRuntimeDiagnostics = useCallback(async () => {
    if (diagnosticsInFlightRef.current || configSavePendingCountRef.current > 0) return;
    const isCurrent = diagnosticsGateRef.current.begin();
    const hotkey = useStore.getState().config?.hotkey;
    const revision = lastConfigRevisionRef.current;
    const saveVersion = configSaveRequestVersionRef.current;
    diagnosticsInFlightRef.current = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // A stalled observer must neither block opening Settings nor accumulate requests.
      const request = Promise.resolve().then(getRuntimeDiagnostics).finally(() => {
        diagnosticsInFlightRef.current = false;
      });
      const diagnostics = await Promise.race([
        request,
        new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), 2000); }),
      ]);
      if (!isCurrent()) return;
      if (!diagnostics || revision !== lastConfigRevisionRef.current ||
          saveVersion !== configSaveRequestVersionRef.current ||
          configSavePendingCountRef.current > 0 || hotkey !== useStore.getState().config?.hotkey) {
        invalidateShortcutDiagnostics();
        return;
      }
      runtimeSessionTypeRef.current = diagnostics.sessionType;
      setRuntimeDiagnostics(diagnostics);
      setOwnedPreeditSetupState(diagnostics.ownedPreedit.setupState);
      if (diagnosticsExpiryRef.current !== null) clearTimeout(diagnosticsExpiryRef.current);
      diagnosticsExpiryRef.current = setTimeout(invalidateShortcutDiagnostics, 2000);
    } catch (error) {
      if (isCurrent()) invalidateShortcutDiagnostics();
      console.warn("Failed to load runtime diagnostics:", error);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }, [invalidateShortcutDiagnostics, setOwnedPreeditSetupState]);

  useEffect(() => {
    diagnosticsGateRef.current.activate();
    return () => {
      diagnosticsGateRef.current.dispose();
      if (diagnosticsExpiryRef.current !== null) clearTimeout(diagnosticsExpiryRef.current);
    };
  }, []);

  useEffect(() => {
    invalidateShortcutDiagnostics();
    if (surface === "hidden" || !config) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await refreshRuntimeDiagnostics();
      if (!cancelled) timer = setTimeout(() => { void poll(); }, 1000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      invalidateShortcutDiagnostics();
    };
  }, [surface, config, invalidateShortcutDiagnostics, refreshRuntimeDiagnostics]);

  const refreshAuthoritativeConfig = useCallback(async () => {
    const snapshot = await getConfig();
    applyAuthoritativeConfig(snapshot);
    return snapshot.config;
  }, [applyAuthoritativeConfig]);

  const refreshPanelState = useCallback(async () => {
    const results = await Promise.allSettled([
      refreshAuthoritativeConfig(),
      refreshDevices(),
      refreshRuntimeDiagnostics(),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        console.warn("Failed to refresh VOCO panel state:", result.reason);
      }
    }
  }, [refreshAuthoritativeConfig, refreshDevices, refreshRuntimeDiagnostics]);

  const openSettings = useCallback(async (section: "General" | "Audio" | "Hotkeys" | "Advanced" | "Output" | "Updates" = "General") => {
    const requestVersion = panelRequestVersionRef.current + 1;
    panelRequestVersionRef.current = requestVersion;
    const currentStatus = useStore.getState().status;
    if (isDictationActive(currentStatus)) {
      return;
    }
    await refreshPanelState();
    const latestStatus = useStore.getState().status;
    if (
      panelRequestVersionRef.current !== requestVersion ||
      isDictationActive(latestStatus)
    ) {
      return;
    }
    setSettingsRequest((current) => ({
      section,
      id: current.id + 1,
    }));
    setSurface("settings");
  }, [refreshPanelState, setSurface]);

  const showPopover = useCallback(
    async (anchor: TrayPopoverAnchor, toggleVisibility: boolean) => {
      const requestVersion = panelRequestVersionRef.current + 1;
      panelRequestVersionRef.current = requestVersion;
      const state = useStore.getState();
      if (draftsDirtyRef.current && (state.surface === "settings" || state.surface === "onboarding")) {
        setCloseRequestId((request) => request + 1);
        return;
      }
      if (isDictationActive(state.status)) {
        return;
      }
      trayPopoverAnchorRef.current = anchor;
      if (toggleVisibility && state.surface === "popover") {
        dismissInteractiveSurface();
        return;
      }
      await refreshPanelState();
      const latestState = useStore.getState();
      if (
        panelRequestVersionRef.current !== requestVersion ||
        isDictationActive(latestState.status)
      ) {
        return;
      }
      setSurface("popover");
    },
    [dismissInteractiveSurface, refreshPanelState, setSurface],
  );

  const applyConfigPatch = useCallback(
    (patch: Partial<AppConfig>): Promise<void> => {
      const requestVersion = configSaveRequestVersionRef.current + 1;
      configSaveRequestVersionRef.current = requestVersion;
      invalidateShortcutDiagnostics();
      configSavePendingCountRef.current += 1;
      const operation = configSaveQueueRef.current.then(async () => {
        try {
          const authoritativeSnapshot = await saveConfigPatch(patch);
          applyAuthoritativeConfig(authoritativeSnapshot);
          if (configSaveRequestVersionRef.current === requestVersion) {
            setSettingsError(null);
          }
        } catch (error) {
          if (configSaveRequestVersionRef.current === requestVersion) {
            setSettingsError(
              `Failed to save settings: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          throw error;
        }
      }).finally(() => {
        configSavePendingCountRef.current = Math.max(
          0,
          configSavePendingCountRef.current - 1,
        );
      });
      configSaveQueueRef.current = operation.catch(() => {});
      return operation;
    },
    [applyAuthoritativeConfig, invalidateShortcutDiagnostics],
  );

  const retryConfigLoad = useCallback(async () => {
    await reloadConfigFromDisk();
    window.location.reload();
  }, []);

  const resetConfig = useCallback(async () => {
    await resetConfigToDefaults();
    window.location.reload();
  }, []);

  useEffect(() => {
    let disposed = false;
    void beginRuntimeStatusSession()
      .then((epoch) => {
        if (disposed) {
          return;
        }
        runtimeStatusRevisionRef.current = 0;
        setRuntimeStatusEpoch(epoch);
      })
      .catch((error) => {
        console.warn("Failed to begin VOCO runtime status session:", error);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const runUpdateCheck = useCallback(
    (
      channel: AppConfig["updateChannel"],
      currentVersionOverride?: string,
      force = false,
    ) => updateCheckCoordinator.run(channel, currentVersionOverride, force),
    [updateCheckCoordinator],
  );

  const retryCaptureSetup = useCallback(async () => {
    const loadedConfig = useStore.getState().config;
    if (!loadedConfig) throw new Error("Load the application configuration before capture setup.");
    try {
      await nativeMicrophone.initialize();
      const appVersion = await getVersion();
      setUpdateState({ status: "idle", currentVersion: appVersion, latestRelease: null, lastCheckedAt: null, error: null });
      if (loadedConfig.onboardingCompleted && (await hasPendingHotkeyToggle().catch(() => false))) {
        void primeRecordingStream();
      }
      traceHotkeyEvent("frontend_audio_prepare_started").catch(() => {});
      await prepareAudioEngine();
      traceHotkeyEvent("frontend_audio_prepare_done").catch(() => {});
      const state = useStore.getState();
      if (state.status === "error" && state.error?.startsWith("Failed to initialize:")) {
        state.setError(null);
        state.setStatus("idle");
      }
      setInitComplete(true);
      traceHotkeyEvent("frontend_init_complete").catch(() => {});
      await refreshDevices();
      await refreshRuntimeDiagnostics();
      await runUpdateCheck(loadedConfig.updateChannel, appVersion);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setStatus("error");
      setError(`Failed to initialize: ${message}`);
      throw cause;
    }
  }, [nativeMicrophone.initialize, prepareAudioEngine, primeRecordingStream, refreshDevices,
    refreshRuntimeDiagnostics, runUpdateCheck, setError, setStatus, setUpdateState]);

  useEffect(() => {
    if (initStartedRef.current) {
      return;
    }
    initStartedRef.current = true;

    async function init() {
      let loadedConfig: AppConfig | null = null;
      try {
        traceHotkeyEvent("frontend_init_started").catch(() => {});
        traceHotkeyEvent("frontend_config_load_started").catch(() => {});
        const loadedSnapshot = await getConfig();
        traceHotkeyEvent("frontend_config_loaded").catch(() => {});
        const snapshotApplied = applyAuthoritativeConfig(loadedSnapshot);
        loadedConfig = snapshotApplied
          ? loadedSnapshot.config
          : useStore.getState().config ?? loadedSnapshot.config;
        setStartupConfigError(null);
        setOnboardingStep(0);
        await retryCaptureSetup();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (loadedConfig === null) {
          setStartupConfigError(message);
          setSurface("settings");
        }
        setStatus("error");
        setError(`Failed to initialize: ${message}`);
      } finally {
        setInitComplete(true);
      }
    }
    void init();
  }, [applyAuthoritativeConfig, retryCaptureSetup, setError, setOnboardingStep, setStatus, setSurface]);

  useEffect(() => {
    if (!initComplete || !config?.updateChannel) {
      return;
    }
    if (updateCheckCoordinator.lastCheckedChannel === config.updateChannel) {
      return;
    }

    void runUpdateCheck(config.updateChannel);
  }, [config?.updateChannel, initComplete, runUpdateCheck, updateCheckCoordinator]);

  useEffect(() => {
    if (runtimeStatusEpoch === null || status !== "recording") return;
    // Capture events drive the panel even when WebKit's hidden-window timers
    // are throttled. Do not subscribe the whole App to audio frames.
    let pending = false;
    let lastSentAt = -Infinity;
    return useStore.subscribe((state) => {
      const now = performance.now();
      if (state.status !== "recording" || pending || now - lastSentAt < 100) return;
      pending = true;
      lastSentAt = now;
      void syncPanelLevel(runtimeStatusEpoch, state.audioLevel)
        .catch(() => {})
        .finally(() => { pending = false; });
    });
  }, [runtimeStatusEpoch, status]);

  useEffect(() => {
    if (runtimeStatusEpoch === null) {
      return;
    }
    runtimeStatusRevisionRef.current += 1;
    void syncRuntimeStatus({
      epoch: runtimeStatusEpoch,
      revision: runtimeStatusRevisionRef.current,
      runtimeInitialized: initComplete,
      hasRecoverableTranscript,
      configurationError: runtimeConfigurationError,
      microphoneReady,
      microphonePermission,
      nativeMicrophoneReady,
      dictationStatus: status,
      cursorDelivery: cursorDeliveryState,
      cursorRequired,
      cursorSetupState,
      manualTranscriptReady: recovery?.kind === "manual-copy",
      recoveryAvailable,
    }).catch((error) => {
      console.warn("Failed to synchronize VOCO runtime status:", error);
    });
  }, [
    cursorRequired,
    cursorDeliveryState,
    cursorSetupState,
    hasRecoverableTranscript,
    initComplete,
    microphonePermission,
    microphoneReady,
    nativeMicrophoneReady,
    runtimeConfigurationError,
    runtimeStatusEpoch,
    recoveryAvailable,
    recovery?.kind,
    status,
  ]);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const syncVersion = surfaceSyncVersionRef.current + 1;
    surfaceSyncVersionRef.current = syncVersion;
    remapFocusGuardRef.current.invalidate();

    async function syncWindowSurface() {
      const isCurrentRequest = () =>
        surfaceSyncVersionRef.current === syncVersion &&
        useStore.getState().surface === surface;
      if (!isCurrentRequest()) {
        return;
      }
      if (surface === "hidden") {
        await currentWindow.setAlwaysOnTop(true).catch(() => {});
        await currentWindow.setDecorations(false).catch(() => {});
        await currentWindow.setSkipTaskbar(true).catch(() => {});
        await currentWindow.setResizable(false).catch(() => {});
        await currentWindow.setMinSize(null).catch(() => {});
        await currentWindow
          .setIgnoreCursorEvents(true)
          .catch(() => {});
        if (!isCurrentRequest()) {
          return;
        }
        await hideStatusOverlay().catch(() => {});
        return;
      }

      if (surface === "popover") {
        await currentWindow.setIgnoreCursorEvents(false).catch(() => {});
        await currentWindow.setAlwaysOnTop(true).catch(() => {});
        await currentWindow.setDecorations(false).catch(() => {});
        await currentWindow.setSkipTaskbar(false).catch(() => {});
        await currentWindow.setResizable(false).catch(() => {});
        await currentWindow.setMinSize(null).catch(() => {});
        if (!isCurrentRequest()) {
          return;
        }
        const anchor = trayPopoverAnchorRef.current;
        const hasAnchor = anchor && (anchor.rectWidth > 0 || anchor.rectHeight > 0);
        const monitors = await availableMonitors().catch(() => []);
        const targetMonitor = (hasAnchor
          ? monitors.find((monitor) =>
            anchor.rectPositionX >= monitor.position.x &&
            anchor.rectPositionX < monitor.position.x + monitor.size.width &&
            anchor.rectPositionY >= monitor.position.y &&
            anchor.rectPositionY < monitor.position.y + monitor.size.height)
          : await currentMonitor().catch(() => null)) ?? monitors[0];
        const scaleFactor = targetMonitor?.scaleFactor ??
          await currentWindow.scaleFactor().catch(() => window.devicePixelRatio || 1);
        const workArea = targetMonitor?.workArea;
        const placement = placeTrayPopover(
          hasAnchor ? {
            x: anchor.rectPositionX, y: anchor.rectPositionY,
            width: anchor.rectWidth, height: anchor.rectHeight,
          } : null,
          {
            x: workArea?.position.x ?? targetMonitor?.position.x ?? 0,
            y: workArea?.position.y ?? targetMonitor?.position.y ?? 0,
            width: workArea?.size.width ?? targetMonitor?.size.width ?? window.screen.availWidth * scaleFactor,
            height: workArea?.size.height ?? targetMonitor?.size.height ?? window.screen.availHeight * scaleFactor,
            scaleFactor,
          },
          { width: popoverSize.width, height: popoverSize.height },
        );
        if (!isCurrentRequest()) return;
        await showInteractiveWindow({
          request: syncVersion,
          wayland: isWaylandSession(runtimeSessionTypeRef.current),
          guard: remapFocusGuardRef.current,
          isCurrent: isCurrentRequest,
          hide: () => currentWindow.hide(),
          resize: () => currentWindow.setSize(new PhysicalSize(placement.width, placement.height)),
          position: () => currentWindow.setPosition(new PhysicalPosition(placement.x, placement.y)).catch(() => {}),
          show: () => currentWindow.show(),
          focus: () => currentWindow.setFocus(),
          isFocused: () => currentWindow.isFocused(),
        });
        if (isCurrentRequest() && onboardingHandoffRef.current) {
          onboardingHandoffRef.current = false;
          requestAnimationFrame(() => {
            if (isCurrentRequest()) void traceHotkeyEvent("onboarding_handoff_visible").catch(() => {});
          });
        }
        return;
      }

      await currentWindow.setIgnoreCursorEvents(false).catch(() => {});
      await currentWindow.setAlwaysOnTop(false).catch(() => {});
      await currentWindow.setDecorations(false).catch(() => {});
      await currentWindow.setSkipTaskbar(false).catch(() => {});
      await currentWindow.setMinSize(PANEL_MIN_SIZE).catch(() => {});
      await currentWindow.setResizable(true).catch(() => {});
      if (!isCurrentRequest()) {
        return;
      }
      await showInteractiveWindow({
        request: syncVersion,
        wayland: isWaylandSession(runtimeSessionTypeRef.current),
        guard: remapFocusGuardRef.current,
        isCurrent: isCurrentRequest,
        hide: () => currentWindow.hide(),
        resize: () => currentWindow.setSize(panelSizeRef.current),
        position: () => currentWindow.center().catch(() => {}),
        show: () => currentWindow.show(),
        focus: () => currentWindow.setFocus(),
        isFocused: () => currentWindow.isFocused(),
      });
    }

    const operation = surfaceSyncQueueRef.current.then(syncWindowSurface);
    surfaceSyncQueueRef.current = operation.catch(() => {});
  }, [popoverSize, surface, activationRequest]);

  useEffect(() => {
    if (surface !== "settings" && surface !== "onboarding") {
      return;
    }

    const currentWindow = getCurrentWindow();
    return cleanupDeferredListener(
      currentWindow.onResized(({ payload }) => {
        const version = surfaceSyncVersionRef.current;
        void currentWindow.scaleFactor().then((scaleFactor) => {
          if (version !== surfaceSyncVersionRef.current || useStore.getState().surface !== surface) return;
          const logicalSize = payload.toLogical(scaleFactor);
          if (
            logicalSize.width >= PANEL_MIN_SIZE.width &&
            logicalSize.height >= PANEL_MIN_SIZE.height
          ) {
            panelSizeRef.current = new LogicalSize(
              Math.round(logicalSize.width),
              Math.round(logicalSize.height),
            );
          }
        });
      }),
      "window resize listener",
    );
  }, [surface]);

  useEffect(() => {
    return cleanupDeferredListener(
      getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault();
        dismissInteractiveSurface();
      }),
      "window close listener",
    );
  }, [dismissInteractiveSurface]);

  useEffect(() => {
    return cleanupDeferredListener(
      getCurrentWindow().listen("voco:open-settings", () => {
        void openSettings();
      }),
      "settings event listener",
    );
  }, [openSettings]);

  useEffect(() => {
    if (!initComplete) return;
    let alive = true;
    const activate = async () => {
      if (!(await takeLauncherActivation().catch(() => false)) || !alive) return;
      const state = useStore.getState();
      if (startRequestRef.current || isDictationActive(state.status)) {
        void traceHotkeyEvent("launcher_activation_preserved_capture").catch(() => {});
        return;
      }
      if (state.surface === "hidden") setSurface(state.config?.onboardingCompleted ? "popover" : "onboarding");
      setActivationRequest(value => value + 1);
      void traceHotkeyEvent("launcher_activation_presented").catch(() => {});
    };
    const cleanup = cleanupDeferredListener(getCurrentWindow().listen("voco:activate", () => {
      void activate();
    }).then(unlisten => { if (alive) void activate(); return unlisten; }), "launcher activation listener");
    return () => { alive = false; cleanup(); };
  }, [initComplete, setSurface]);

  useEffect(() => {
    return cleanupDeferredListener(
      getCurrentWindow().listen("voco:open-hotkey-settings", () => {
        void openSettings("Hotkeys");
      }),
      "hotkey settings event listener",
    );
  }, [openSettings]);

  useEffect(() => {
    return cleanupDeferredListener(
      getCurrentWindow().listen<TrayPopoverAnchor>(
        "voco:toggle-popover",
        (event) => {
        void showPopover(event.payload, true);
        },
      ),
      "tray popover toggle listener",
    );
  }, [showPopover]);

  useEffect(() => {
    return cleanupDeferredListener(
      getCurrentWindow().listen<TrayPopoverAnchor>(
        "voco:show-popover",
        (event) => {
        void showPopover(event.payload, false);
        },
      ),
      "tray popover show listener",
    );
  }, [showPopover]);

  useEffect(() => {
    if (surface !== "popover") {
      return;
    }

    const currentWindow = getCurrentWindow();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissInteractiveSurface();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const cleanupFocusListener = cleanupDeferredListener(
      currentWindow.onFocusChanged(({ payload: focused }) => {
        if (!isWaylandSession(runtimeSessionTypeRef.current)) {
          if (!focused) dismissInteractiveSurface();
          return;
        }
        const version = surfaceSyncVersionRef.current;
        void remapFocusGuardRef.current.shouldDismiss(() => currentWindow.isFocused()).then((dismiss) => {
          if (dismiss && version === surfaceSyncVersionRef.current && useStore.getState().surface === "popover") dismissInteractiveSurface();
        });
      }),
      "popover focus listener",
    );

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      cleanupFocusListener();
    };
  }, [dismissInteractiveSurface, surface]);

  const statusLabel = deriveStatusLabel({
    hasRecovery: Boolean(recovery),
    manualTranscriptReady: recovery?.kind === "manual-copy",
    hasRecoverableTranscript,
    configurationError: runtimeConfigurationError,
    cursorDeliveryState,
    cursorRequired,
    cursorSetupState,
    dictationStatus: status,
    microphonePermission,
    microphoneReady,
    nativeMicrophoneReady,
  });

  if (!config) {
    if (startupConfigError) {
      return (
        <>
          <ConfigRecoveryPanel
            error={startupConfigError}
            onRetry={retryConfigLoad}
            onOpenDirectory={openConfigDirectory}
            onReset={resetConfig}
          />
          <ResizeHandles />
        </>
      );
    }
    return <main className="voco-panel" data-surface="onboarding"><section className="voco-panel__shell voco-opening">
      <img src={vocoBrandImage} alt="" /><h1>VOCO</h1><p role="status"><StatusMark state="working" />Opening VOCO…</p>
    </section></main>;
  }

  if (surface === "hidden") return null;

  return (
    <>
      <ControlPanel
        nativeMicrophone={{ ...nativeMicrophone, initialize: retryCaptureSetup }}
        onStartTest={() => void handleStartTest()}
        onStopTest={() => toggle("onboarding:test", "stop")}
        onFinishTest={finishOnboardingTest}
        testPreparing={testPreparing || !initComplete}
        surface={surface}
        onboardingStep={onboardingStep}
        config={config}
        errorMessage={error ?? settingsError}
        statusLabel={statusLabel}
        updateState={updateState}
        runtimeDiagnostics={runtimeDiagnostics}
        dictationStatus={status}
        cursorDeliveryState={cursorDeliveryState}
        transcript={transcript}
        rawTranscript={rawTranscript}
        recovery={recovery}
        captureNotice={captureNotice}
        canCancelDictation={canCancel}
        cancellationPending={cancellationPending}
        onCancelDictation={() => void cancelRecording()}
        onRetryRecovery={() => void retryRecovery()}
        onDiscardRecovery={discardRecovery}
        recoverableTranscripts={recoverableTranscripts}
        onDismissRecoverableTranscript={dismissRecoverableTranscript}
        lastDictationResult={lastDictationResult}
        onPrepareDictation={() => void handlePrepareDictation()}
        onDraftStateChange={handleDraftStateChange}
        onShortcutCaptureChange={handleShortcutCaptureChange}
        closeRequestId={closeRequestId}
        requestedSection={settingsRequest.section}
        requestedSectionRequestId={settingsRequest.id}
        selectedDeviceId={selectedDeviceId}
        availableDevices={availableDevices}
        microphonePermission={microphonePermission}
        onSurfaceChange={handleSurfaceChange}
        onOnboardingStepChange={setOnboardingStep}
        onConfigChange={applyConfigPatch}
        onRefreshDevices={refreshDevices}
        onRequestMicrophoneAccess={requestMicrophoneAccess}
        onCheckForUpdates={() => runUpdateCheck(config.updateChannel, undefined, true)}
        onOpenReleasePage={(url) => openExternalUrl(url)}
        onRefreshRuntimeDiagnostics={refreshRuntimeDiagnostics}
        onOpenSettings={openSettings}
      />
      {surface === "settings" || surface === "onboarding" ? <ResizeHandles /> : null}
    </>
  );
}
