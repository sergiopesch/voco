import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AppConfig,
  AudioDeviceOption,
  RuntimeDiagnostics,
  UpdateCheckState,
} from "@/types";
import { calculateVisualAudioLevelFromSamples } from "@/lib/audioLevel";
import { openMicrophoneStream } from "@/lib/audioInput";
import vocoBrandImage from "../../../../assets/voco-logo.png";
import vocoTrayReadyImage from "../../../../assets/voco logo green v1.png";
import vocoTrayRecordingImage from "../../../../assets/voco logo red v1.png";
import vocoTrayProcessingImage from "../../../../assets/voco logo yellow v1.png";

interface ControlPanelProps {
  surface: "onboarding" | "settings" | "popover";
  onboardingStep: number;
  config: AppConfig;
  errorMessage: string | null;
  statusLabel: string;
  updateState: UpdateCheckState;
  runtimeDiagnostics: RuntimeDiagnostics | null;
  isDictationActive: boolean;
  selectedDeviceId: string | null;
  availableDevices: AudioDeviceOption[];
  microphonePermission: "unknown" | "granted" | "denied";
  onSurfaceChange: (surface: "hidden" | "onboarding" | "settings" | "popover") => void;
  onOnboardingStepChange: (step: number) => void;
  onConfigChange: (patch: Partial<AppConfig>) => Promise<void>;
  onRefreshDevices: () => Promise<void>;
  onSelectedDeviceChange: (deviceId: string | null) => void;
  onRequestMicrophoneAccess: () => Promise<void>;
  onCheckForUpdates: () => Promise<void>;
  onOpenReleasePage: (url: string) => Promise<void>;
  onRefreshRuntimeDiagnostics: () => Promise<void>;
  onToggleDictation: () => void;
}

const PANEL_SECTIONS = [
  "General",
  "Audio",
  "Hotkeys",
  "Appearance",
  "Updates",
  "Advanced",
] as const;

type PanelSection = (typeof PANEL_SECTIONS)[number];

const TRAY_COLOR_LEGEND = [
  { label: "Ready", image: vocoTrayReadyImage },
  { label: "Listening", image: vocoTrayRecordingImage },
  { label: "Transcribing", image: vocoTrayProcessingImage },
] as const;

export function ControlPanel({
  surface,
  onboardingStep,
  config,
  errorMessage,
  statusLabel,
  updateState,
  runtimeDiagnostics,
  isDictationActive,
  selectedDeviceId,
  availableDevices,
  microphonePermission,
  onSurfaceChange,
  onOnboardingStepChange,
  onConfigChange,
  onRefreshDevices,
  onSelectedDeviceChange,
  onRequestMicrophoneAccess,
  onCheckForUpdates,
  onOpenReleasePage,
  onRefreshRuntimeDiagnostics,
  onToggleDictation,
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

  const isPopover = surface === "popover";
  const isOnboarding = surface === "onboarding";
  const [activeSection, setActiveSection] = useState<PanelSection>("General");
  const [saving, setSaving] = useState(false);
  const [hotkeyDraft, setHotkeyDraft] = useState(config.hotkey);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [previewLevel, setPreviewLevel] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const selectedDeviceLabel = useMemo(
    () =>
      availableDevices.find((device) => device.deviceId === selectedDeviceId)?.label ??
      "System default",
    [availableDevices, selectedDeviceId],
  );
  const updateInstallCopy = useMemo(() => {
    switch (config.installChannel) {
      case "appimage":
        return "This build is treated as portable. Replace the AppImage manually when a new release lands.";
      case "source":
        return "This build is treated as self-managed from source. Pull the repo and rebuild when you want to update.";
      case "flatpak":
        return "This build is treated as store-managed through Flatpak. Let your software center handle updates.";
      case "snap":
        return "This build is treated as store-managed through Snap. Automatic refreshes should apply in the background.";
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
        return `Replace your current AppImage with ${updateState.latestRelease.version} from GitHub Releases, then relaunch VOCO.`;
      case "source":
        return `Pull the repo, checkout ${updateState.latestRelease.version} or newer, and rebuild locally.`;
      case "flatpak":
        return "This install channel should update through Flatpak once the new build is published there.";
      case "snap":
        return "This install channel should update through Snap refresh once the new build is published there.";
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
    ? "Voco"
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
    const shouldPreview =
      (surface === "onboarding" && onboardingStep === 1) ||
      (surface === "settings" && activeSection === "Audio");
    if (!shouldPreview) {
      setPreviewLevel(0);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let data: Float32Array | null = null;

    const tick = () => {
      if (cancelled || !analyser || !data) {
        return;
      }
      analyser.getFloatTimeDomainData(data as unknown as Float32Array<ArrayBuffer>);
      setPreviewLevel(calculateVisualAudioLevelFromSamples(data));
      previewFrameRef.current = window.requestAnimationFrame(tick);
    };

    void openMicrophoneStream(selectedDeviceId)
      .then(async (nextStream) => {
        if (cancelled) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }
        setPreviewError(null);
        stream = nextStream;
        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        data = new Float32Array(
          new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT),
        );
        source = audioContext.createMediaStreamSource(nextStream);
        source.connect(analyser);
        tick();
      })
      .catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        setPreviewError(detail);
        setPreviewLevel(0);
      });

    return () => {
      cancelled = true;
      if (previewFrameRef.current !== null) {
        window.cancelAnimationFrame(previewFrameRef.current);
        previewFrameRef.current = null;
      }
      source?.disconnect();
      analyser?.disconnect();
      void audioContext?.close().catch(() => {});
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [activeSection, onboardingStep, selectedDeviceId, surface]);

  async function savePatch(
    patch: Partial<AppConfig>,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    setSaving(true);
    try {
      await onConfigChange(patch);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "VOCO could not save those settings.",
      };
    } finally {
      setSaving(false);
    }
  }

  async function saveHotkey(): Promise<boolean> {
    const normalizedHotkey = hotkeyDraft.trim() || "Alt+D";
    setHotkeyDraft(normalizedHotkey);
    setHotkeyError(null);

    const result = await savePatch({ hotkey: normalizedHotkey });
    if (result.ok) {
      return true;
    }

    setHotkeyError(result.message);
    return false;
  }

  return (
    <main className="voco-panel" data-surface={surface}>
      <section className="voco-panel__shell">
        <header
          className="voco-panel__hero"
          data-tauri-drag-region
          onMouseDown={(event) => void handleHeaderPointerDown(event)}
        >
          <div className="voco-panel__brand">
            <div className="voco-panel__brand-mark" aria-hidden="true">
              <img
                className="voco-panel__brand-mark-image"
                src={vocoBrandImage}
                alt=""
              />
            </div>
            <div>
              <p className="voco-panel__eyebrow">{panelEyebrow}</p>
              <h1 className="voco-panel__title">{panelTitle}</h1>
            </div>
          </div>
          <div className="voco-panel__hero-actions">
            <button
              className="voco-button voco-button--ghost voco-button--compact"
              onClick={() => onSurfaceChange("hidden")}
            >
              Hide to tray
            </button>
          </div>
        </header>

        {errorMessage ? (
          <section className="voco-panel__error" aria-live="polite">
            {errorMessage}
          </section>
        ) : null}

        {isPopover ? (
          <section className="voco-popover">
            <div className="voco-popover__state">
              <span className="voco-panel__state-label">Current state</span>
              <strong>{statusLabel}</strong>
              <p>Hotkey: <code>{config.hotkey}</code></p>
            </div>
            <div className="voco-popover__actions">
              <button className="voco-button voco-button--primary" onClick={onToggleDictation}>
                {isDictationActive ? "Stop listening" : "Start listening"}
              </button>
              <button
                className="voco-button voco-button--secondary"
                onClick={() => onSurfaceChange("settings")}
              >
                Settings
              </button>
              <button
                className="voco-button voco-button--ghost"
                onClick={() => onSurfaceChange("hidden")}
              >
                Hide to tray
              </button>
            </div>
            <div className="voco-inline-note">
              Selected input: {selectedDeviceLabel}
            </div>
          </section>
        ) : isOnboarding ? (
          <section className="voco-panel__content">
            <div className="voco-onboarding__progress">
              {[0, 1, 2].map((step) => (
                <span
                  key={step}
                  className="voco-onboarding__progress-item"
                >
                  <span
                    className={[
                      "voco-onboarding__dot",
                      onboardingStep === step ? "voco-onboarding__dot--active" : "",
                      onboardingStep > step ? "voco-onboarding__dot--complete" : "",
                    ].join(" ")}
                  />
                </span>
              ))}
            </div>

            {onboardingStep === 0 ? (
              <section className="voco-onboarding__step">
                <h2>Welcome to Voco</h2>
                <p>
                  Your voice-first Linux command layer.
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
                    onClick={async () => {
                      const result = await savePatch({ onboardingCompleted: true });
                      if (result.ok) {
                        onSurfaceChange("hidden");
                      }
                    }}
                  >
                    Skip for now
                  </button>
                </div>
              </section>
            ) : null}

            {onboardingStep === 1 ? (
              <section className="voco-onboarding__step">
                <h2>Microphone and hotkey</h2>
                <p>
                  Pick your mic and confirm the hotkey you want to use.
                </p>
                <label className="voco-field">
                  <span>Input device</span>
                  <select
                    value={selectedDeviceId ?? ""}
                    onChange={(event) => onSelectedDeviceChange(event.target.value || null)}
                  >
                    <option value="">System default</option>
                    {availableDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="voco-inline-note">
                  <strong>Mic:</strong> {selectedDeviceLabel} · <strong>Access:</strong>{" "}
                  {microphonePermission}
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
                    Speak normally. The bar should move.
                  </span>
                </div>
                <label className="voco-field">
                  <span>Hotkey</span>
                  <input
                    value={hotkeyDraft}
                    onChange={(event) => setHotkeyDraft(event.target.value)}
                    onBlur={() => {
                      if (hotkeyDraft !== config.hotkey) {
                        void saveHotkey();
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveHotkey();
                      }
                    }}
                  />
                </label>
                {hotkeyError ? (
                  <div className="voco-inline-note voco-inline-note--error">
                    {hotkeyError}
                  </div>
                ) : null}
                {previewError ? (
                  <div className="voco-inline-note voco-inline-note--error">
                    {previewError}
                  </div>
                ) : null}
                <div className="voco-onboarding__actions">
                  <button
                    className="voco-button voco-button--ghost"
                    onClick={() => void onRequestMicrophoneAccess()}
                  >
                    Retry microphone access
                  </button>
                  <button
                    className="voco-button voco-button--secondary"
                    onClick={() => onOnboardingStepChange(0)}
                  >
                    Back
                  </button>
                  <button
                    className="voco-button voco-button--primary"
                    onClick={async () => {
                      const micSaved = await savePatch({ selectedMic: selectedDeviceId });
                      const hotkeySaved = micSaved.ok ? await saveHotkey() : false;
                      if (micSaved.ok && hotkeySaved) {
                        onOnboardingStepChange(2);
                      }
                    }}
                  >
                    Continue
                  </button>
                </div>
              </section>
            ) : null}

            {onboardingStep === 2 ? (
              <section className="voco-onboarding__step">
                <h2>Ready to use</h2>
                <p>
                  Press <code>{config.hotkey}</code> to start and stop listening.
                </p>
                <div className="voco-tray-legend" aria-label="Tray icon colors">
                  {TRAY_COLOR_LEGEND.map((item) => (
                    <article key={item.label} className="voco-tray-legend__item">
                      <div className="voco-tray-legend__icon" aria-hidden="true">
                        <img src={item.image} alt="" />
                      </div>
                      <span>{item.label}</span>
                    </article>
                  ))}
                </div>
                <div className="voco-inline-note">
                  You can reopen settings from the tray any time.
                </div>
                <div className="voco-onboarding__actions">
                  <button
                    className="voco-button voco-button--secondary"
                    onClick={() => onOnboardingStepChange(1)}
                  >
                    Back
                  </button>
                  <button
                    className="voco-button voco-button--primary"
                    onClick={async () => {
                      const result = await savePatch({ onboardingCompleted: true, voiceProfile: "default" });
                      if (result.ok) {
                        onSurfaceChange("hidden");
                      }
                    }}
                  >
                    Finish setup
                  </button>
                </div>
              </section>
            ) : null}
          </section>
        ) : (
          <section className="voco-settings">
            <nav className="voco-settings__nav" aria-label="Settings sections">
              {PANEL_SECTIONS.map((section) => (
                <button
                  key={section}
                  className={[
                    "voco-settings__nav-item",
                    activeSection === section ? "voco-settings__nav-item--active" : "",
                  ].join(" ")}
                  onClick={() => setActiveSection(section)}
                >
                  {section}
                </button>
              ))}
            </nav>

            <div className="voco-settings__content">
              {activeSection === "General" ? (
                <section className="voco-settings__section">
                  <h2>General</h2>
                  <div className="voco-inline-note">
                    VOCO stays in the tray and keeps the visible UI lightweight.
                  </div>
                  <div className="voco-inline-note">
                    The tray icon reflects runtime state directly: green when ready, red
                    while listening, yellow while transcribing, and graphite when VOCO
                    needs attention.
                  </div>
                  <div className="voco-inline-note">
                    On Linux, the command panel opens from the tray icon or tray menu, with
                    the tray menu kept as a reliable fallback path.
                  </div>
                </section>
              ) : null}

              {activeSection === "Audio" ? (
                <section className="voco-settings__section">
                  <h2>Audio</h2>
                  <p>Choose the microphone VOCO should prefer.</p>
                  <label className="voco-field">
                    <span>Input device</span>
                    <select
                      value={selectedDeviceId ?? ""}
                      onChange={(event) => onSelectedDeviceChange(event.target.value || null)}
                    >
                      <option value="">System default</option>
                      {availableDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="voco-settings__actions">
                    <button
                      className="voco-button voco-button--ghost"
                      onClick={() => void onRequestMicrophoneAccess()}
                    >
                      Retry microphone access
                    </button>
                    <button
                      className="voco-button voco-button--secondary"
                      onClick={() => void onRefreshDevices()}
                    >
                      Refresh devices
                    </button>
                    <button
                      className="voco-button voco-button--primary"
                      onClick={() => void savePatch({ selectedMic: selectedDeviceId })}
                    >
                      Save audio settings
                    </button>
                  </div>
                  <div className="voco-meter">
                    <span className="voco-meter__label">Live level</span>
                    <div className="voco-meter__track" aria-hidden="true">
                      <div
                        className="voco-meter__fill"
                        style={{ transform: `scaleX(${previewLevel})` }}
                      />
                    </div>
                  </div>
                  {previewError ? (
                    <div className="voco-inline-note voco-inline-note--error">
                      {previewError}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {activeSection === "Hotkeys" ? (
                <section className="voco-settings__section">
                  <h2>Hotkeys</h2>
                  <label className="voco-field">
                    <span>Start and stop listening</span>
                    <input
                      value={hotkeyDraft}
                      onChange={(event) => setHotkeyDraft(event.target.value)}
                      onBlur={() => {
                        if (hotkeyDraft !== config.hotkey) {
                          void saveHotkey();
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveHotkey();
                        }
                      }}
                    />
                  </label>
                  {hotkeyError ? (
                    <div className="voco-inline-note voco-inline-note--error">
                      {hotkeyError}
                    </div>
                  ) : null}
                  <div className="voco-settings__actions">
                    <button
                      className="voco-button voco-button--primary"
                      onClick={() => void saveHotkey()}
                    >
                      Save hotkey
                    </button>
                  </div>
                  <div className="voco-inline-note">
                    The current backend is most reliable with <code>Alt+D</code> and{" "}
                    <code>Alt+Shift+D</code> on Wayland.
                  </div>
                </section>
              ) : null}

              {activeSection === "Appearance" ? (
                <section className="voco-settings__section">
                  <h2>Appearance</h2>
                  <p>
                    VOCO currently ships with an opinionated dark interface based on the new graphite microphone branding.
                  </p>
                  <div className="voco-inline-note">
                    Theme switching is intentionally deferred until the product surfaces
                    stabilize.
                  </div>
                </section>
              ) : null}

              {activeSection === "Updates" ? (
                <section className="voco-settings__section">
                  <h2>Updates</h2>
                  <label className="voco-field">
                    <span>Install channel</span>
                    <select
                      value={config.installChannel}
                      onChange={(event) =>
                        void savePatch({
                          installChannel: event.target.value as AppConfig["installChannel"],
                        })
                      }
                    >
                      <option value="github-release">GitHub Release</option>
                      <option value="appimage">AppImage</option>
                      <option value="source">Source build</option>
                      <option value="flatpak">Flatpak</option>
                      <option value="snap">Snap</option>
                    </select>
                  </label>
                  <label className="voco-field">
                    <span>Update channel</span>
                    <select
                      value={config.updateChannel}
                      onChange={(event) =>
                        void savePatch({
                          updateChannel: event.target.value as AppConfig["updateChannel"],
                        })
                      }
                    >
                      <option value="stable">Stable</option>
                      <option value="beta">Beta</option>
                    </select>
                  </label>
                  <div className="voco-inline-note">
                    <strong>Current version:</strong>{" "}
                    <code>{updateState.currentVersion ?? "unknown"}</code>
                  </div>
                  <div className="voco-inline-note">{updateInstallCopy}</div>
                  <div className="voco-inline-note">
                    {config.updateChannel === "beta"
                      ? "Beta updates should be treated as higher-churn builds with faster feedback cycles."
                      : "Stable updates should remain the default for day-to-day use."}
                  </div>
                  <div className="voco-inline-note">{updateStatusCopy}</div>
                  <div className="voco-inline-note">
                    <strong>Last checked:</strong> {lastCheckedLabel}
                  </div>
                  {updateState.latestRelease ? (
                    <div className="voco-inline-note">
                      <strong>Latest release:</strong>{" "}
                      <code>{updateState.latestRelease.version}</code>
                    </div>
                  ) : null}
                  {upgradePrompt ? (
                    <div className="voco-inline-note">
                      <strong>Upgrade path:</strong> {upgradePrompt}
                    </div>
                  ) : null}
                  {updateState.latestRelease?.url ? (
                    <div className="voco-inline-note">
                      <strong>Release page:</strong> <code>{updateState.latestRelease.url}</code>
                    </div>
                  ) : null}
                  <div className="voco-settings__actions">
                    <button
                      className="voco-button voco-button--secondary"
                      onClick={() => void onCheckForUpdates()}
                    >
                      {updateState.status === "checking"
                        ? "Checking…"
                        : "Check for updates"}
                    </button>
                    {updateState.latestRelease?.url ? (
                      <button
                        className="voco-button voco-button--ghost"
                        onClick={() => void onOpenReleasePage(updateState.latestRelease!.url)}
                      >
                        Open latest release
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {activeSection === "Advanced" ? (
                <section className="voco-settings__section">
                  <h2>Advanced</h2>
                  <label className="voco-field">
                    <span>Insertion strategy</span>
                    <select
                      value={config.insertionStrategy}
                      onChange={(event) =>
                        void savePatch({
                          insertionStrategy: event.target.value as AppConfig["insertionStrategy"],
                        })
                      }
                    >
                      <option value="auto">Auto</option>
                      <option value="clipboard">Clipboard</option>
                      <option value="type-simulation">Type simulation</option>
                    </select>
                  </label>
                  <div className="voco-inline-note">
                    Settings are stored locally and can be reset by deleting the VOCO config directory.
                  </div>
                  <div className="voco-inline-note">
                    <strong>Session:</strong> {runtimeSessionLabel}
                  </div>
                  <div className="voco-inline-note">
                    <strong>Type simulation:</strong> {typeSimulationLabel}
                  </div>
                  {runtimeDiagnostics ? (
                    <div className="voco-inline-note">
                      {runtimeDiagnostics.typeSimulation.detail}
                    </div>
                  ) : null}
                  <div className="voco-inline-note">
                    <strong>Clipboard insertion:</strong> {clipboardLabel}
                  </div>
                  {runtimeDiagnostics ? (
                    <div className="voco-inline-note">
                      {runtimeDiagnostics.clipboard.detail}
                    </div>
                  ) : null}
                  <div className="voco-settings__actions">
                    <button
                      className="voco-button voco-button--secondary"
                      onClick={() => void onRefreshRuntimeDiagnostics()}
                    >
                      Refresh runtime checks
                    </button>
                  </div>
                  <label className="voco-field">
                    <span>Voice profile</span>
                    <select
                      value="default"
                      disabled
                    >
                      <option value="default">Default</option>
                    </select>
                  </label>
                  <div className="voco-inline-note">
                    Accent-aware recognition is planned for a future release and is not
                    configurable yet.
                  </div>
                </section>
              ) : null}

              <div className="voco-settings__footer-actions">
                <button
                  className="voco-button voco-button--secondary"
                  onClick={() => onSurfaceChange("hidden")}
                >
                  Close panel
                </button>
              </div>
            </div>
          </section>
        )}

        {!isPopover ? (
          <footer className="voco-panel__footer">
            <span>{saving ? "Saving…" : "Changes are stored locally on this machine."}</span>
            {surface === "settings" ? (
              <button
                className="voco-button voco-button--ghost"
                onClick={async () => {
                  const result = await savePatch({ onboardingCompleted: false });
                  if (result.ok) {
                    onOnboardingStepChange(0);
                    onSurfaceChange("onboarding");
                  }
                }}
              >
                Re-run onboarding
              </button>
            ) : null}
          </footer>
        ) : null}
      </section>
    </main>
  );
}
