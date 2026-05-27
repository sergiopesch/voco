import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RealtimeMicVisual } from "@/components/RealtimeMicVisual";

describe("RealtimeMicVisual", () => {
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
});
