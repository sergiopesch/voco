import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

it("offers the panel companion as an optional step once desktop input is ready", () => {
  const markup = renderToStaticMarkup(<Onboarding
    microphone="System default" status="idle" transcript="Test worked" passed failed={false}
    attempted setupError={null} desktopSetupError={null}
    checkingDesktopSetup={false} preparing={false} saving={false} blocked={false}
    hotkey="Alt+D" desktopReady onStart={vi.fn()} onStop={vi.fn()}
    onFinish={vi.fn(async () => {})} onCheckDesktopSetup={vi.fn()}
  />);
  expect(markup).toContain("Panel setup");
  expect(markup).toContain(">Done</button>");
  expect(markup).not.toContain("Check desktop setup");
});

it("blocks Done for an input-helper failure without offering companion controls", () => {
  const markup = renderToStaticMarkup(<Onboarding
    microphone="System default" status="idle" transcript="Test worked" passed failed={false}
    attempted setupError={null} desktopSetupError="Input service is unavailable."
    preparing={false} saving={false} blocked={false} hotkey="Alt+D" desktopReady={false}
    onStart={vi.fn()} onStop={vi.fn()} onFinish={vi.fn(async () => {})}
  />);
  expect(markup).toContain("Input service is unavailable.");
  expect(markup).toContain("Check desktop setup");
  expect(markup).not.toContain(">Done</button>");
  expect(markup).not.toContain("Panel setup");
});
