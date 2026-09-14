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

describe("bounded recovery placement", () => {
  it("centers the requested recovery dimensions rather than a previous GTK overlay size", () => {
    expect(placeTrayPopover(null,
      { x: 0, y: 0, width: 1280, height: 900, scaleFactor: 1 },
      { width: 420, height: 660 },
    )).toEqual({ x: 430, y: 120, width: 420, height: 660 });
  });

  it("caps recovery to a small usable desktop instead of placing actions offscreen", () => {
    expect(placeTrayPopover(null,
      { x: 0, y: 40, width: 800, height: 560, scaleFactor: 1 },
      { width: 420, height: 660 },
    )).toEqual({ x: 190, y: 56, width: 420, height: 528 });
  });

  it.each([1, 1.25, 1.5, 2, 2.5])("contains every edge with negative monitor origins and scale %s", (scaleFactor) => {
    const area = { x: -1280, y: -360, width: 1280, height: 720, scaleFactor };
    for (const anchor of [null, { x: -20, y: 340, width: 32, height: 20 }, { x: -1260, y: -380, width: 20, height: 20 }]) {
      const placed = placeTrayPopover(anchor, area, { width: 420, height: 660 });
      expect(placed.x).toBeGreaterThanOrEqual(area.x);
      expect(placed.y).toBeGreaterThanOrEqual(area.y);
      expect(placed.x + placed.width).toBeLessThanOrEqual(area.x + area.width);
      expect(placed.y + placed.height).toBeLessThanOrEqual(area.y + area.height);
      Object.values(placed).forEach((value) => expect(Number.isInteger(value)).toBe(true));
    }
  });

  it("produces finite bounded fallback geometry when monitor or anchor metadata is unavailable", () => {
    const placed = placeTrayPopover(
      { x: NaN, y: Infinity, width: 0, height: 0 },
      { x: NaN, y: Infinity, width: NaN, height: 0, scaleFactor: -1 },
      { width: NaN, height: Infinity },
    );
    expect(placed).toEqual({ x: 190, y: 16, width: 420, height: 568 });
  });

  it("reduces margins safely when a work area is smaller than both margins", () => {
    const placed = placeTrayPopover(null, { x: -2, y: 3, width: 20, height: 10, scaleFactor: 2 }, { width: 420, height: 660 });
    expect(placed.x).toBeGreaterThanOrEqual(-2);
    expect(placed.y).toBeGreaterThanOrEqual(3);
    expect(placed.x + placed.width).toBeLessThanOrEqual(18);
    expect(placed.y + placed.height).toBeLessThanOrEqual(13);
    expect(placed.width).toBeGreaterThan(0);
    expect(placed.height).toBeGreaterThan(0);
  });
});
