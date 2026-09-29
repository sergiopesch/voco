import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { CrashJournal, dismissCrashRecovery, listCrashRecovery } from "./crashRecovery";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => { vi.mocked(invoke).mockReset().mockImplementation(async command => command === "get_crash_journal_epoch" ? 1 : undefined); });
it("serializes checkpoints, coalesces slow writes and deletes only after the final write", async () => {
  let release!: () => void;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "get_crash_journal_epoch") return 1;
    if (command === "update_crash_journal") await new Promise<void>(resolve => { release = resolve; });
  });
  const journal = new CrashJournal("session"); await journal.begin();
  journal.update("one"); journal.update("two"); journal.update("three");
  const finished = journal.finish();
  expect(invoke).not.toHaveBeenCalledWith("finish_crash_journal", expect.anything());
  release();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("update_crash_journal", { id: "session", epoch: 1, sequence: 2, text: "three" }));
  release(); await finished;
  journal.update("late");
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["get_crash_journal_epoch", "begin_crash_journal", "update_crash_journal", "update_crash_journal", "finish_crash_journal"]);
});
it("still clears the journal after a checkpoint fails, without an unhandled rejection", async () => {
  vi.mocked(invoke).mockImplementation(async command => { if (command === "get_crash_journal_epoch") return 1; if (command === "update_crash_journal") throw new Error("disk full"); });
  const journal = new CrashJournal("session"); await journal.begin(); journal.update("fixture");
  await expect(journal.finish()).rejects.toThrow("checkpoint failed");
  expect(invoke).toHaveBeenCalledWith("finish_crash_journal", { id: "session", epoch: 1 });
  expect(journal.cleanupComplete).toBe(true);
});
it("a failed deletion remains retryable and is not mistaken for completed cleanup", async () => {
  let fail = true;
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === "get_crash_journal_epoch") return 1;
    if (command === "finish_crash_journal" && fail) throw new Error("read-only filesystem");
  });
  const journal = new CrashJournal("session"); await journal.begin(); journal.update("fixture");
  await expect(journal.finish()).rejects.toThrow("could not be deleted");
  expect(journal.cleanupComplete).toBe(false);
  fail = false;
  await journal.finish();
  expect(journal.cleanupComplete).toBe(true);
});
it("finish waits for begin before removing an in-flight startup journal", async () => {
  let resolve!: () => void;
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === "get_crash_journal_epoch") return 1;
    if (command === "begin_crash_journal") await new Promise<void>(done => { resolve = done; });
  });
  const journal = new CrashJournal("session"); const opening = journal.begin();
  await vi.waitFor(()=>expect(resolve).toBeTypeOf("function"));
  const closed = journal.finish();
  expect(invoke).not.toHaveBeenCalledWith("finish_crash_journal", expect.anything());
  resolve(); await opening; await closed;
  expect(journal.cleanupComplete).toBe(true);
});
it("review reads only the backend's previous-run entries and dismissal is identity-bound", async () => {
  await listCrashRecovery(); await dismissCrashRecovery("old-session");
  expect(invoke).toHaveBeenCalledWith("list_crash_recovery");
  expect(invoke).toHaveBeenCalledWith("dismiss_crash_recovery", { id: "old-session" });
});
it("keep moves only a fully saved session into Review", async () => {
  const kept = new CrashJournal("session"); await kept.begin(); kept.update("fixture");
  await expect(kept.keep()).resolves.toBe(true);
  expect(invoke).toHaveBeenLastCalledWith("keep_crash_journal", { id: "session", epoch: 1 });
  expect(invoke).not.toHaveBeenCalledWith("finish_crash_journal", expect.anything());
  vi.mocked(invoke).mockImplementation(async command => { if (command === "get_crash_journal_epoch") return 1; if (command === "update_crash_journal") throw new Error("disk full"); });
  const partial = new CrashJournal("partial"); await partial.begin(); partial.update("fixture");
  await expect(partial.keep()).resolves.toBe(false);
  expect(invoke).not.toHaveBeenCalledWith("keep_crash_journal", { id: "partial", epoch: 1 });
});
