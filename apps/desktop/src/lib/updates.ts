import { loadCachedUpdateState, saveCachedUpdateState } from "@/lib/tauri";
import type { CachedUpdateCheck, ReleaseInfo, UpdateChannel, UpdateCheckState } from "@/types";

interface GitHubReleaseResponse {
  draft: boolean;
  prerelease: boolean;
  name: string | null;
  published_at: string | null;
  tag_name: string;
}

interface CheckForUpdatesOptions {
  currentVersion: string;
  channel: UpdateChannel;
}

const RELEASES_API_URL =
  "https://api.github.com/repos/sergiopesch/voco/releases?per_page=12";
const UPDATE_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const UPDATE_REQUEST_TIMEOUT_MS = 15_000;

function isReusableCachedUpdateState(state: UpdateCheckState): boolean {
  return state.status === "available" || state.status === "up-to-date";
}

function normalizeVersion(rawVersion: string): string {
  return rawVersion.trim().replace(/^voco\./i, "").replace(/^v/i, "");
}

function parseVersion(version: string) {
  const normalized = normalizeVersion(version);
  const [corePart, prereleasePart] = normalized.split("-", 2);
  const core = corePart ?? "0.0.0";
  const [major = "0", minor = "0", patch = "0"] = core.split(".");

  return {
    major: Number.parseInt(major, 10) || 0,
    minor: Number.parseInt(minor, 10) || 0,
    patch: Number.parseInt(patch, 10) || 0,
    prerelease: prereleasePart
      ? prereleasePart.split(".").map((part) => {
          const numeric = Number.parseInt(part, 10);
          return Number.isNaN(numeric) ? part : numeric;
        })
      : [],
  };
}

export function compareVersions(leftVersion: string, rightVersion: string): number {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);

  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) {
    return 0;
  }
  if (left.prerelease.length === 0) {
    return 1;
  }
  if (right.prerelease.length === 0) {
    return -1;
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];

    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart === rightPart) {
      continue;
    }

    const leftIsNumeric = typeof leftPart === "number";
    const rightIsNumeric = typeof rightPart === "number";
    if (leftIsNumeric && rightIsNumeric) {
      return leftPart - rightPart;
    }
    if (leftIsNumeric) {
      return -1;
    }
    if (rightIsNumeric) {
      return 1;
    }
    return String(leftPart).localeCompare(String(rightPart));
  }

  return 0;
}

// A VOCO release tag: `voco.` and a version, perhaps with a prerelease part.
// Rust's `is_release_page` accepts the same tags.
const RELEASE_TAG = /^voco\.\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;
const RELEASE_PAGE = "https://github.com/sergiopesch/voco/releases/tag/";

/** GitHub's answer is data from the network: only a release whose tag is one
 * of VOCO's counts, and nothing else of it is trusted as an address. */
function isVocoRelease(release: unknown): release is GitHubReleaseResponse {
  const candidate = release as Partial<GitHubReleaseResponse> | null;
  return typeof candidate === "object" && candidate !== null &&
    typeof candidate.tag_name === "string" && candidate.tag_name.length <= 64 &&
    RELEASE_TAG.test(candidate.tag_name) &&
    typeof candidate.draft === "boolean" && typeof candidate.prerelease === "boolean";
}

function mapRelease(release: GitHubReleaseResponse): ReleaseInfo {
  const version = normalizeVersion(release.tag_name);
  const name = typeof release.name === "string" ? release.name.trim().slice(0, 80) : "";
  return {
    version,
    name: name || `VOCO ${version}`,
    // Built from the tag, never taken from the answer: the page opens in the
    // person's browser under VOCO's name.
    url: RELEASE_PAGE + release.tag_name,
    publishedAt: typeof release.published_at === "string" ? release.published_at : null,
    prerelease: release.prerelease,
  };
}

export function selectReleaseForChannel(
  releases: unknown,
  channel: UpdateChannel,
): ReleaseInfo | null {
  if (!Array.isArray(releases)) return null;
  const candidates = releases
    .filter(isVocoRelease)
    .filter((release) => !release.draft)
    .filter((release) => (channel === "stable" ? !release.prerelease : true))
    .map(mapRelease)
    .sort((left, right) => compareVersions(right.version, left.version));

  return candidates[0] ?? null;
}

export async function checkForUpdates({
  currentVersion,
  channel,
}: CheckForUpdatesOptions): Promise<UpdateCheckState> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPDATE_REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("GitHub release lookup timed out.", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`GitHub release lookup failed with status ${response.status}.`);
  }

  const releases: unknown = await response.json();
  const latestRelease = selectReleaseForChannel(releases, channel);
  const checkedAt = new Date().toISOString();

  if (!latestRelease) {
    return {
      status: "error",
      currentVersion: normalizeVersion(currentVersion),
      latestRelease: null,
      lastCheckedAt: checkedAt,
      error: "No matching releases were found for the selected update channel.",
    };
  }

  const isUpdateAvailable =
    compareVersions(latestRelease.version, normalizeVersion(currentVersion)) > 0;

  return {
    status: isUpdateAvailable ? "available" : "up-to-date",
    currentVersion: normalizeVersion(currentVersion),
    latestRelease,
    lastCheckedAt: checkedAt,
    error: null,
  };
}

export async function readCachedUpdateState(
  channel: UpdateChannel,
  currentVersion: string,
): Promise<UpdateCheckState | null> {
  const cache = await loadCachedUpdateState();
  if (!cache) {
    return null;
  }

  try {
    if (cache.channel !== channel) {
      return null;
    }
    if (!isReusableCachedUpdateState(cache.state)) {
      return null;
    }
    if (cache.state.currentVersion !== normalizeVersion(currentVersion)) {
      return null;
    }
    if (!cache.state.lastCheckedAt) {
      return null;
    }

    const ageMs = Date.now() - new Date(cache.state.lastCheckedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > UPDATE_CACHE_MAX_AGE_MS) {
      return null;
    }

    return cache.state;
  } catch {
    return null;
  }
}

export async function writeCachedUpdateState(
  channel: UpdateChannel,
  state: UpdateCheckState,
): Promise<void> {
  const cache: CachedUpdateCheck = {
    channel,
    state,
  };
  await saveCachedUpdateState(cache);
}
