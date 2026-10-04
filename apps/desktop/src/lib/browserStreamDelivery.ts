import { appendBrowserField, cancelBrowserField, startBrowserField } from "./tauri";
import type { BrowserFieldStatus } from "@/types";

const native = { startBrowserField, appendBrowserField, cancelBrowserField };

/** A browser field lease is independent of recognition. Never retry a mutation
 * whose exact receipt is missing, even when the recognizer kept producing text. */
export class BrowserStreamDelivery {
  private lease: number | null = null;
  private committed = "";
  private closed = false;

  constructor(private readonly isCurrent: () => boolean, private readonly api = native) {}

  async start(sessionId: number, triggerId: string) {
    this.assertActive();
    const status = await this.api.startBrowserField(sessionId, triggerId);
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
      const status = await this.api.appendBrowserField(lease, this.committed, text);
      this.verify(status, lease, next);
      this.committed = next;
    } catch (error) {
      await this.cancel();
      throw error;
    }
  }

  async cancel() {
    this.closed = true;
    const lease = this.lease;
    this.lease = null;
    if (lease !== null) await this.api.cancelBrowserField(lease).catch(() => {});
  }

  private assertActive() {
    if (this.closed || !this.isCurrent()) throw new Error("Browser dictation session is no longer active.");
  }

  private requireLease() {
    if (this.lease === null) throw new Error("Browser field lease is unavailable.");
    return this.lease;
  }

  private verify(status: BrowserFieldStatus, lease: number, text: string) {
    this.assertActive();
    if (status.sessionId !== lease || !status.engineActive || status.focusLost || !status.ownershipIntact ||
        status.committedCharacterCount !== Array.from(text).length) {
      throw new Error("The browser field didn't confirm the exact text. Check the field.");
    }
  }
}
