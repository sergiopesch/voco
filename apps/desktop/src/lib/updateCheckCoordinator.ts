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

/** Where the newest check stands. `restore` is the state that "checking"
 * replaced on screen, an earlier run's included: a run that ends with no
 * result of its own puts it back, so "checking" is shown only while a check
 * runs. `specs/tla/UpdateCheck.tla` models these stages. */
type CheckRun =
  | { stage: "idle" }
  | { stage: "reading"; generation: number; restore: UpdateCheckState | null }
  | { stage: "checking"; generation: number; restore: UpdateCheckState };

export class UpdateCheckCoordinator {
  private generation = 0;
  private active: CheckRun = { stage: "idle" };
  private cacheWriteQueue: Promise<void> = Promise.resolve();
  private checkedChannel: UpdateChannel | null = null;
  private notifiedReleaseVersion: string | null = null;

  constructor(private readonly dependencies: UpdateCheckCoordinatorDependencies) {}

  get lastCheckedChannel(): UpdateChannel | null {
    return this.checkedChannel;
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
    // This run takes over from one still in flight, and with it what that
    // run's "checking" replaced on screen.
    this.active = { stage: "reading", generation: request.generation, restore: this.shownBefore() };

    try {
      const cachedState = await this.dependencies.readCachedState(channel, currentVersion);
      if (!this.isCurrent(request)) {
        this.abandon(request);
        return;
      }

      if (!force && cachedState) {
        this.checkedChannel = channel;
        this.settle(request, cachedState);
        return;
      }

      const previousState = this.shownBefore() ?? this.dependencies.getUpdateState();
      this.active = { stage: "checking", generation: request.generation, restore: previousState };
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
        this.abandon(request);
        return;
      }

      const cacheWritten = await this.writeCacheIfCurrent(
        request,
        nextUpdateState,
      );
      if (!cacheWritten || !this.isCurrent(request)) {
        this.abandon(request);
        return;
      }

      this.checkedChannel = channel;
      this.settle(request, nextUpdateState);

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
            `VOCO ${nextUpdateState.latestRelease.version} is available on the ${channel} channel. Open VOCO's Settings, then Updates, to install it.`,
          )
          .catch(() => {});
      }
    } catch (error) {
      if (!this.isCurrent(request)) {
        this.abandon(request);
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
      this.settle(request, errorState);
    }
  }

  /** What a run in flight replaced on screen with "checking", if it has. */
  private shownBefore(): UpdateCheckState | null {
    return this.active.stage === "idle" ? null : this.active.restore;
  }

  /** A run that is still the newest shows its result. */
  private settle(request: UpdateCheckRequest, state: UpdateCheckState) {
    if (this.active.stage !== "idle" && this.active.generation === request.generation) {
      this.active = { stage: "idle" };
    }
    this.dependencies.setUpdateState(state);
  }

  /** A run whose channel is no longer the selected one has no result to
   * show. While it is still the newest run, nothing else will replace the
   * "checking" on screen, so the state from before it comes back. A newer run
   * has taken that over. */
  private abandon(request: UpdateCheckRequest) {
    if (this.active.stage === "idle" || this.active.generation !== request.generation) {
      return;
    }
    const { restore } = this.active;
    this.active = { stage: "idle" };
    if (restore) {
      this.dependencies.setUpdateState(restore);
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
