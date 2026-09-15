export interface DesktopShortcutSessionApi {
  begin(sessionId: string, shortcutEpoch: number): Promise<void>;
  end(sessionId: string): Promise<void>;
}

/** Owns one bounded native shortcut lease, including an uncertain begin reply.
 * Disposal waits for that begin and ends only this UUID, never a replacement.
 * The immutable preflight epoch rejects begins queued by a discarded renderer.
 * The native backend supplies the expiry; the renderer does not renew leases.
 */
export class DesktopShortcutSession {
  readonly id = crypto.randomUUID();
  private beginPromise: Promise<void> | null = null;
  private releasePromise: Promise<boolean> | null = null;
  private disposed = false;

  constructor(
    private readonly api: DesktopShortcutSessionApi,
    private readonly shortcutEpoch: number,
    private readonly onRelease: (confirmed: boolean) => void,
  ) {}

  async acquire(): Promise<void> {
    if (this.disposed) throw new Error("Recording shortcut session is no longer active.");
    this.beginPromise ??= Promise.resolve().then(() => this.api.begin(this.id, this.shortcutEpoch));
    try {
      await this.beginPromise;
    } catch (error) {
      // A failed IPC reply is not proof the native mutation never happened.
      await this.dispose();
      throw error;
    }
    if (this.disposed) {
      await this.dispose();
      throw new Error("Recording shortcut session is no longer active.");
    }
  }

  dispose(): Promise<boolean> {
    this.disposed = true;
    this.releasePromise ??= this.release();
    return this.releasePromise;
  }

  private async release(): Promise<boolean> {
    if (!this.beginPromise) return true;
    await this.beginPromise.catch(() => {});
    let confirmed = false;
    try {
      await this.api.end(this.id);
      confirmed = true;
    } catch { /* Report a finite failure without leaking the native error. */ }
    // Cleanup is also called from React disposal; it must never reject unhandled.
    try { this.onRelease(confirmed); } catch { /* A reporter must not break disposal. */ }
    return confirmed;
  }
}
