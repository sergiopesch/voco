import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpdates,
  compareVersions,
  readCachedUpdateState,
  selectReleaseForChannel,
  writeCachedUpdateState,
} from "@/lib/updates";
import * as tauriLib from "@/lib/tauri";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("compareVersions", () => {
  it("treats stable releases as newer than matching prereleases", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta.2")).toBeGreaterThan(0);
  });

  it("compares normal semantic versions correctly", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("normalizes voco-prefixed release tags before comparing", () => {
    expect(compareVersions("voco.2026.0.6", "2026.0.5")).toBeGreaterThan(0);
    expect(compareVersions("voco.2026.0.6", "2026.0.6")).toBe(0);
  });
});

describe("selectReleaseForChannel", () => {
  const releases = [
    {
      draft: false,
      prerelease: true,
      html_url: "https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.7-beta.1",
      name: "VOCO 2026.0.7 beta 1",
      published_at: "2026-04-02T09:00:00Z",
      tag_name: "voco.2026.0.7-beta.1",
    },
    {
      draft: false,
      prerelease: false,
      html_url: "https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.6",
      name: "VOCO 2026.0.6",
      published_at: "2026-03-28T09:00:00Z",
      tag_name: "voco.2026.0.6",
    },
  ];

  it("prefers the newest stable release on the stable channel", () => {
    expect(selectReleaseForChannel(releases, "stable")?.version).toBe("2026.0.6");
  });

  it("allows prerelease builds on the beta channel", () => {
    expect(selectReleaseForChannel(releases, "beta")?.version).toBe("2026.0.7-beta.1");
  });

  it("builds the release page from the tag, whatever address the answer names", () => {
    const answer = [{ ...releases[1], html_url: "https://github.com/attacker/repo/releases/download/x/voco-install" }];
    expect(selectReleaseForChannel(answer, "stable")?.url)
      .toBe("https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.6");
  });

  it("counts only releases whose tag is one of VOCO's", () => {
    const tagged = (tag_name: unknown) => [{ ...releases[1], tag_name }];
    for (const tag of [
      "voco.2026.0.9/../../../../attacker/repo/releases/download/x/voco-install",
      "voco.2026.0.9?tab=elsewhere", "voco.2026.0.9#elsewhere", "voco.2026.0.9 ", "voco.2026.0.9\n",
      "<b>voco.2026.0.9</b>", "v2026.0.9", "2026.0.9", "voco.2026.0", "voco.2026.0.9-", "voco.2026.0.9-beta..1",
      `voco.2026.0.9-${"a".repeat(64)}`, "", null, 7, undefined,
    ]) {
      expect(selectReleaseForChannel(tagged(tag), "beta"), String(tag)).toBeNull();
    }
    expect(selectReleaseForChannel(tagged("voco.2026.0.9"), "stable")?.version).toBe("2026.0.9");
  });

  it("takes an answer that is no list of releases for no release", () => {
    for (const answer of [null, undefined, "releases", { message: "API rate limit exceeded" }, [null, 7, "x", []]]) {
      expect(selectReleaseForChannel(answer, "stable")).toBeNull();
    }
    // A release without its flags is not known to be published.
    expect(selectReleaseForChannel([{ tag_name: "voco.2026.0.9" }], "stable")).toBeNull();
  });

  it("names a release itself when the answer's name is missing, not text or long", () => {
    const named = (name: unknown) => selectReleaseForChannel([{ ...releases[1], name }], "stable")?.name;
    expect(named(null)).toBe("VOCO 2026.0.6");
    expect(named({ toString: () => "x" })).toBe("VOCO 2026.0.6");
    expect(named("  ")).toBe("VOCO 2026.0.6");
    expect(named("n".repeat(500))).toHaveLength(80);
  });
});

describe("checkForUpdates", () => {
  it("returns available when a newer release exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          draft: false,
          prerelease: false,
          html_url: "https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.6",
          name: "VOCO 2026.0.6",
          published_at: "2026-03-28T09:00:00Z",
          tag_name: "voco.2026.0.6",
        },
      ],
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      checkForUpdates({ currentVersion: "2026.0.4", channel: "stable" }),
    ).resolves.toMatchObject({
      status: "available",
      currentVersion: "2026.0.4",
      latestRelease: {
        version: "2026.0.6",
      },
    });
  });

  it("times out stalled release checks", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_, reject) => {
        const signal = init?.signal;
        if (!(signal instanceof AbortSignal)) {
          reject(new Error("expected abort signal"));
          return;
        }

        signal.addEventListener("abort", () => {
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const promise = checkForUpdates({
      currentVersion: "2026.0.4",
      channel: "stable",
    });
    const assertion = expect(promise).rejects.toThrow("GitHub release lookup timed out.");

    await vi.advanceTimersByTimeAsync(15_000);

    await assertion;
  });
});

describe("update cache helpers", () => {
  it("returns a recent cached state for the matching channel and version", async () => {
    const cacheState = {
      status: "up-to-date" as const,
      currentVersion: "2026.0.6",
      latestRelease: {
        version: "2026.0.6",
        name: "VOCO 2026.0.6",
        url: "https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.6",
        publishedAt: "2026-04-02T09:00:00Z",
        prerelease: false,
      },
      lastCheckedAt: new Date().toISOString(),
      error: null,
    };

    vi.spyOn(tauriLib, "saveCachedUpdateState").mockResolvedValue();
    vi.spyOn(tauriLib, "loadCachedUpdateState").mockResolvedValue({
      channel: "stable",
      state: cacheState,
    });

    await writeCachedUpdateState("stable", cacheState);

    await expect(readCachedUpdateState("stable", "2026.0.6")).resolves.toMatchObject({
      status: "up-to-date",
    });
  });

  it("ignores cached error states so the next automatic check can retry", async () => {
    vi.spyOn(tauriLib, "loadCachedUpdateState").mockResolvedValue({
      channel: "stable",
      state: {
        status: "error",
        currentVersion: "2026.0.6",
        latestRelease: null,
        lastCheckedAt: new Date().toISOString(),
        error: "temporary network issue",
      },
    });

    await expect(readCachedUpdateState("stable", "2026.0.6")).resolves.toBeNull();
  });

  it("ignores a cache timestamp from the future", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    vi.spyOn(tauriLib, "loadCachedUpdateState").mockResolvedValue({
      channel: "stable",
      state: {
        status: "up-to-date",
        currentVersion: "2026.0.21",
        latestRelease: null,
        lastCheckedAt: "2026-07-15T12:00:01Z",
        error: null,
      },
    });

    await expect(readCachedUpdateState("stable", "2026.0.21")).resolves.toBeNull();
  });
});
