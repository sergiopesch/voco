import { expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

it("importing the queue leaves startup model preparation to the backend", async () => {
  await import("./dictationStream");
  expect(invoke).not.toHaveBeenCalled();
});
