import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "@/store/useStore";
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
  showStatusOverlay,
  syncRuntimeStatus,
  traceHotkeyEvent,
} from "@/lib/tauri";
import {
  checkForUpdates,
  readCachedUpdateState,
  writeCachedUpdateState,
} from "@/lib/updates";
import { UpdateCheckCoordinator } from "@/lib/updateCheckCoordinator";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { useDictation } from "@/hooks/useDictation";
import { useRealtimeConversation } from "@/hooks/useRealtimeConversation";
import { ControlPanel } from "@/components/ControlPanel";
import { ConfigRecoveryPanel } from "@/components/ConfigRecoveryPanel";
import { RealtimeMicVisual } from "@/components/RealtimeMicVisual";
import { probeMicrophoneAccess } from "@/lib/audioInput";
import {
  deriveStatusLabel,
  shouldShowDictationOverlay,
} from "@/lib/dictationPresentation";
import {
  shouldApplyConfigSnapshot,
  shouldBlockRuntimeForConfigErrors,
} from "@/lib/configSnapshot";
import { placeTrayPopover } from "@/lib/popoverPlacement";
import {
  canActivateMode,
  canToggleDictationWithPermission,
  deriveActivityMode,
  type ActivityMode,
} from "@/lib/activityMode";
import type {
  AppConfig,
  AudioDeviceOption,
  ConfigSnapshot,
  CursorDeliveryState,
  DictationStatus,
  RealtimeStatus,
  RuntimeDiagnostics,
} from "@/types";

const PANEL_SIZE = new LogicalSize(1040, 760);
const PANEL_MIN_SIZE = new LogicalSize(760, 560);
const POPOVER_SIZE = new LogicalSize(420, 520);
const POPOVER_RECOVERY_SIZE = new LogicalSize(420, 660);
const STATUS_OVERLAY_WIDTH = 460;
const STATUS_OVERLAY_HEIGHT = 196;
const REALTIME_OVERLAY_WIDTH = 340;
const REALTIME_OVERLAY_HEIGHT = 156;

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

function StatusOverlay({
  status,
  interimTranscript,
  transcript,
  audioLevel,
  cursorDeliveryState,
}: {
  status: DictationStatus;
  interimTranscript: string;
  transcript: string;
  audioLevel: number;
  cursorDeliveryState: CursorDeliveryState;
}) {
  const trimmedInterim = interimTranscript.trim();
  const hasLiveText =
    status === "recording" &&
    trimmedInterim !== "" &&
    trimmedInterim !== "Listening...";
  const previewOnly =
    cursorDeliveryState === "preview-only" ||
    cursorDeliveryState === "unreconciled";
  const headline = previewOnly
    ? "Preview only"
    : status === "recording"
      ? "Streaming words"
      : "Transcribing";
  const copy =
    trimmedInterim ||
    (status === "processing" && transcript
      ? transcript
      : previewOnly
        ? "Cursor delivery is unavailable. Your transcript will remain in VOCO so you can copy it safely."
        : "Speak normally. Live words will appear here before VOCO inserts the final text.");
  const meterLevel = status === "recording" ? Math.max(audioLevel, 0.06) : 1;

  return (
    <main
      className="voco-overlay"
      data-state={status}
      data-live-preview={hasLiveText ? "true" : "false"}
      data-cursor-delivery={cursorDeliveryState}
      aria-live="polite"
    >
      <span className="voco-overlay__eyebrow">
        {previewOnly
          ? "Cursor unavailable — safe preview"
          : hasLiveText
          ? "Live transcript preview"
          : status === "recording"
            ? "Listening for speech"
            : "Local Processing"}
      </span>
      <strong className="voco-overlay__headline">{headline}</strong>
      <p className={hasLiveText ? "voco-overlay__transcript" : "voco-overlay__copy"}>
        {copy}
      </p>
      <div className="voco-overlay__meter" aria-hidden="true">
        <div
          className="voco-overlay__meter-fill"
          style={{ transform: `scaleX(${meterLevel})` }}
        />
      </div>
    </main>
  );
}

function RealtimeOverlay({
  status,
  detail,
  level,
  muted,
  onToggleMute,
  onCancel,
}: {
  status: RealtimeStatus;
  detail: string;
  level: number;
  muted: boolean;
  onToggleMute: () => void;
  onCancel: () => void;
}) {
  return (
    <main
      className="voco-overlay voco-realtime-overlay"
      data-state={status}
      aria-live="polite"
    >
      <RealtimeMicVisual
        active={status !== "idle" && status !== "error" && !muted}
        level={muted ? 0 : level}
        status={status}
        size="overlay"
      />
      <div className="voco-realtime-overlay__copy">
        <span className="voco-overlay__eyebrow">Realtime Voice</span>
        <strong className="voco-overlay__headline">
          {muted
            ? "Muted"
            : status === "speaking"
            ? "Speaking"
            : status === "connecting"
              ? "Connecting"
              : "Listening"}
        </strong>
        <p className="voco-overlay__copy">{detail}</p>
        <div className="voco-realtime-overlay__actions">
          <button
            className="voco-realtime-overlay__button"
            type="button"
            onClick={onToggleMute}
            aria-pressed={muted}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            className="voco-realtime-overlay__button voco-realtime-overlay__button--danger"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </main>
  );
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
  const status = useStore((state) => state.status);
  const error = useStore((state) => state.error);
  const transcript = useStore((state) => state.transcript);
  const interimTranscript = useStore((state) => state.interimTranscript);
  const audioLevel = useStore((state) => state.audioLevel);
  const surface = useStore((state) => state.surface);
  const onboardingStep = useStore((state) => state.onboardingStep);
  const selectedDeviceId = useStore((state) => state.selectedDeviceId);
  const availableDevices = useStore((state) => state.availableDevices);
  const microphonePermission = useStore((state) => state.microphonePermission);
  const microphoneReady = useStore((state) => state.microphoneReady);
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
    toggle,
    onHotkeyPressed,
  } = useDictation();
  const {
    realtimeStatus,
    realtimeDetail,
    realtimeError,
    realtimeLevel,
    isRealtimeMuted,
    isRealtimeActive,
    toggleRealtime,
    toggleRealtimeMute,
    stopRealtime,
  } = useRealtimeConversation(selectedDeviceId);
  const [initComplete, setInitComplete] = useState(false);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [runtimeStatusEpoch, setRuntimeStatusEpoch] = useState<number | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [startupConfigError, setStartupConfigError] = useState<string | null>(null);
  const [settingsRequest, setSettingsRequest] = useState<{
    section: "General" | "Hotkeys";
    id: number;
  }>({ section: "General", id: 0 });
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
  const panelRequestVersionRef = useRef(0);
  const lastConfigRevisionRef = useRef(-1);
  const runtimeStatusRevisionRef = useRef(0);
  const activityModeRef = useRef<ActivityMode>("idle");
  const dictationStatusRef = useRef(status);
  const realtimeStatusRef = useRef(realtimeStatus);
  const realtimeActivationAllowedRef = useRef(false);
  dictationStatusRef.current = status;
  realtimeStatusRef.current = realtimeStatus;
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
      setConfig(snapshot.config);
      return true;
    },
    [setConfig],
  );
  const dismissInteractiveSurface = useCallback(() => {
    panelRequestVersionRef.current += 1;
    setSurface("hidden");
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
  const dictationOverlayVisible = shouldShowDictationOverlay(
    surface,
    status,
    config?.transcriptTarget,
    config?.liveCursorMode,
    config?.transcriptEnhancement,
    cursorDeliveryState,
  );
  const realtimeOverlayVisible =
    surface === "hidden" && isRealtimeActive && !dictationOverlayVisible;
  const overlayVisible = dictationOverlayVisible || realtimeOverlayVisible;
  const popoverSize =
    transcript.trim().length > 0 &&
    (cursorDeliveryState === "unreconciled" || status === "error")
      ? POPOVER_RECOVERY_SIZE
      : POPOVER_SIZE;
  const cursorRequired =
    config?.transcriptTarget === "cursor" &&
    config.liveCursorMode === "stable-cursor-streaming" &&
    config.transcriptEnhancement === "off";
  const cursorSetupState =
    ownedPreeditSetupState ||
    runtimeDiagnostics?.ownedPreedit.setupState ||
    "";
  const runtimeConfigurationError = shouldBlockRuntimeForConfigErrors(
    startupConfigError,
    settingsError,
  );
  const realtimeActivationAllowed =
    initComplete &&
    config !== null &&
    !runtimeConfigurationError &&
    microphonePermission !== "denied";
  realtimeActivationAllowedRef.current = realtimeActivationAllowed;
  const canHandleHotkey =
    initComplete && config !== null && !runtimeConfigurationError;
  const handleToggleRequest = useCallback(async () => {
    const currentSurface = useStore.getState().surface;
    if (currentSurface !== "hidden") {
      dismissInteractiveSurface();
      await hideStatusOverlay().catch(() => {});
      await showNotification(
        "Panel hidden",
        "Focus the target text field, then press the dictation hotkey again.",
      ).catch(() => {});
      return;
    }

    const realtimeActive = !["idle", "error"].includes(
      realtimeStatusRef.current,
    );
    if (
      realtimeActive ||
      !canActivateMode(activityModeRef.current, "dictation")
    ) {
      await showNotification(
        "Realtime voice is active",
        "Stop realtime voice before starting dictation.",
      ).catch(() => {});
      return;
    }

    const dictationActive = ["recording", "processing"].includes(
      dictationStatusRef.current,
    );
    if (
      !canToggleDictationWithPermission(
        dictationStatusRef.current,
        useStore.getState().microphonePermission,
      )
    ) {
      await showNotification(
        "Microphone access is blocked",
        "Grant microphone access in VOCO settings before starting dictation.",
      ).catch(() => {});
      return;
    }
    if (!dictationActive) {
      activityModeRef.current = "dictation";
    }
    toggle();
  }, [dismissInteractiveSurface, toggle]);
  const handleRealtimeToggleRequest = useCallback(async () => {
    const dictationActive = ["recording", "processing"].includes(
      dictationStatusRef.current,
    );
    if (
      dictationActive ||
      !canActivateMode(activityModeRef.current, "realtime")
    ) {
      await showNotification(
        "Dictation is active",
        "Finish dictation before starting realtime voice.",
      ).catch(() => {});
      return;
    }

    const realtimeActive = !["idle", "error"].includes(
      realtimeStatusRef.current,
    );
    if (!realtimeActive && !realtimeActivationAllowedRef.current) {
      await showNotification(
        "Realtime voice is unavailable",
        useStore.getState().microphonePermission === "denied"
          ? "Grant microphone access in VOCO settings before starting realtime voice."
          : "Wait for VOCO to finish initializing and resolve any settings errors.",
      ).catch(() => {});
      return;
    }
    if (!realtimeActive && configSavePendingCountRef.current > 0) {
      await showNotification(
        "Settings are still saving",
        "Wait for the microphone setting to finish saving, then press the realtime hotkey again.",
      ).catch(() => {});
      return;
    }

    if (useStore.getState().surface !== "hidden") {
      dismissInteractiveSurface();
      await hideStatusOverlay().catch(() => {});
    }
    if (
      ["recording", "processing"].includes(dictationStatusRef.current) ||
      !canActivateMode(activityModeRef.current, "realtime")
    ) {
      return;
    }

    if (!realtimeActive) {
      activityModeRef.current = "realtime";
    }
    toggleRealtime();
  }, [dismissInteractiveSurface, toggleRealtime]);

  useGlobalShortcut(
    handleToggleRequest,
    handleRealtimeToggleRequest,
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
    activityModeRef.current = deriveActivityMode(status, realtimeStatus);
  }, [realtimeStatus, status]);

  useEffect(() => {
    return cleanupDeferredListener(
      getCurrentWindow().listen<ConfigSnapshot>("voco:config-changed", (event) => {
        applyAuthoritativeConfig(event.payload);
      }),
      "configuration listener",
    );
  }, [applyAuthoritativeConfig]);

  const refreshDevices = useCallback(async () => {
    try {
      const permission = await navigator.permissions
        .query({ name: "microphone" as PermissionName })
        .catch(() => null);
      if (permission?.state === "granted") {
        setMicrophonePermission("granted");
      } else if (permission?.state === "denied") {
        setMicrophonePermission("denied");
      } else {
        setMicrophonePermission("unknown");
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const options: AudioDeviceOption[] = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }));
      setAvailableDevices(options);
    } catch (error) {
      console.warn("Failed to enumerate audio devices:", error);
    }
  }, [setAvailableDevices, setMicrophonePermission]);

  const requestMicrophoneAccess = useCallback(async () => {
    try {
      await probeMicrophoneAccess(selectedDeviceId);
      setStatus("idle");
      setError(null);
      setMicrophonePermission("granted");
      setMicrophoneReadyState(true);
      await refreshDevices();
    } catch (error) {
      setStatus("error");
      setMicrophonePermission("denied");
      setMicrophoneReadyState(false);
      setError(
        `Microphone access is blocked. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [
    refreshDevices,
    selectedDeviceId,
    setError,
    setMicrophonePermission,
    setMicrophoneReadyState,
    setStatus,
  ]);

  const refreshRuntimeDiagnostics = useCallback(async () => {
    try {
      const diagnostics = await getRuntimeDiagnostics();
      setRuntimeDiagnostics(diagnostics);
      setOwnedPreeditSetupState(diagnostics.ownedPreedit.setupState);
    } catch (error) {
      console.warn("Failed to load runtime diagnostics:", error);
    }
  }, [setOwnedPreeditSetupState]);

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

  const openSettings = useCallback(async (section: "General" | "Hotkeys" = "General") => {
    const requestVersion = panelRequestVersionRef.current + 1;
    panelRequestVersionRef.current = requestVersion;
    const currentStatus = useStore.getState().status;
    if (currentStatus === "recording" || currentStatus === "processing") {
      return;
    }
    await refreshPanelState();
    const latestStatus = useStore.getState().status;
    if (
      panelRequestVersionRef.current !== requestVersion ||
      latestStatus === "recording" ||
      latestStatus === "processing"
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
      if (state.status === "recording" || state.status === "processing") {
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
        latestState.status === "recording" ||
        latestState.status === "processing"
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
    [applyAuthoritativeConfig],
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
        const appVersion = await getVersion();
        setUpdateState({
          status: "idle",
          currentVersion: appVersion,
          latestRelease: null,
          lastCheckedAt: null,
          error: null,
        });
        setOnboardingStep(0);
        if (
          loadedConfig.onboardingCompleted &&
          (await hasPendingHotkeyToggle().catch(() => false))
        ) {
          void primeRecordingStream();
        }
        traceHotkeyEvent("frontend_audio_prepare_started").catch(() => {});
        await prepareAudioEngine();
        traceHotkeyEvent("frontend_audio_prepare_done").catch(() => {});
        setInitComplete(true);
        traceHotkeyEvent("frontend_init_complete").catch(() => {});
        await refreshDevices();
        await refreshRuntimeDiagnostics();
        await runUpdateCheck(loadedConfig.updateChannel, appVersion);
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
  }, [
    prepareAudioEngine,
    primeRecordingStream,
    applyAuthoritativeConfig,
    refreshDevices,
    setError,
    setOnboardingStep,
    setStatus,
    setSurface,
    setUpdateState,
    refreshRuntimeDiagnostics,
    runUpdateCheck,
  ]);

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
    if (runtimeStatusEpoch === null) {
      return;
    }
    runtimeStatusRevisionRef.current += 1;
    void syncRuntimeStatus({
      epoch: runtimeStatusEpoch,
      revision: runtimeStatusRevisionRef.current,
      runtimeInitialized: initComplete,
      configurationError: runtimeConfigurationError,
      microphoneReady,
      microphonePermission,
      dictationStatus: status,
      cursorDelivery: cursorDeliveryState,
      cursorRequired,
      cursorSetupState,
      realtimeStatus,
      realtimeMuted: isRealtimeMuted,
    }).catch((error) => {
      console.warn("Failed to synchronize VOCO runtime status:", error);
    });
  }, [
    cursorRequired,
    cursorDeliveryState,
    cursorSetupState,
    initComplete,
    isRealtimeMuted,
    microphonePermission,
    microphoneReady,
    realtimeStatus,
    runtimeConfigurationError,
    runtimeStatusEpoch,
    status,
  ]);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const syncVersion = surfaceSyncVersionRef.current + 1;
    surfaceSyncVersionRef.current = syncVersion;

    async function syncWindowSurface() {
      const isCurrentRequest = () =>
        surfaceSyncVersionRef.current === syncVersion;
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
          .setIgnoreCursorEvents(!realtimeOverlayVisible)
          .catch(() => {});
        if (!isCurrentRequest()) {
          return;
        }
        if (overlayVisible) {
          await showStatusOverlay(
            realtimeOverlayVisible ? REALTIME_OVERLAY_WIDTH : STATUS_OVERLAY_WIDTH,
            realtimeOverlayVisible ? REALTIME_OVERLAY_HEIGHT : STATUS_OVERLAY_HEIGHT,
          ).catch(() => {});
        } else {
          await hideStatusOverlay().catch(() => {});
        }
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
        if (anchor && (anchor.rectWidth > 0 || anchor.rectHeight > 0)) {
          const monitors = await availableMonitors().catch(() => []);
          const targetMonitor =
            monitors.find((monitor) => {
              const x = anchor.rectPositionX;
              const y = anchor.rectPositionY;
              return (
                x >= monitor.position.x &&
                x <= monitor.position.x + monitor.size.width &&
                y >= monitor.position.y &&
                y <= monitor.position.y + monitor.size.height
              );
            }) ?? monitors[0];

          const scaleFactor =
            targetMonitor?.scaleFactor ??
            (await currentWindow
              .scaleFactor()
              .catch(() => window.devicePixelRatio || 1));
          const placement = placeTrayPopover(
            {
              x: anchor.rectPositionX,
              y: anchor.rectPositionY,
              width: anchor.rectWidth,
              height: anchor.rectHeight,
            },
            {
              x: targetMonitor?.position.x ?? 0,
              y: targetMonitor?.position.y ?? 0,
              width:
                targetMonitor?.size.width ?? window.screen.width * scaleFactor,
              height:
                targetMonitor?.size.height ?? window.screen.height * scaleFactor,
              scaleFactor,
            },
            { width: popoverSize.width, height: popoverSize.height },
          );

          if (!isCurrentRequest()) {
            return;
          }

          await currentWindow
            .setSize(
              new PhysicalSize(
                placement.width,
                placement.height,
              ),
            )
            .catch(() => {});
          if (!isCurrentRequest()) {
            return;
          }
          await currentWindow
            .setPosition(new PhysicalPosition(placement.x, placement.y))
            .catch(() => {});
        } else {
          if (!isCurrentRequest()) {
            return;
          }
          await currentWindow.setSize(popoverSize).catch(() => {});
          if (!isCurrentRequest()) {
            return;
          }
          await currentWindow.center().catch(() => {});
        }
        if (!isCurrentRequest()) {
          return;
        }
        await currentWindow.show().catch(() => {});
        if (!isCurrentRequest()) {
          return;
        }
        await currentWindow.setFocus().catch(() => {});
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
      await currentWindow.setSize(panelSizeRef.current).catch(() => {});
      if (!isCurrentRequest()) {
        return;
      }
      await currentWindow.center().catch(() => {});
      if (!isCurrentRequest()) {
        return;
      }
      await currentWindow.show().catch(() => {});
      if (!isCurrentRequest()) {
        return;
      }
      await currentWindow.setFocus().catch(() => {});
    }

    const operation = surfaceSyncQueueRef.current.then(syncWindowSurface);
    surfaceSyncQueueRef.current = operation.catch(() => {});
  }, [overlayVisible, popoverSize, realtimeOverlayVisible, surface]);

  useEffect(() => {
    if (surface !== "settings" && surface !== "onboarding") {
      return;
    }

    const currentWindow = getCurrentWindow();
    return cleanupDeferredListener(
      currentWindow.onResized(({ payload }) => {
        void currentWindow.scaleFactor().then((scaleFactor) => {
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
        if (!focused) {
          dismissInteractiveSurface();
        }
      }),
      "popover focus listener",
    );

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      cleanupFocusListener();
    };
  }, [dismissInteractiveSurface, surface]);

  const statusLabel = deriveStatusLabel({
    configurationError: runtimeConfigurationError,
    cursorDeliveryState,
    cursorRequired,
    cursorSetupState,
    dictationStatus: status,
    isRealtimeActive,
    microphonePermission,
    microphoneReady,
    realtimeMuted: isRealtimeMuted,
    realtimeStatus,
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
    return null;
  }

  if (surface === "hidden") {
    if (dictationOverlayVisible) {
      return (
        <StatusOverlay
          status={status}
          interimTranscript={interimTranscript}
          transcript={transcript}
          audioLevel={audioLevel}
          cursorDeliveryState={cursorDeliveryState}
        />
      );
    }

    return realtimeOverlayVisible ? (
      <RealtimeOverlay
        status={realtimeStatus}
        detail={realtimeDetail}
        level={realtimeLevel}
        muted={isRealtimeMuted}
        onToggleMute={toggleRealtimeMute}
        onCancel={stopRealtime}
      />
    ) : null;
  }

  return (
    <>
      <ControlPanel
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
        requestedSection={settingsRequest.section}
        requestedSectionRequestId={settingsRequest.id}
        isRealtimeActive={isRealtimeActive}
        isRealtimeMuted={isRealtimeMuted}
        realtimeActivationAllowed={realtimeActivationAllowed}
        realtimeStatus={realtimeStatus}
        realtimeDetail={realtimeDetail}
        realtimeError={realtimeError}
        realtimeLevel={realtimeLevel}
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
        onToggleRealtime={() => void handleRealtimeToggleRequest()}
      />
      {surface === "settings" || surface === "onboarding" ? <ResizeHandles /> : null}
    </>
  );
}
