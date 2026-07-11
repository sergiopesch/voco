import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "@/store/useStore";
import {
  getConfig,
  getRuntimeDiagnostics,
  hasPendingHotkeyToggle,
  hideStatusOverlay,
  openExternalUrl,
  saveConfig,
  setDictationStatus,
  setMicrophoneReady,
  showNotification,
  showStatusOverlay,
  traceHotkeyEvent,
} from "@/lib/tauri";
import {
  checkForUpdates,
  readCachedUpdateState,
  writeCachedUpdateState,
} from "@/lib/updates";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { useDictation } from "@/hooks/useDictation";
import { useRealtimeConversation } from "@/hooks/useRealtimeConversation";
import { ControlPanel } from "@/components/ControlPanel";
import { RealtimeMicVisual } from "@/components/RealtimeMicVisual";
import { probeMicrophoneAccess } from "@/lib/audioInput";
import type {
  AppConfig,
  AudioDeviceOption,
  DictationStatus,
  RealtimeStatus,
  RuntimeDiagnostics,
} from "@/types";

const PANEL_SIZE = new LogicalSize(1040, 760);
const PANEL_MIN_SIZE = new LogicalSize(760, 560);
const POPOVER_SIZE = new LogicalSize(420, 520);
const STATUS_OVERLAY_WIDTH = 460;
const STATUS_OVERLAY_HEIGHT = 196;
const REALTIME_OVERLAY_WIDTH = 340;
const REALTIME_OVERLAY_HEIGHT = 156;
const HIDDEN_SIZE = new LogicalSize(1, 1);
const HIDDEN_POSITION = new LogicalPosition(-100, -100);
const POPOVER_MARGIN = 16;

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

function StatusOverlay({
  status,
  interimTranscript,
  transcript,
  audioLevel,
}: {
  status: DictationStatus;
  interimTranscript: string;
  transcript: string;
  audioLevel: number;
}) {
  const trimmedInterim = interimTranscript.trim();
  const hasLiveText =
    status === "recording" &&
    trimmedInterim !== "" &&
    trimmedInterim !== "Listening...";
  const headline = status === "recording" ? "Streaming words" : "Transcribing";
  const copy =
    trimmedInterim ||
    (status === "processing" && transcript
      ? transcript
      : "Speak normally. Live words will appear here before VOCO inserts the final text.");
  const meterLevel = status === "recording" ? Math.max(audioLevel, 0.06) : 1;

  return (
    <main
      className="voco-overlay"
      data-state={status}
      data-live-preview={hasLiveText ? "true" : "false"}
      aria-live="polite"
    >
      <span className="voco-overlay__eyebrow">
        {hasLiveText
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
  const config = useStore((state) => state.config);
  const setConfig = useStore((state) => state.setConfig);
  const setError = useStore((state) => state.setError);
  const setStatus = useStore((state) => state.setStatus);
  const setSurface = useStore((state) => state.setSurface);
  const setOnboardingStep = useStore((state) => state.setOnboardingStep);
  const setAvailableDevices = useStore((state) => state.setAvailableDevices);
  const setSelectedDeviceId = useStore((state) => state.setSelectedDeviceId);
  const setMicrophonePermission = useStore((state) => state.setMicrophonePermission);
  const updateState = useStore((state) => state.updateState);
  const setUpdateState = useStore((state) => state.setUpdateState);
  const {
    prepareAudioEngine,
    primeRecordingStream,
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
  const appStartMsRef = useRef(performance.now());
  const initStartedRef = useRef(false);
  const appMountedLoggedRef = useRef(false);
  const trayPopoverAnchorRef = useRef<TrayPopoverAnchor | null>(null);
  const panelSizeRef = useRef<LogicalSize>(PANEL_SIZE);
  const lastCheckedChannelRef = useRef<AppConfig["updateChannel"] | null>(null);
  const notifiedReleaseVersionRef = useRef<string | null>(null);
  const cursorStreamingMode =
    config?.transcriptTarget === "cursor" &&
    config.liveCursorMode === "stable-cursor-streaming";
  const dictationOverlayVisible =
    surface === "hidden" &&
    !cursorStreamingMode &&
    (status === "recording" || status === "processing");
  const realtimeOverlayVisible = surface === "hidden" && isRealtimeActive;
  const overlayVisible = dictationOverlayVisible || realtimeOverlayVisible;
  const canHandleHotkey = initComplete && config !== null;
  const handleToggleRequest = useCallback(() => {
    if (surface !== "hidden") {
      setSurface("hidden");
    }
    toggle();
  }, [setSurface, surface, toggle]);
  const handleRealtimeToggleRequest = useCallback(() => {
    if (surface !== "hidden") {
      setSurface("hidden");
    }
    toggleRealtime();
  }, [setSurface, surface, toggleRealtime]);

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
      await refreshDevices();
      await setMicrophoneReady(true);
      await setDictationStatus("idle");
    } catch (error) {
      setStatus("error");
      setMicrophonePermission("denied");
      await setMicrophoneReady(false).catch(() => {});
      await setDictationStatus("error").catch(() => {});
      setError(
        `Microphone access is blocked. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [
    refreshDevices,
    selectedDeviceId,
    setError,
    setMicrophonePermission,
    setStatus,
  ]);

  const refreshRuntimeDiagnostics = useCallback(async () => {
    try {
      const diagnostics = await getRuntimeDiagnostics();
      setRuntimeDiagnostics(diagnostics);
    } catch (error) {
      console.warn("Failed to load runtime diagnostics:", error);
    }
  }, []);

  const applyConfigPatch = useCallback(
    async (patch: Partial<AppConfig>) => {
      const current = useStore.getState().config;
      if (!current) {
        return;
      }

      const nextConfig = { ...current, ...patch };
      useStore.getState().setConfig(nextConfig);
      if ("selectedMic" in patch) {
        setSelectedDeviceId(nextConfig.selectedMic);
      }

      try {
        await saveConfig(nextConfig);
        setError(null);
      } catch (error) {
        useStore.getState().setConfig(current);
        if ("selectedMic" in patch) {
          setSelectedDeviceId(current.selectedMic);
        }
        setError(
          `Failed to save settings: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
    [setError, setSelectedDeviceId],
  );

  const runUpdateCheck = useCallback(
    async (
      channel: AppConfig["updateChannel"],
      currentVersionOverride?: string,
      force = false,
    ) => {
      const currentVersion =
        currentVersionOverride ?? useStore.getState().updateState.currentVersion;

      if (!currentVersion) {
        return;
      }

      const cachedState = await readCachedUpdateState(channel, currentVersion);

      if (!force) {
        if (cachedState) {
          lastCheckedChannelRef.current = channel;
          setUpdateState(cachedState);
          return;
        }
      }

      setUpdateState({
        status: "checking",
        currentVersion,
        latestRelease: useStore.getState().updateState.latestRelease,
        lastCheckedAt: useStore.getState().updateState.lastCheckedAt,
        error: null,
      });

      try {
        const nextUpdateState = await checkForUpdates({
          currentVersion,
          channel,
        });
        lastCheckedChannelRef.current = channel;
        await writeCachedUpdateState(channel, nextUpdateState);
        setUpdateState(nextUpdateState);

        if (
          nextUpdateState.status === "available" &&
          nextUpdateState.latestRelease &&
          notifiedReleaseVersionRef.current !== nextUpdateState.latestRelease.version &&
          cachedState?.latestRelease?.version !== nextUpdateState.latestRelease.version
        ) {
          notifiedReleaseVersionRef.current = nextUpdateState.latestRelease.version;
          await showNotification(
            "Update available",
            `VOCO ${nextUpdateState.latestRelease.version} is available on the ${channel} channel.`,
          ).catch(() => {});
        }
      } catch (error) {
        const errorState: typeof updateState = {
          status: "error",
          currentVersion,
          latestRelease: null,
          lastCheckedAt: new Date().toISOString(),
          error:
            error instanceof Error
              ? error.message
              : "VOCO could not check GitHub Releases right now.",
        };
        lastCheckedChannelRef.current = channel;
        setUpdateState(errorState);
      }
    },
    [setUpdateState],
  );

  useEffect(() => {
    if (initStartedRef.current) {
      return;
    }
    initStartedRef.current = true;

    async function init() {
      try {
        traceHotkeyEvent("frontend_init_started").catch(() => {});
        traceHotkeyEvent("frontend_config_load_started").catch(() => {});
        const loadedConfig = await getConfig();
        const appVersion = await getVersion();
        traceHotkeyEvent("frontend_config_loaded").catch(() => {});
        setConfig(loadedConfig);
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
        setStatus("error");
        setError(
          `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setInitComplete(true);
      }
    }
    void init();
  }, [
    prepareAudioEngine,
    primeRecordingStream,
    refreshDevices,
    setConfig,
    setError,
    setOnboardingStep,
    setStatus,
    setUpdateState,
    refreshRuntimeDiagnostics,
    runUpdateCheck,
  ]);

  useEffect(() => {
    if (!initComplete || !config?.updateChannel) {
      return;
    }
    if (lastCheckedChannelRef.current === config.updateChannel) {
      return;
    }

    void runUpdateCheck(config.updateChannel);
  }, [config?.updateChannel, initComplete, runUpdateCheck]);

  useEffect(() => {
    const currentWindow = getCurrentWindow();

    async function syncWindowSurface() {
      if (surface === "hidden") {
        await currentWindow.setAlwaysOnTop(true).catch(() => {});
        await currentWindow.setDecorations(false).catch(() => {});
        await currentWindow.setSkipTaskbar(true).catch(() => {});
        await currentWindow.setResizable(false).catch(() => {});
        await currentWindow.setMinSize(null).catch(() => {});
        await currentWindow.setIgnoreCursorEvents(true).catch(() => {});
        await currentWindow.setSize(HIDDEN_SIZE).catch(() => {});
        await currentWindow.setPosition(HIDDEN_POSITION).catch(() => {});
        return;
      }

      if (surface === "popover") {
        await currentWindow.setIgnoreCursorEvents(false).catch(() => {});
        await currentWindow.setAlwaysOnTop(true).catch(() => {});
        await currentWindow.setDecorations(false).catch(() => {});
        await currentWindow.setSkipTaskbar(false).catch(() => {});
        await currentWindow.setResizable(false).catch(() => {});
        await currentWindow.setMinSize(null).catch(() => {});
        await currentWindow.setSize(POPOVER_SIZE).catch(() => {});

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

          const monitorX = targetMonitor?.position.x ?? 0;
          const monitorY = targetMonitor?.position.y ?? 0;
          const monitorWidth = targetMonitor?.size.width ?? window.screen.width;
          const monitorHeight = targetMonitor?.size.height ?? window.screen.height;
          const popoverWidth = POPOVER_SIZE.width;
          const popoverHeight = POPOVER_SIZE.height;

          const anchorCenterX =
            anchor.rectPositionX + anchor.rectWidth / 2;
          let x = anchorCenterX - popoverWidth / 2;
          let y = anchor.rectPositionY + anchor.rectHeight + 10;

          x = Math.max(
            monitorX + POPOVER_MARGIN,
            Math.min(
              x,
              monitorX + monitorWidth - popoverWidth - POPOVER_MARGIN,
            ),
          );

          if (y + popoverHeight > monitorY + monitorHeight - POPOVER_MARGIN) {
            y = anchor.rectPositionY - popoverHeight - 10;
          }
          y = Math.max(
            monitorY + POPOVER_MARGIN,
            Math.min(
              y,
              monitorY + monitorHeight - popoverHeight - POPOVER_MARGIN,
            ),
          );

          await currentWindow
            .setPosition(new LogicalPosition(x, y))
            .catch(() => {});
        } else {
          await currentWindow.center().catch(() => {});
        }
        await currentWindow.show().catch(() => {});
        await currentWindow.setFocus().catch(() => {});
        return;
      }

      await currentWindow.setIgnoreCursorEvents(false).catch(() => {});
      await currentWindow.setAlwaysOnTop(false).catch(() => {});
      await currentWindow.setDecorations(false).catch(() => {});
      await currentWindow.setSkipTaskbar(false).catch(() => {});
      await currentWindow.setMinSize(PANEL_MIN_SIZE).catch(() => {});
      await currentWindow.setResizable(true).catch(() => {});
      await currentWindow.setSize(panelSizeRef.current).catch(() => {});
      await currentWindow.center().catch(() => {});
      await currentWindow.show().catch(() => {});
      await currentWindow.setFocus().catch(() => {});
    }

    void syncWindowSurface();
  }, [surface]);

  useEffect(() => {
    if (surface !== "settings" && surface !== "onboarding") {
      return;
    }

    let unlisten: (() => void) | null = null;
    const currentWindow = getCurrentWindow();
    void currentWindow
      .onResized(({ payload }) => {
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
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });

    return () => {
      unlisten?.();
    };
  }, [surface]);

  useEffect(() => {
    if (surface !== "hidden") {
      return;
    }

    if (overlayVisible) {
      void showStatusOverlay(
        realtimeOverlayVisible ? REALTIME_OVERLAY_WIDTH : STATUS_OVERLAY_WIDTH,
        realtimeOverlayVisible ? REALTIME_OVERLAY_HEIGHT : STATUS_OVERLAY_HEIGHT,
      ).catch(() => {});
      void getCurrentWindow()
        .setIgnoreCursorEvents(!realtimeOverlayVisible)
        .catch(() => {});
      return;
    }

    void hideStatusOverlay().catch(() => {});
  }, [overlayVisible, realtimeOverlayVisible, surface]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        setSurface("hidden");
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });

    return () => {
      unlisten?.();
    };
  }, [setSurface]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void getCurrentWindow()
      .listen("voco:open-settings", () => {
        void refreshDevices();
        void refreshRuntimeDiagnostics();
        setSurface("settings");
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });

    return () => {
      unlisten?.();
    };
  }, [refreshDevices, refreshRuntimeDiagnostics, setSurface]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void getCurrentWindow()
      .listen<TrayPopoverAnchor>("voco:open-popover", (event) => {
        trayPopoverAnchorRef.current = event.payload;
        setSurface(useStore.getState().surface === "popover" ? "hidden" : "popover");
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });

    return () => {
      unlisten?.();
    };
  }, [setSurface]);

  const statusLabel =
    status === "recording"
      ? "Listening"
      : status === "processing"
        ? "Processing"
        : status === "error"
          ? "Needs attention"
          : "Ready to listen";

  if (!config) {
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
        errorMessage={error}
        statusLabel={statusLabel}
        updateState={updateState}
        runtimeDiagnostics={runtimeDiagnostics}
        isDictationActive={status === "recording" || status === "processing"}
        isRealtimeActive={isRealtimeActive}
        realtimeStatus={realtimeStatus}
        realtimeDetail={realtimeDetail}
        realtimeError={realtimeError}
        realtimeLevel={realtimeLevel}
        selectedDeviceId={selectedDeviceId}
        availableDevices={availableDevices}
        microphonePermission={microphonePermission}
        onSurfaceChange={setSurface}
        onOnboardingStepChange={setOnboardingStep}
        onConfigChange={applyConfigPatch}
        onRefreshDevices={refreshDevices}
        onSelectedDeviceChange={setSelectedDeviceId}
        onRequestMicrophoneAccess={requestMicrophoneAccess}
        onCheckForUpdates={() => runUpdateCheck(config.updateChannel, undefined, true)}
        onOpenReleasePage={(url) => openExternalUrl(url)}
        onRefreshRuntimeDiagnostics={refreshRuntimeDiagnostics}
        onToggleDictation={toggle}
        onToggleRealtime={toggleRealtime}
      />
      {surface === "settings" || surface === "onboarding" ? <ResizeHandles /> : null}
    </>
  );
}
