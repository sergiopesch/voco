import { invoke } from "@tauri-apps/api/core";

export interface CrashRecoveryEntry { id: string; text: string; createdAt: number }
export function listCrashRecovery(): Promise<CrashRecoveryEntry[]> { return invoke("list_crash_recovery"); }
export function dismissCrashRecovery(id: string): Promise<void> { return invoke("dismiss_crash_recovery", { id }); }
export class CrashJournalCleanupError extends Error {
  constructor() { super("Temporary dictation text could not be deleted. VOCO will retry cleanup before the next recording."); }
}

/** One bounded, serialized checkpoint stream. A slow disk coalesces superseded
 * text; finish waits for the latest write before deleting the active journal. */
export class CrashJournal {
  private sequence = 0;
  private next: string | null = null;
  private pending: Promise<void> | null = null;
  private opening: Promise<void> | null = null;
  private error: unknown = null;
  private closed = false;
  private epoch: number | null = null;
  cleanupComplete = false;
  constructor(private readonly id: string) {}
  async begin() {
    this.opening = (async () => {
      this.epoch = await invoke<number>("get_crash_journal_epoch");
      await invoke("begin_crash_journal", { id: this.id, epoch: this.epoch });
    })();
    await this.opening;
  }
  update(text: string) {
    if (this.closed || this.error) return;
    this.next = text;
    if (!this.pending) this.pump();
  }
  private pump() {
    this.pending = this.drain().catch(error => { this.error = error; }).finally(() => {
      this.pending = null;
      // A hypothesis can arrive after drain resolves but before this microtask.
      if (this.next !== null && !this.error) this.pump();
    });
  }
  private async drain() {
    while (this.next !== null) {
      const text = this.next;
      this.next = null;
      await invoke("update_crash_journal", { id: this.id, epoch: this.epoch, sequence: ++this.sequence, text });
    }
  }
  private async settle() {
    this.closed = true;
    await this.opening?.catch(() => {});
    while (this.pending) await this.pending;
  }
  async finish() {
    await this.settle();
    if (this.epoch !== null) {
      try { await invoke("finish_crash_journal", { id: this.id, epoch: this.epoch }); }
      catch { throw new CrashJournalCleanupError(); }
    }
    this.cleanupComplete = true;
    if (this.error) throw new Error("Crash recovery checkpoint failed during dictation.");
  }
  /** Ends the session by moving its complete text into Review; resolves false,
   * keeping nothing, when that text was not fully saved. */
  async keep() {
    await this.settle();
    if (this.epoch === null || this.error) return false;
    try { await invoke("keep_crash_journal", { id: this.id, epoch: this.epoch }); }
    catch { return false; }
    this.cleanupComplete = true;
    return true;
  }
}
