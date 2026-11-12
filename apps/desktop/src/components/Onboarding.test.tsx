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

it("moves a passed test on to the words step, then hands off with Done", () => {
  const props = {
    microphone: "System default", status: "idle" as const, passed: true, failed: false, attempted: true,
    setupError: null, desktopSetupError: null, checkingDesktopSetup: false, preparing: false, saving: false,
    blocked: false, hotkey: "Alt+D", desktopReady: true, onStart: vi.fn(), onStop: vi.fn(), onFinish: vi.fn(async () => {}),
  };
  const passed = renderToStaticMarkup(<Onboarding {...props} wordsDone={false} onContinue={vi.fn()} />);
  expect(passed).toContain("VOCO heard you.");
  expect(passed).toContain(">Continue</button>");
  expect(passed).toContain("Test again");
  expect(passed).not.toContain(">Done</button>");
  expect(passed).not.toContain("Panel setup");
  const ready = renderToStaticMarkup(<Onboarding {...props} wordsDone wordsChecked />);
  expect(ready).toContain("Your voice, ready.");
  expect(ready).toContain(">Done</button>");
  expect(ready).not.toContain("Test again");
  expect(ready).not.toContain("Test transcript");
  expect(ready).not.toContain("personalise VOCO");
  // Someone who said no word in the step hears where My words is for later.
  const skipped = renderToStaticMarkup(<Onboarding {...props} wordsDone wordsChecked={false} />);
  expect(skipped).toContain("You can always come back and personalise VOCO in Settings, under My words.");
  // The default names the Super key, which many people know only by its symbol.
  expect(ready).not.toContain("Super is the key");
  const superX = renderToStaticMarkup(<Onboarding {...props} hotkey="Super+X" wordsDone wordsChecked />);
  expect(superX).toContain("Super+X</kbd>. Press again to finish. Super is the key with the Windows or logo symbol.");
});

it("reaches the words step before desktop setup is ready, and checks it before Done", () => {
  const props = {
    microphone: "System default", status: "idle" as const, passed: true, failed: false, attempted: true,
    setupError: null, desktopSetupError: "Sign out and back in once after installing VOCO.", checkingDesktopSetup: false,
    preparing: false, saving: false, blocked: false, hotkey: "Alt+D", desktopReady: false,
    onStart: vi.fn(), onStop: vi.fn(), onFinish: vi.fn(async () => {}),
  };
  const passed = renderToStaticMarkup(<Onboarding {...props} wordsDone={false} onContinue={vi.fn()} />);
  expect(passed).toContain("VOCO heard you.");
  expect(passed).toContain(">Continue</button>");
  expect(passed).toContain("Desktop setup needs one more step.");
  expect(passed).not.toContain("Check desktop setup");
  const last = renderToStaticMarkup(<Onboarding {...props} wordsDone />);
  expect(last).toContain("One more step.");
  expect(last).toContain("Check desktop setup");
  expect(last).not.toContain(">Done</button>");
  expect(last).not.toContain("Test transcript");
  expect(last).not.toContain("Test again");
});

it("offers only the panel or GNOME's permissions when that is what desktop setup needs", () => {
  const props = {
    microphone: "System default", status: "idle" as const, passed: false, failed: false, attempted: false,
    setupError: null, checkingDesktopSetup: false, preparing: false, saving: false, blocked: false,
    hotkey: "Alt+D", desktopReady: false, onStart: vi.fn(), onStop: vi.fn(), onFinish: vi.fn(async () => {}),
    onOpenDesktopSetupGuide: vi.fn(),
  };
  // A package on GNOME whose fix is the panel: one step, the panel's own.
  const panel = renderToStaticMarkup(<Onboarding {...props} desktopSetupArea="panel"
    desktopSetupError="Enable the VOCO panel, then sign out and back in." />);
  expect(panel).toContain("Desktop setup needs one more step.");
  expect(panel).toContain("Panel setup");
  expect(panel).not.toContain("Open setup instructions");
  expect(panel).not.toContain("<summary>Details</summary>");
  // The snap on GNOME Wayland: GNOME's own permissions, never the panel.
  const snap = renderToStaticMarkup(<Onboarding {...props} desktopSetupArea="portal" storeSetup
    desktopSetupError="VOCO types into your apps through GNOME, which asks you once. Choose Allow typing, then turn on Allow Remote Interaction in GNOME's dialog and choose Share." />);
  expect(snap).toContain("Typing and shortcut");
  expect(snap).not.toContain("Panel setup");
  expect(snap).not.toContain("Open setup instructions");
  expect(snap).not.toContain("<summary>Details</summary>");
  // Any other desktop setup problem keeps its details and the guide.
  const other = renderToStaticMarkup(<Onboarding {...props} desktopSetupError="Sign out and back in once after installing VOCO." />);
  expect(other).toContain("<summary>Details</summary>");
  expect(other).toContain("Open setup instructions");
  expect(other).not.toContain("Panel setup");
});

it("leads the handoff with the fix while the shortcut also reaches the focused app", () => {
  const props = {
    microphone: "System default", status: "idle" as const, passed: true, failed: false, attempted: true,
    setupError: null, desktopSetupError: null, checkingDesktopSetup: false, preparing: false, saving: false,
    blocked: false, hotkey: "Alt+D", desktopReady: true, onStart: vi.fn(), onStop: vi.fn(), onFinish: vi.fn(async () => {}),
    wordsDone: true, wordsChecked: true,
  };
  // VOCO's own words for a panel that loads at the next login.
  const note = "Alt+D also reaches the app you are dictating into: browsers move the cursor to the address bar, so your words land there, and terminals delete a word. Panel enabled. Sign out and back in to load it; saving your work first is recommended.";
  const leaky = renderToStaticMarkup(<Onboarding {...props} shortcutNote={note} />);
  expect(leaky.split(note)).toHaveLength(2);
  expect(leaky.indexOf(note)).toBeLessThan(leaky.indexOf("where you want the text"));
  expect(leaky).toContain("Then choose Done, click where you want the text");
  // The note replaces the panel's own status line, so the step reads once.
  expect(leaky).not.toContain("Checking your panel");
  expect(leaky).toContain(">Done</button>");
  const ready = renderToStaticMarkup(<Onboarding {...props} shortcutNote={null} />);
  expect(ready).toContain("Choose Done, click where you want the text");
  // Where VOCO won't start at login, the last step doesn't promise it stays.
  expect(ready).toContain("After you sign in again, open it from your app launcher.");
  expect(ready).not.toContain("stays in your tray");
  expect(ready).not.toContain("Then click");
  expect(ready).toContain("Checking your panel");
});

it("says VOCO is running and starts at sign-in only where it will", () => {
  const props = {
    microphone: "System default", status: "idle" as const, passed: true, failed: false, attempted: true,
    setupError: null, desktopSetupError: null, checkingDesktopSetup: false, preparing: false, saving: false,
    blocked: false, hotkey: "Alt+D", desktopReady: true, onStart: vi.fn(), onStop: vi.fn(), onFinish: vi.fn(async () => {}),
    wordsDone: true, wordsChecked: true,
  };
  const starts = renderToStaticMarkup(<Onboarding {...props} startsAtLogin />);
  // Running now comes first: read alone, "starts when you sign in" sent people to sign out.
  expect(starts).toContain("VOCO is running now, and starts by itself each time you sign in. You can turn that off in Settings.");
  expect(starts).not.toContain("from your app launcher");
  // The setting is off, or a source build, which can't start at login.
  const reopens = renderToStaticMarkup(<Onboarding {...props} />);
  expect(reopens).toContain("After you sign in again, open it from your app launcher.");
  expect(reopens).not.toContain("each time you sign in");
});
