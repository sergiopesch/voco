import { invoke } from "@tauri-apps/api/core";

/** The `voco:update-install` events Rust sends while Install update runs. */
export type UpdateInstallEvent =
  | { stage: "downloading"; version: string; file: number; files: number; received: number; total: number | null }
  | { stage: "verifying" | "authorizing" | "installing" | "installed" | "restarting" | "cancelled"; version: string }
  | { stage: "failed"; version: string; message: string };

export type UpdateInstallStage = "idle" | "starting" | UpdateInstallEvent["stage"];

export interface UpdateInstallState {
  stage: UpdateInstallStage;
  version: string | null;
  /** 0 to 1 across the whole download, or null while its size is unknown. */
  progress: number | null;
  /** The package's bytes so far, and its size when the server gave one. */
  bytes: { received: number; total: number | null } | null;
  message: string | null;
  /** The last step reached, so a failure shows where it stopped. */
  reached: InstallStepKey | null;
}

export const IDLE_INSTALL: UpdateInstallState = { stage: "idle", version: null, progress: null, bytes: null, message: null, reached: null };

export function startingInstall(version: string): UpdateInstallState {
  return { stage: "starting", version, progress: 0, bytes: null, message: null, reached: "download" };
}

/** The steps the window shows, in order. */
export const INSTALL_STEPS = [
  { key: "download", label: "Download" },
  { key: "verify", label: "Verify" },
  { key: "install", label: "Install" },
  { key: "restart", label: "Restart" },
] as const;

export type InstallStepKey = (typeof INSTALL_STEPS)[number]["key"];

const STEP_OF: Partial<Record<UpdateInstallStage, InstallStepKey>> = {
  starting: "download",
  downloading: "download",
  verifying: "verify",
  authorizing: "install",
  installing: "install",
  installed: "restart",
  restarting: "restart",
};

export function currentStep(stage: UpdateInstallStage): InstallStepKey | null {
  return STEP_OF[stage] ?? null;
}

/** Whether Install update is under way, so nothing else may start one. */
export function installBusy(state: UpdateInstallState): boolean {
  return currentStep(state.stage) !== null;
}

/** Only the download can be cancelled; the password prompt is the system's. */
export function canCancel(state: UpdateInstallState): boolean {
  return state.stage === "starting" || state.stage === "downloading";
}

/**
 * The checksums and signature are a few hundred bytes, so the package is
 * the whole bar: the first two files only move it to its start.
 */
function downloadProgress(event: Extract<UpdateInstallEvent, { stage: "downloading" }>): number | null {
  if (event.file < event.files) return 0;
  if (!event.total || event.total <= 0) return null;
  return Math.min(1, Math.max(0, event.received / event.total));
}

export function reduceInstall(state: UpdateInstallState, event: UpdateInstallEvent): UpdateInstallState {
  // An event for another release is a stale one; a new install starts at "starting".
  if (state.version !== null && event.version !== state.version) return state;
  const next = applyEvent(state, event);
  return { ...next, reached: currentStep(next.stage) ?? state.reached };
}

function applyEvent(state: UpdateInstallState, event: UpdateInstallEvent): UpdateInstallState {
  switch (event.stage) {
    case "downloading":
      return {
        stage: "downloading",
        version: event.version,
        progress: downloadProgress(event),
        bytes: event.file < event.files ? null : { received: event.received, total: event.total },
        message: null,
        reached: state.reached,
      };
    case "failed":
      return { ...state, stage: "failed", version: event.version, message: event.message };
    case "cancelled":
      return { ...state, stage: "cancelled", version: event.version, message: "The download was cancelled. Nothing was installed." };
    default:
      return { ...state, stage: event.stage, version: event.version, progress: 1, message: null };
  }
}

export type StepStatus = "done" | "active" | "waiting";

/** Each step's status: done before the current one, waiting after it. A
 * failure leaves the step it stopped at undone. */
export function stepStatuses(state: UpdateInstallState): StepStatus[] {
  const ended = state.stage === "failed" || state.stage === "cancelled";
  const at = INSTALL_STEPS.findIndex((item) => item.key === (ended ? state.reached : currentStep(state.stage)));
  return INSTALL_STEPS.map((_, index) => {
    if (at < 0 || index > at) return "waiting";
    if (index < at || state.stage === "restarting") return "done";
    return ended ? "waiting" : "active";
  });
}

export function stageHeadline(state: UpdateInstallState): string {
  const version = state.version ? `VOCO ${state.version}` : "the update";
  switch (state.stage) {
    case "starting":
    case "downloading":
      return `Downloading ${version}…`;
    case "verifying":
      return "Checking the release’s signature and checksum…";
    case "authorizing":
      return "Enter your password to install it.";
    case "installing":
      return `Installing ${version}…`;
    case "installed":
      return `${version} is installed. VOCO restarts when dictation ends.`;
    case "restarting":
      return `Restarting into ${version}…`;
    case "cancelled":
      return "Update cancelled";
    case "failed":
      return "The update didn’t install";
    default:
      return "";
  }
}

/** Decimal units, as GitHub and GNOME show file sizes: a 672,313,266-byte package is 672 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} kB`;
  return `${(bytes / 1_000_000).toFixed(bytes < 100_000_000 ? 1 : 0)} MB`;
}

export interface UpdateInstallAvailability {
  available: boolean;
  reason?: string;
}

export function updateInstallAvailability(): Promise<UpdateInstallAvailability> {
  return invoke<UpdateInstallAvailability>("update_install_availability");
}

export function installUpdate(version: string): Promise<void> {
  return invoke("install_update", { version });
}

export function cancelUpdateInstall(): Promise<boolean> {
  return invoke<boolean>("cancel_update_install");
}

/** Rust's last stage, so a window opened mid-install, or after one ended, shows it. */
export function updateInstallStatus(): Promise<UpdateInstallEvent | null> {
  return invoke<UpdateInstallEvent | null>("update_install_status");
}

export function dismissUpdateInstall(): Promise<void> {
  return invoke("dismiss_update_install");
}
