// Isolated presentation fixture. No App bootstrap, microphone, clipboard or native commands.
import desktopPackage from "../package.json";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ComponentProps } from "react";
import { ControlPanel } from "../src/components/ControlPanel";
import { CrashReview } from "../src/components/CrashReview";
import { useStore } from "../src/store/useStore";
import type { DictationStatus } from "../src/types";
import type { NativeCaptureSource } from "../src/lib/nativeCaptureSettings";
import "@fontsource/geist/latin-400.css";
import "@fontsource/geist/latin-500.css";
import "@fontsource/geist/latin-600.css";
import "@fontsource/geist/latin-700.css";
import "@fontsource/geist-mono/latin-400.css";
import "../src/styles.css";

const params = new URLSearchParams(location.search);
const initial = params.get("state") ?? "idle";
const sources: NativeCaptureSource[] = [
  { selectionToken: "desk", name: "desk", label: "Studio microphone", index: 1, objectSerial: "1", isMonitor: false },
  { selectionToken: "lost", name: "lost", label: "Disconnected microphone", index: 2, objectSerial: null, isMonitor: false },
  { selectionToken: "usb", name: "usb", label: "USB microphone", index: 3, objectSerial: "3", isMonitor: false },
  ...Array.from({ length: 12 }, (_, i) => ({ selectionToken: `device-${i}`, name: `device-${i}`, label: `External audio interface ${i + 1} — rear microphone input with a long device name`, index: i + 4, objectSerial: String(i + 4), isMonitor: false })),
];
const sampleTranscript = "A quiet space for your voice. Your words stay on this computer.";
useStore.setState({ audioLevel: initial === "recording" ? .65 : 0, dictationPurpose: initial === "idle" ? "cursor" : "onboarding", onboardingTestPassed: initial === "success",
  transcript: initial === "recording" || initial === "success" || initial === "error" ? sampleTranscript : "" });
const noop = async () => {};
function Fixture() {
  const [surface, setSurface] = useState<ComponentProps<typeof ControlPanel>["surface"]>(params.get("surface") === "settings" ? "settings" : params.get("surface") === "popover" ? "popover" : "onboarding");
  const [status, setStatus] = useState<DictationStatus>(["starting", "recording", "processing", "error"].includes(initial) ? initial as DictationStatus : "idle");
  const [selected, setSelected] = useState<NativeCaptureSource | null>(params.get("surface") === "popover" ? sources[0] ?? null : null);
  const [section, setSection] = useState<ComponentProps<typeof ControlPanel>["requestedSection"]>("Audio");
  const [config, setConfig] = useState<ComponentProps<typeof ControlPanel>["config"]>({ hotkey: "Alt+D", selectedMic: null, onboardingCompleted: false, updateChannel: "stable", automaticUpdateChecks: true, installChannel: "github-release" });
  return <ControlPanel surface={surface} config={config} dictationStatus={status}
    statusLabel={status === "error" ? "Needs attention" : "Ready to listen"}
    errorMessage={initial === "error" ? "The test could not finish. Try again when your microphone is ready." : null}
    updateState={{ status: "idle", currentVersion: desktopPackage.version, latestRelease: null, lastCheckedAt: null, error: null }}
    runtimeDiagnostics={null} requestedSection={section} requestedSectionRequestId={0}
    selectedDeviceId={null} availableDevices={[]} microphonePermission="unknown"
    nativeMicrophone={{ mode: "native", sources: { revision: "1", defaultSelectionToken: "desk", sources }, selected, busy: false, error: null,
      initialize: noop, refresh: noop, ensureDefault: noop, select: async token => { const source = sources.find(source => source.selectionToken === token); setSelected(source ?? null); return Boolean(source); } }}
    onSurfaceChange={next => { if (next !== "hidden") setSurface(next); }}
    onConfigChange={async patch => { setConfig(previous => ({ ...previous, ...patch })); }}
    onRefreshDevices={noop} onRequestMicrophoneAccess={async () => true} onCheckForUpdates={noop}
    onOpenReleasePage={noop} onRefreshRuntimeDiagnostics={noop}
    onOpenSettings={async next => { setSection(next ?? "General"); setSurface("settings"); }}
    onStartTest={() => { setStatus("recording"); useStore.setState({ audioLevel: .65, dictationPurpose: "onboarding", onboardingTestPassed: false, transcript: sampleTranscript }); }}
    onStopTest={() => { setStatus("idle"); useStore.setState({ audioLevel: 0, onboardingTestPassed: true }); }}
    onFinishTest={async () => true}
  />;
}
const root = createRoot(document.getElementById("root")!);
root.render(params.get("surface") === "review" ? <CrashReview onClose={() => { document.documentElement.dataset.closed = "true"; }} onOpenSettings={() => { document.documentElement.dataset.settings = "true"; }} /> : <Fixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
