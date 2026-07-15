import { describe, expect, it } from "vitest";
import { placeTrayPopover } from "@/lib/popoverPlacement";

describe("tray popover placement", () => {
  it("keeps physical tray coordinates and scales the logical popover on HiDPI monitors", () => {
    expect(
      placeTrayPopover(
        { x: 3000, y: 40, width: 48, height: 48 },
        { x: 1920, y: 0, width: 2560, height: 1440, scaleFactor: 2 },
        { width: 420, height: 520 },
      ),
    ).toEqual({ x: 2604, y: 108, width: 840, height: 1040 });
  });

  it("flips above a bottom tray and clamps within a negative-position monitor", () => {
    expect(
      placeTrayPopover(
        { x: -80, y: 1010, width: 32, height: 32 },
        { x: -1280, y: 0, width: 1280, height: 1080, scaleFactor: 1 },
        { width: 420, height: 520 },
      ),
    ).toEqual({ x: -436, y: 480, width: 420, height: 520 });
  });

  it("uses a safe 1x scale for invalid monitor metadata", () => {
    const placement = placeTrayPopover(
      { x: 100, y: 100, width: 20, height: 20 },
      { x: 0, y: 0, width: 800, height: 600, scaleFactor: 0 },
      { width: 420, height: 520 },
    );
    expect(placement.width).toBe(420);
    expect(placement.height).toBe(520);
    expect(placement.x).toBeGreaterThanOrEqual(16);
    expect(placement.y).toBeGreaterThanOrEqual(16);
  });
});
