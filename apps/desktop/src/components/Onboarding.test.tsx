import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";
import { useStore } from "@/store/useStore";

// Static rendering reads zustand's initial state, so read the live store instead.
vi.mock("@/store/useStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/useStore")>();
  type State = ReturnType<typeof actual.useStore.getState>;
  const useLiveStore = <T,>(selector: (state: State) => T) => selector(actual.useStore.getState());
  return { ...actual, useStore: Object.assign(useLiveStore, actual.useStore) };
});

afterEach(() => useStore.setState({ transcript: "", dictationPurpose: "cursor" }));

it("shows recognition text only for the voice test", () => {
  const render = () => renderToStaticMarkup(<Onboarding
    microphone="System default" status="idle" passed={false} failed={false}
    attempted preparing={false} saving={false} blocked={false} hotkey="Alt+D"
    onStart={vi.fn()} onStop={vi.fn()} onFinish={vi.fn(async () => {})}
  />);
  useStore.setState({ transcript: "Words from the test", dictationPurpose: "onboarding" });
  expect(render()).toContain("Words from the test");
  useStore.setState({ dictationPurpose: "cursor" });
  expect(render()).not.toContain("Words from the test");
});

it("offers the panel companion as an optional step once desktop input is ready", () => {
  const markup = renderToStaticMarkup(<Onboarding
    microphone="System default" status="idle" passed failed={false}
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
    microphone="System default" status="idle" passed failed={false}
    attempted setupError={null} desktopSetupError="Input service is unavailable."
    preparing={false} saving={false} blocked={false} hotkey="Alt+D" desktopReady={false}
    onStart={vi.fn()} onStop={vi.fn()} onFinish={vi.fn(async () => {})}
  />);
  expect(markup).toContain("Input service is unavailable.");
  expect(markup).toContain("Check desktop setup");
  expect(markup).not.toContain(">Done</button>");
  expect(markup).not.toContain("Panel setup");
});
