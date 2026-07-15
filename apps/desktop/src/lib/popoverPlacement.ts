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
  anchor: PhysicalRect,
  monitor: PhysicalMonitorBounds,
  popover: LogicalPopoverSize,
  marginLogical = 16,
  gapLogical = 10,
): PhysicalPopoverPlacement {
  const scaleFactor =
    Number.isFinite(monitor.scaleFactor) && monitor.scaleFactor > 0
      ? monitor.scaleFactor
      : 1;
  const width = popover.width * scaleFactor;
  const height = popover.height * scaleFactor;
  const margin = marginLogical * scaleFactor;
  const gap = gapLogical * scaleFactor;

  let x = anchor.x + anchor.width / 2 - width / 2;
  let y = anchor.y + anchor.height + gap;

  x = Math.max(
    monitor.x + margin,
    Math.min(x, monitor.x + monitor.width - width - margin),
  );

  if (y + height > monitor.y + monitor.height - margin) {
    y = anchor.y - height - gap;
  }
  y = Math.max(
    monitor.y + margin,
    Math.min(y, monitor.y + monitor.height - height - margin),
  );

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}
