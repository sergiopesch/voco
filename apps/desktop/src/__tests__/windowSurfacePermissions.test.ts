import { expect, it } from "vitest";
import capabilities from "../../src-tauri/capabilities/default.json";

it("allows the intended main-window centering and explicit popover geometry operations", () => {
  // core:default includes geometry queries, not window mutation commands.
  // Without allow-center, settings/onboarding keep the old overlay position.
  expect(capabilities.windows).toEqual(["main"]);
  expect(capabilities.permissions).toEqual(expect.arrayContaining([
    "core:window:allow-center",
    "core:window:allow-set-size",
    "core:window:allow-set-position",
  ]));
  expect(capabilities.permissions).not.toContain("core:window:allow-all");
});
