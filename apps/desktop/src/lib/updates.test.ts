import { beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(compareVersions("voco.2026.0.3", "2026.0.2")).toBeGreaterThan(0);
    expect(compareVersions("voco.2026.0.3", "2026.0.3")).toBe(0);
  });
});

describe("selectReleaseForChannel", () => {
  const releases = [
    {
      draft: false,
      prerelease: true,
      html_url: "https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.4-beta.1",
      name: "VOCO 2026.0.4 beta 1",
      published_at: "2026-04-02T09:00:00Z",
      tag_name: "voco.2026.0.4-beta.1",
    },
    {
      draft: false,
      prerelease: false,
      html_url: "https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.3",
      name: "VOCO 2026.0.3",
      published_at: "2026-03-28T09:00:00Z",
      tag_name: "voco.2026.0.3",
    },
  ];

  it("prefers the newest stable release on the stable channel", () => {
    expect(selectReleaseForChannel(releases, "stable")?.version).toBe("2026.0.3");
  });

  it("allows prerelease builds on the beta channel", () => {
    expect(selectReleaseForChannel(releases, "beta")?.version).toBe("2026.0.4-beta.1");
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
          html_url: "https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.3",
          name: "VOCO 2026.0.3",
          published_at: "2026-03-28T09:00:00Z",
          tag_name: "voco.2026.0.3",
        },
      ],
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      checkForUpdates({ currentVersion: "2026.0.2", channel: "stable" }),
    ).resolves.toMatchObject({
      status: "available",
      currentVersion: "2026.0.2",
      latestRelease: {
        version: "2026.0.3",
      },
    });
  });
});

describe("update cache helpers", () => {
  it("returns a recent cached state for the matching channel and version", async () => {
    const cacheState = {
      status: "up-to-date" as const,
      currentVersion: "2026.0.3",
      latestRelease: {
        version: "2026.0.3",
        name: "VOCO 2026.0.3",
        url: "https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.3",
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

    await expect(readCachedUpdateState("stable", "2026.0.3")).resolves.toMatchObject({
      status: "up-to-date",
    });
  });
});
