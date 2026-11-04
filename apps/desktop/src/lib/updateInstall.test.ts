import { describe, expect, it } from "vitest";
import {
  canCancel,
  formatBytes,
  IDLE_INSTALL,
  installBusy,
  reduceInstall,
  stageHeadline,
  startingInstall,
  stepStatuses,
  type UpdateInstallEvent,
  type UpdateInstallState,
} from "./updateInstall";

const run = (events: UpdateInstallEvent[], from: UpdateInstallState = startingInstall("2026.0.66")) =>
  events.reduce(reduceInstall, from);
const download = (file: number, received: number, total: number | null): UpdateInstallEvent =>
  ({ stage: "downloading", version: "2026.0.66", file, files: 3, received, total });

describe("Install update's state", () => {
  it("moves the bar only with the package, and through every step to the restart", () => {
    let state = run([download(1, 400, 400), download(2, 228, 228)]);
    expect(state).toMatchObject({ stage: "downloading", progress: 0, bytes: null });
    state = run([download(3, 350, 700)], state);
    expect(state).toMatchObject({ progress: 0.5, bytes: { received: 350, total: 700 } });
    expect(stepStatuses(state)).toEqual(["active", "waiting", "waiting", "waiting"]);
    expect(canCancel(state)).toBe(true);

    state = run([{ stage: "verifying", version: "2026.0.66" }], state);
    expect(stepStatuses(state)).toEqual(["done", "active", "waiting", "waiting"]);
    state = run([{ stage: "authorizing", version: "2026.0.66" }], state);
    expect(canCancel(state)).toBe(false);
    expect(stageHeadline(state)).toContain("password");
    state = run([{ stage: "installing", version: "2026.0.66" }, { stage: "installed", version: "2026.0.66" }], state);
    expect(stepStatuses(state)).toEqual(["done", "done", "done", "active"]);
    state = run([{ stage: "restarting", version: "2026.0.66" }], state);
    expect(stepStatuses(state)).toEqual(["done", "done", "done", "done"]);
    expect(installBusy(state)).toBe(true);
  });

  it("shows an unknown size as an indeterminate download", () => {
    expect(run([download(3, 1024, null)]).progress).toBeNull();
  });

  it("shows where a failure stopped and keeps its message", () => {
    const state = run([download(3, 700, 700), { stage: "verifying", version: "2026.0.66" },
      { stage: "failed", version: "2026.0.66", message: "The release's signature didn't verify with VOCO's release key. Nothing was installed." }]);
    expect(state.stage).toBe("failed");
    expect(state.message).toContain("signature");
    expect(stepStatuses(state)).toEqual(["done", "waiting", "waiting", "waiting"]);
    expect(installBusy(state)).toBe(false);
    expect(canCancel(state)).toBe(false);
  });

  it("says a cancelled download installed nothing", () => {
    const state = run([download(3, 10, 700), { stage: "cancelled", version: "2026.0.66" }]);
    expect(state.message).toBe("The download was cancelled. Nothing was installed.");
    expect(stepStatuses(state)).toEqual(["waiting", "waiting", "waiting", "waiting"]);
  });

  it("ignores events for another release", () => {
    const state = startingInstall("2026.0.66");
    expect(reduceInstall(state, { stage: "failed", version: "2026.0.67", message: "x" })).toBe(state);
    expect(installBusy(IDLE_INSTALL)).toBe(false);
  });

  it("formats sizes as people read them", () => {
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5.5 * 1024 * 1024)).toBe("5.5 MB");
    expect(formatBytes(700 * 1024 * 1024)).toBe("700 MB");
  });
});
