import type { UpdateChannel, UpdateCheckState } from "@/types";

interface UpdateCheckCoordinatorDependencies {
  getCurrentChannel: () => UpdateChannel | null;
  getUpdateState: () => UpdateCheckState;
  setUpdateState: (state: UpdateCheckState) => void;
  readCachedState: (
    channel: UpdateChannel,
    currentVersion: string,
  ) => Promise<UpdateCheckState | null>;
  checkForUpdates: (options: {
    currentVersion: string;
    channel: UpdateChannel;
  }) => Promise<UpdateCheckState>;
  writeCachedState: (
    channel: UpdateChannel,
    state: UpdateCheckState,
  ) => Promise<void>;
  showNotification: (summary: string, body: string) => Promise<void>;
}

interface UpdateCheckRequest {
  generation: number;
  channel: UpdateChannel;
}

export class UpdateCheckCoordinator {
  private generation = 0;
  private cacheWriteQueue: Promise<void> = Promise.resolve();
  private checkedChannel: UpdateChannel | null = null;
  private notifiedReleaseVersion: string | null = null;

  constructor(private readonly dependencies: UpdateCheckCoordinatorDependencies) {}

  get lastCheckedChannel(): UpdateChannel | null {
    return this.checkedChannel;
  }

  get lastNotifiedReleaseVersion(): string | null {
    return this.notifiedReleaseVersion;
  }

  async run(
    channel: UpdateChannel,
    currentVersionOverride?: string,
    force = false,
  ): Promise<void> {
    const request: UpdateCheckRequest = {
      generation: ++this.generation,
      channel,
    };
    const currentVersion =
      currentVersionOverride ?? this.dependencies.getUpdateState().currentVersion;

    if (!currentVersion) {
      return;
    }

    let cachedState: UpdateCheckState | null = null;

    try {
      cachedState = await this.dependencies.readCachedState(channel, currentVersion);
      if (!this.isCurrent(request)) {
        return;
      }

      if (!force && cachedState) {
        this.checkedChannel = channel;
        this.dependencies.setUpdateState(cachedState);
        return;
      }

      const previousState = this.dependencies.getUpdateState();
      this.dependencies.setUpdateState({
        status: "checking",
        currentVersion,
        latestRelease: previousState.latestRelease,
        lastCheckedAt: previousState.lastCheckedAt,
        error: null,
      });

      const nextUpdateState = await this.dependencies.checkForUpdates({
        currentVersion,
        channel,
      });
      if (!this.isCurrent(request)) {
        return;
      }

      const cacheWritten = await this.writeCacheIfCurrent(
        request,
        nextUpdateState,
      );
      if (!cacheWritten || !this.isCurrent(request)) {
        return;
      }

      this.checkedChannel = channel;
      this.dependencies.setUpdateState(nextUpdateState);

      if (
        nextUpdateState.status === "available" &&
        nextUpdateState.latestRelease &&
        this.notifiedReleaseVersion !== nextUpdateState.latestRelease.version &&
        cachedState?.latestRelease?.version !== nextUpdateState.latestRelease.version
      ) {
        this.notifiedReleaseVersion = nextUpdateState.latestRelease.version;
        await this.dependencies
          .showNotification(
            "Update available",
            `VOCO ${nextUpdateState.latestRelease.version} is available on the ${channel} channel.`,
          )
          .catch(() => {});
      }
    } catch (error) {
      if (!this.isCurrent(request)) {
        return;
      }

      const errorState: UpdateCheckState = {
        status: "error",
        currentVersion,
        latestRelease: null,
        lastCheckedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : "VOCO could not check GitHub Releases right now.",
      };
      this.checkedChannel = channel;
      this.dependencies.setUpdateState(errorState);
    }
  }

  private isCurrent(request: UpdateCheckRequest): boolean {
    return (
      request.generation === this.generation &&
      this.dependencies.getCurrentChannel() === request.channel
    );
  }

  private writeCacheIfCurrent(
    request: UpdateCheckRequest,
    state: UpdateCheckState,
  ): Promise<boolean> {
    const write = this.cacheWriteQueue.then(async () => {
      if (!this.isCurrent(request)) {
        return false;
      }
      await this.dependencies.writeCachedState(request.channel, state);
      return true;
    });
    this.cacheWriteQueue = write.then(
      () => {},
      () => {},
    );
    return write;
  }
}
