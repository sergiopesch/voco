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
      "VOCO 2026.0.22-beta.1 is available on the beta channel. Open VOCO's Settings, then Updates, to install it.",
    ]);
    expect(coordinator.lastCheckedChannel).toBe("beta");
    // A later check that finds the same release does not notify again.
    await coordinator.run("beta", undefined, true);
    expect(notifications).toHaveLength(1);
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

    // Nothing else would replace "checking", so the state from before it is back.
    expect(currentState).toEqual({
      status: "idle",
      currentVersion: "2026.0.21",
      latestRelease: null,
      lastCheckedAt: null,
      error: null,
    });
    expect(writeCachedState).not.toHaveBeenCalled();
    expect(showNotification).not.toHaveBeenCalled();
    expect(coordinator.lastCheckedChannel).toBeNull();
  });

  it("never leaves checking on screen once every run has ended, whatever order they end in", async () => {
    const before = updateState("2026.0.21");
    // Each case: the channel selected after each of two runs starts, which
    // run's check answers first, and whether the first fails.
    for (const selected of [["stable", "beta"], ["beta", "beta"], ["beta", "stable"], ["stable", "stable"]] as const) {
      for (const firstAnswersFirst of [true, false]) {
        for (const firstFails of [true, false]) {
          let currentChannel: UpdateChannel = "stable";
          let currentState: UpdateCheckState = before;
          const answers = [deferred<UpdateCheckState>(), deferred<UpdateCheckState>()];
          const checkForUpdates = vi.fn()
            .mockReturnValueOnce(answers[0]!.promise).mockReturnValueOnce(answers[1]!.promise);
          const coordinator = new UpdateCheckCoordinator({
            getCurrentChannel: () => currentChannel,
            getUpdateState: () => currentState,
            setUpdateState: (state) => { currentState = state; },
            readCachedState: vi.fn().mockResolvedValue(null),
            checkForUpdates,
            writeCachedState: vi.fn().mockResolvedValue(undefined),
            showNotification: vi.fn().mockResolvedValue(undefined),
          });
          const first = coordinator.run("stable", undefined, true);
          await vi.waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(1));
          currentChannel = selected[0];
          const second = coordinator.run("beta", undefined, true);
          await Promise.resolve();
          currentChannel = selected[1];
          const settleFirst = () => firstFails ? answers[0]!.reject(new Error("offline")) : answers[0]!.resolve(updateState("2026.0.22"));
          if (firstAnswersFirst) settleFirst();
          // The second run checks only while its channel is still selected.
          if (checkForUpdates.mock.calls.length < 2) await Promise.resolve();
          answers[1]!.resolve(updateState("2026.0.23"));
          if (!firstAnswersFirst) settleFirst();
          await Promise.all([first, second]);
          const label = `${selected.join(",")} ${firstAnswersFirst} ${firstFails}`;
          expect(currentState.status, label).not.toBe("checking");
          // The second run shows its result when its channel was selected
          // throughout; a run for a channel that wasn't shows nothing of its
          // own, and what was there before the checks is back.
          if (selected[0] === "beta" && selected[1] === "beta") expect(currentState.latestRelease?.version, label).toBe("2026.0.23");
          else expect(currentState, label).toEqual(before);
        }
      }
    }
  });
});
