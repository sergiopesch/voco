import {
  cancelOwnedPreedit,
  checkpointOwnedPreedit,
  finishCanonicalOwnedPreedit,
  startOwnedPreedit,
} from "./tauri";
import type { OwnedPreeditStatus } from "@/types";

const native = { startOwnedPreedit, checkpointOwnedPreedit, finishCanonicalOwnedPreedit, cancelOwnedPreedit };

/** A browser field lease is independent of recognition. Never retry a mutation
 * whose exact receipt is missing, even when the recognizer kept producing text. */
export class BrowserStreamDelivery {
  private lease: number | null = null;
  private committed = "";
  private closed = false;

  constructor(private readonly isCurrent: () => boolean, private readonly api = native) {}

  async start(sessionId: number, triggerId: string) {
    this.assertActive();
    const status = await this.api.startOwnedPreedit(sessionId, triggerId);
    const lease = status.sessionId;
    if (lease === null || lease <= 0) throw new Error("Browser did not issue a field lease.");
    this.lease = lease;
    try {
      this.assertActive();
      if (!status.engineActive || status.focusLost || !status.ownershipIntact) {
        throw new Error("Browser field could not be verified.");
      }
    } catch (error) {
      await this.cancel();
      throw error;
    }
  }

  async append(text: string) {
    this.assertActive();
    const lease = this.requireLease();
    const next = this.committed + text;
    try {
      const status = await this.api.checkpointOwnedPreedit(lease, this.committed, text);
      this.verify(status, lease, next, false);
      this.committed = next;
    } catch (error) {
      await this.cancel();
      throw error;
    }
  }

  async finish() {
    this.assertActive();
    const lease = this.requireLease();
    try {
      const status = await this.api.finishCanonicalOwnedPreedit(lease, this.committed, "");
      this.verify(status, lease, this.committed, true);
      this.closed = true;
      this.lease = null;
    } catch (error) {
      await this.cancel();
      throw error;
    }
  }

  async cancel() {
    this.closed = true;
    const lease = this.lease;
    this.lease = null;
    if (lease !== null) await this.api.cancelOwnedPreedit(lease).catch(() => {});
  }

  private assertActive() {
    if (this.closed || !this.isCurrent()) throw new Error("Browser dictation session is no longer active.");
  }

  private requireLease() {
    if (this.lease === null) throw new Error("Browser field lease is unavailable.");
    return this.lease;
  }

  private verify(status: OwnedPreeditStatus, lease: number, text: string, final: boolean) {
    this.assertActive();
    if (status.sessionId !== lease || !status.engineActive || status.focusLost || !status.ownershipIntact ||
        status.committedCharacterCount !== Array.from(text).length ||
        (final && status.finalizationOutcome !== "committed")) {
      throw new Error("Browser did not acknowledge the exact text. Review the field before recovering the transcript.");
    }
  }
}
