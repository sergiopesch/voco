import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfigRecoveryPanel } from "@/components/ConfigRecoveryPanel";

describe("ConfigRecoveryPanel", () => {
  it("explains the safe recovery choices without silently discarding settings", () => {
    const markup = renderToStaticMarkup(
      <ConfigRecoveryPanel
        error="config.json must be a regular file"
        onRetry={vi.fn(async () => {})}
        onOpenDirectory={vi.fn(async () => {})}
        onReset={vi.fn(async () => {})}
      />,
    );

    expect(markup).toContain("VOCO settings need attention");
    expect(markup).toContain("config.json must be a regular file");
    expect(markup).toContain("Retry loading settings");
    expect(markup).toContain("Open config directory");
    expect(markup).toContain("Reset to defaults");
    expect(markup).toContain("timestamped recovery backup");
    expect(markup).not.toContain("Confirm reset");
  });
});
