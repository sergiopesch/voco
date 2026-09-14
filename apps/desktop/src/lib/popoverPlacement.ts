export interface PhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhysicalMonitorBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

interface LogicalPopoverSize {
  width: number;
  height: number;
}

export interface PhysicalPopoverPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function placeTrayPopover(
  anchor: PhysicalRect | null,
  monitor: PhysicalMonitorBounds,
  popover: LogicalPopoverSize,
  marginLogical = 16,
  gapLogical = 10,
): PhysicalPopoverPlacement {
  const positive = (value: number, fallback: number) =>
    Number.isFinite(value) && value > 0 ? value : fallback;
  const scaleFactor = positive(monitor.scaleFactor, 1);
  const monitorX = Number.isFinite(monitor.x) ? monitor.x : 0;
  const monitorY = Number.isFinite(monitor.y) ? monitor.y : 0;
  const left = Math.ceil(monitorX);
  const top = Math.ceil(monitorY);
  const right = Math.max(left + 1, Math.floor(monitorX + positive(monitor.width, 800)));
  const bottom = Math.max(top + 1, Math.floor(monitorY + positive(monitor.height, 600)));
  const requestedMargin = Math.ceil(Math.max(0, Number.isFinite(marginLogical) ? marginLogical : 16) * scaleFactor);
  // Shrink margins on tiny work areas before shrinking the window to one pixel.
  const marginX = Math.min(requestedMargin, Math.floor((right - left - 1) / 2));
  const marginY = Math.min(requestedMargin, Math.floor((bottom - top - 1) / 2));
  const width = Math.min(Math.max(1, Math.round(positive(popover.width, 420) * scaleFactor)), right - left - 2 * marginX);
  const height = Math.min(Math.max(1, Math.round(positive(popover.height, 660) * scaleFactor)), bottom - top - 2 * marginY);
  const gap = Math.max(0, Number.isFinite(gapLogical) ? gapLogical : 10) * scaleFactor;
  const usableAnchor = anchor && Object.values(anchor).every(Number.isFinite) && anchor.width >= 0 && anchor.height >= 0;

  let x = usableAnchor ? anchor.x + anchor.width / 2 - width / 2 : left + (right - left - width) / 2;
  let y = usableAnchor ? anchor.y + anchor.height + gap : top + (bottom - top - height) / 2;
  if (usableAnchor && y + height > bottom - marginY) y = anchor.y - height - gap;
  x = Math.max(left + marginX, Math.min(x, right - width - marginX));
  y = Math.max(top + marginY, Math.min(y, bottom - height - marginY));

  return { x: Math.round(x), y: Math.round(y), width, height };
}
