import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

it("keeps the panel setup action visible when desktop readiness blocks Done", () => {
  const markup = renderToStaticMarkup(<Onboarding
    microphone="System default" status="idle" transcript="Test worked" passed failed={false}
    attempted setupError={null} desktopSetupError="Sign out and back in to load Stop." showPanelSetup
    checkingDesktopSetup={false} preparing={false} saving={false} blocked={false}
    hotkey="Alt+D" desktopReady={false} onStart={vi.fn()} onStop={vi.fn()}
    onFinish={vi.fn(async () => {})} onCheckDesktopSetup={vi.fn()}
  />);
  expect(markup).toContain("Sign out and back in to load Stop.");
  expect(markup).toContain("Tray setup");
  expect(markup).toContain("Check desktop setup");
  expect(markup).not.toContain(">Done</button>");
});

it("does not offer companion controls for an input-helper failure", () => {
  const markup = renderToStaticMarkup(<Onboarding
    microphone="System default" status="idle" transcript="Test worked" passed failed={false}
    attempted setupError={null} desktopSetupError="Input service is unavailable."
    preparing={false} saving={false} blocked={false} hotkey="Alt+D" desktopReady={false}
    onStart={vi.fn()} onStop={vi.fn()} onFinish={vi.fn(async () => {})}
  />);
  expect(markup).toContain("Input service is unavailable.");
  expect(markup).not.toContain("Tray setup");
});
