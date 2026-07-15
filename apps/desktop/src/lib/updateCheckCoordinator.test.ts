import { describe, expect, it, vi } from "vitest";
import { UpdateCheckCoordinator } from "@/lib/updateCheckCoordinator";
import type { UpdateChannel, UpdateCheckState } from "@/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function updateState(
  version: string,
  status: "available" | "up-to-date" = "available",
): UpdateCheckState {
  return {
    status,
    currentVersion: "2026.0.21",
    latestRelease: {
      version,
      name: `VOCO ${version}`,
      url: `https://example.test/releases/${version}`,
      publishedAt: "2026-07-15T08:00:00Z",
      prerelease: version.includes("beta"),
    },
    lastCheckedAt: "2026-07-15T08:00:00Z",
    error: null,
  };
}

describe("UpdateCheckCoordinator", () => {
  it("ignores an older channel result that completes after the latest request", async () => {
    let currentChannel: UpdateChannel = "stable";
    let currentState: UpdateCheckState = {
      status: "idle",
      currentVersion: "2026.0.21",
      latestRelease: null,
      lastCheckedAt: null,
      error: null,
    };
    const stableResult = deferred<UpdateCheckState>();
    const betaResult = deferred<UpdateCheckState>();
    const states: UpdateCheckState[] = [];
    const writes: Array<{ channel: UpdateChannel; state: UpdateCheckState }> = [];
    const notifications: string[] = [];
    const checkForUpdates = vi
      .fn()
      .mockImplementation(({ channel }: { channel: UpdateChannel }) =>
        channel === "stable" ? stableResult.promise : betaResult.promise,
      );
    const coordinator = new UpdateCheckCoordinator({
      getCurrentChannel: () => currentChannel,
      getUpdateState: () => currentState,
      setUpdateState: (state) => {
        currentState = state;
        states.push(state);
      },
      readCachedState: vi.fn().mockResolvedValue(null),
      checkForUpdates,
      writeCachedState: async (channel, state) => {
        writes.push({ channel, state });
      },
      showNotification: async (_summary, body) => {
        notifications.push(body);
      },
    });

    const stableCheck = coordinator.run("stable", undefined, true);
    await vi.waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(1));

    currentChannel = "beta";
    const betaCheck = coordinator.run("beta", undefined, true);
    await vi.waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(2));

    const betaState = updateState("2026.0.22-beta.1");
    betaResult.resolve(betaState);
    await betaCheck;

    const stateCountAfterBeta = states.length;
    stableResult.resolve(updateState("2026.0.22"));
    await stableCheck;

    expect(currentState).toEqual(betaState);
    expect(states).toHaveLength(stateCountAfterBeta);
    expect(writes).toEqual([{ channel: "beta", state: betaState }]);
    expect(notifications).toEqual([
      "VOCO 2026.0.22-beta.1 is available on the beta channel.",
    ]);
    expect(coordinator.lastCheckedChannel).toBe("beta");
    expect(coordinator.lastNotifiedReleaseVersion).toBe("2026.0.22-beta.1");
  });

  it("ignores an older same-channel request that resolves out of order", async () => {
    const firstResult = deferred<UpdateCheckState>();
    const secondResult = deferred<UpdateCheckState>();
    let currentState: UpdateCheckState = {
      status: "idle",
      currentVersion: "2026.0.21",
      latestRelease: null,
      lastCheckedAt: null,
      error: null,
    };
    const writes: UpdateCheckState[] = [];
    const notifications: string[] = [];
    const checkForUpdates = vi
      .fn()
      .mockImplementationOnce(() => firstResult.promise)
      .mockImplementationOnce(() => secondResult.promise);
    const coordinator = new UpdateCheckCoordinator({
      getCurrentChannel: () => "stable",
      getUpdateState: () => currentState,
      setUpdateState: (state) => {
        currentState = state;
      },
      readCachedState: vi.fn().mockResolvedValue(null),
      checkForUpdates,
      writeCachedState: async (_channel, state) => {
        writes.push(state);
      },
      showNotification: async (_summary, body) => {
        notifications.push(body);
      },
    });

    const firstCheck = coordinator.run("stable", undefined, true);
    await vi.waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(1));
    const secondCheck = coordinator.run("stable", undefined, true);
    await vi.waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(2));

    const secondState = updateState("2026.0.21", "up-to-date");
    secondResult.resolve(secondState);
    await secondCheck;
    firstResult.resolve(updateState("2026.0.23"));
    await firstCheck;

    expect(currentState).toEqual(secondState);
    expect(writes).toEqual([secondState]);
    expect(notifications).toEqual([]);
    expect(coordinator.lastCheckedChannel).toBe("stable");
    expect(coordinator.lastNotifiedReleaseVersion).toBeNull();
  });

  it("drops a completion when the selected channel changes before a new check starts", async () => {
    let currentChannel: UpdateChannel = "stable";
    let currentState: UpdateCheckState = {
      status: "idle",
      currentVersion: "2026.0.21",
      latestRelease: null,
      lastCheckedAt: null,
      error: null,
    };
    const result = deferred<UpdateCheckState>();
    const writeCachedState = vi.fn().mockResolvedValue(undefined);
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const checkForUpdates = vi.fn().mockReturnValue(result.promise);
    const coordinator = new UpdateCheckCoordinator({
      getCurrentChannel: () => currentChannel,
      getUpdateState: () => currentState,
      setUpdateState: (state) => {
        currentState = state;
      },
      readCachedState: vi.fn().mockResolvedValue(null),
      checkForUpdates,
      writeCachedState,
      showNotification,
    });

    const check = coordinator.run("stable", undefined, true);
    await vi.waitFor(() => expect(checkForUpdates).toHaveBeenCalledOnce());
    currentChannel = "beta";
    result.resolve(updateState("2026.0.22"));
    await check;

    expect(currentState.status).toBe("checking");
    expect(writeCachedState).not.toHaveBeenCalled();
    expect(showNotification).not.toHaveBeenCalled();
    expect(coordinator.lastCheckedChannel).toBeNull();
    expect(coordinator.lastNotifiedReleaseVersion).toBeNull();
  });
});
