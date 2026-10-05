import { expect, it } from "vitest";
import capabilities from "../../src-tauri/capabilities/default.json";
import tauriConfig from "../../src-tauri/tauri.conf.json";

it("grants the main window only the window commands VOCO uses", () => {
  expect(capabilities.windows).toEqual(["main"]);
  // core:default includes geometry queries and events, not window mutation
  // commands. Without allow-center, settings/onboarding keep the old overlay
  // position. Rust registers the shortcut itself, so the page gets no
  // global-shortcut commands.
  expect(capabilities.permissions).toEqual([
    "core:default",
    "core:window:allow-hide",
    "core:window:allow-show",
    "core:window:allow-set-focus",
    "core:window:allow-set-size",
    "core:window:allow-set-position",
    "core:window:allow-center",
    "core:window:allow-set-min-size",
    "core:window:allow-set-resizable",
    "core:window:allow-set-skip-taskbar",
    "core:window:allow-set-always-on-top",
    "core:window:allow-set-ignore-cursor-events",
    "core:window:allow-start-dragging",
    "core:window:allow-start-resize-dragging",
  ]);
});

it("creates the window undecorated, so no surface sets decorations", () => {
  expect(tauriConfig.app.windows[0]?.decorations).toBe(false);
});
