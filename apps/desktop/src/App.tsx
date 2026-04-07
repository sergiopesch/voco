import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "@/store/useStore";
import { getConfig, openExternalUrl, saveConfig, showNotification } from "@/lib/tauri";
import {
  checkForUpdates,
  readCachedUpdateState,
  writeCachedUpdateState,
} from "@/lib/updates";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { useDictation } from "@/hooks/useDictation";
import { ControlPanel } from "@/components/ControlPanel";
import { StatusOverlay } from "@/components/StatusOverlay";
import type { AppConfig, AudioDeviceOption } from "@/types";

const PANEL_SIZE = new LogicalSize(1040, 760);
const POPOVER_SIZE = new LogicalSize(420, 520);
const HIDDEN_SIZE = new LogicalSize(1, 1);
const HIDDEN_POSITION = new LogicalPosition(-100, -100);
const POPOVER_MARGIN = 16;

type TrayPopoverAnchor = {
  rectPositionX: number;
  rectPositionY: number;
  rectWidth: number;
  rectHeight: number;
};

export function App() {
  const status = useStore((state) => state.status);
  const error = useStore((state) => state.error);
  const surface = useStore((state) => state.surface);
  const onboardingStep = useStore((state) => state.onboardingStep);
  const selectedDeviceId = useStore((state) => state.selectedDeviceId);
  const availableDevices = useStore((state) => state.availableDevices);
  const microphonePermission = useStore((state) => state.microphonePermission);
  const config = useStore((state) => state.config);
  const setConfig = useStore((state) => state.setConfig);
  const setError = useStore((state) => state.setError);
  const setSurface = useStore((state) => state.setSurface);
  const setOnboardingStep = useStore((state) => state.setOnboardingStep);
  const setAvailableDevices = useStore((state) => state.setAvailableDevices);
  const setSelectedDeviceId = useStore((state) => state.setSelectedDeviceId);
  const setMicrophonePermission = useStore((state) => state.setMicrophonePermission);
  const updateState = useStore((state) => state.updateState);
  const setUpdateState = useStore((state) => state.setUpdateState);
  const {
    prepareWindow,
    initializeMicrophone,
    syncIndicatorWindow,
    toggle,
    onHotkeyPressed,
  } = useDictation();
  const [initComplete, setInitComplete] = useState(false);
  const appStartMsRef = useRef(performance.now());
  const initStartedRef = useRef(false);
  const trayPopoverAnchorRef = useRef<TrayPopoverAnchor | null>(null);
  const lastCheckedChannelRef = useRef<AppConfig["updateChannel"] | null>(null);
  const notifiedReleaseVersionRef = useRef<string | null>(null);

  useGlobalShortcut(
    toggle,
    initComplete && surface === "hidden",
    appStartMsRef.current,
    onHotkeyPressed,
  );

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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophonePermission("granted");
      await refreshDevices();
      await initializeMicrophone(performance.now());
    } catch (error) {
      setMicrophonePermission("denied");
      setError(
        `Microphone access is blocked. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [
    initializeMicrophone,
    refreshDevices,
    selectedDeviceId,
    setError,
    setMicrophonePermission,
  ]);

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
        await writeCachedUpdateState(channel, errorState);
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
        const loadedConfig = await getConfig();
        const appVersion = await getVersion();
        setConfig(loadedConfig);
        setUpdateState({
          status: "idle",
          currentVersion: appVersion,
          latestRelease: null,
          lastCheckedAt: null,
          error: null,
        });
        setOnboardingStep(0);
        await prepareWindow();
        await initializeMicrophone(appStartMsRef.current);
        await refreshDevices();
        await runUpdateCheck(loadedConfig.updateChannel, appVersion);
      } catch (err) {
        setError(
          `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setInitComplete(true);
      }
    }
    void init();
  }, [
    initializeMicrophone,
    prepareWindow,
    refreshDevices,
    setConfig,
    setError,
    setOnboardingStep,
    setUpdateState,
    runUpdateCheck,
  ]);

  useEffect(() => {
    void syncIndicatorWindow(config?.showHud !== false ? status : "idle");
  }, [config?.showHud, status, syncIndicatorWindow]);

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
      await currentWindow.setResizable(true).catch(() => {});
      await currentWindow.setSize(PANEL_SIZE).catch(() => {});
      await currentWindow.center().catch(() => {});
      await currentWindow.show().catch(() => {});
      await currentWindow.setFocus().catch(() => {});
    }

    void syncWindowSurface();
  }, [surface]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void getCurrentWindow()
      .listen("voco:open-settings", () => {
        void refreshDevices();
        setSurface("settings");
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });

    return () => {
      unlisten?.();
    };
  }, [refreshDevices, setSurface]);

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

  return surface === "hidden" ? (
    <StatusOverlay />
  ) : (
    <ControlPanel
      surface={surface}
      onboardingStep={onboardingStep}
      config={config}
      errorMessage={error}
      statusLabel={statusLabel}
      updateState={updateState}
      isDictationActive={status === "recording" || status === "processing"}
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
      onToggleDictation={toggle}
    />
  );
}
