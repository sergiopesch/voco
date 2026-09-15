import { expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { beginDesktopShortcutSession, endDesktopShortcutSession } from "./tauri";

it("passes the immutable renderer epoch and owned UUID unchanged to both native shortcut commands", async () => {
  const id = crypto.randomUUID();
  await beginDesktopShortcutSession(id, 7);
  await endDesktopShortcutSession(id);
  expect(invoke.mock.calls).toEqual([
    ["begin_desktop_shortcut_session", { sessionId: id, shortcutEpoch: 7 }],
    ["end_desktop_shortcut_session", { sessionId: id }],
  ]);
});
