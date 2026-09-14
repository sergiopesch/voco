import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeMicVisual } from "@/components/RealtimeMicVisual";

describe("RealtimeMicVisual", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders an active VOCO mic visual with level-driven scale variables", () => {
    const markup = renderToStaticMarkup(
      <RealtimeMicVisual active={true} level={0.5} status="listening" />,
    );

    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('data-status="listening"');
    expect(markup).toContain("--voco-realtime-image-scale:1.080");
    expect(markup).toContain("--voco-realtime-outer-scale:1.360");
    expect(markup).toContain("voco-realtime-mic__bar");
  });

  it("clamps out-of-range levels before writing CSS variables", () => {
    const markup = renderToStaticMarkup(
      <RealtimeMicVisual active={true} level={10} status="speaking" />,
    );

    expect(markup).toContain("--voco-realtime-level:1.000");
    expect(markup).toContain("--voco-realtime-image-scale:1.160");
  });

  it("keeps every decorative property stationary across audio levels when motion is reduced", () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => ({ matches: true })),
    });
    const renderAtLevel = (level: number) => renderToStaticMarkup(
      <RealtimeMicVisual active={true} level={level} status="listening" />,
    );
    const quiet = renderAtLevel(0);

    expect(renderAtLevel(0.5)).toBe(quiet);
    expect(renderAtLevel(1)).toBe(quiet);
    expect(quiet).toContain('data-reduced-motion="true"');
    expect(quiet).toContain('data-active="true"');
    expect(quiet).toContain('data-status="listening"');
    expect(quiet).toContain('aria-hidden="true"');
  });

  it("keeps the existing audio feedback when motion is allowed", () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => ({ matches: false })),
    });
    const quiet = renderToStaticMarkup(
      <RealtimeMicVisual active={true} level={0} status="speaking" />,
    );
    const loud = renderToStaticMarkup(
      <RealtimeMicVisual active={true} level={1} status="speaking" />,
    );

    expect(quiet).not.toBe(loud);
    expect(loud).toContain('data-reduced-motion="false"');
    expect(loud).toContain('data-status="speaking"');
  });
});
