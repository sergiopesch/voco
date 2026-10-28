import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NativeMicrophoneSettings } from "@/components/NativeMicrophoneSettings";
import type { NativeMicrophoneControls } from "@/hooks/useNativeCaptureSettings";
import type { NativeCaptureSource } from "@/lib/nativeCaptureSettings";

const microphone: NativeCaptureSource = {
  selectionToken: "token-mic", name: "mic", label: "Digital Microphone", index: 1, objectSerial: "59", isMonitor: false,
};
const headset: NativeCaptureSource = {
  selectionToken: "token-headset", name: "headset", label: "Headset Microphone", index: 2, objectSerial: "58", isMonitor: false,
};

function controls(overrides: Partial<NativeMicrophoneControls>): NativeMicrophoneControls {
  const noop = async () => {};
  return {
    mode: "native",
    sources: { revision: "1", defaultSelectionToken: "token-mic", sources: [headset, microphone] },
    selected: null, busy: false, error: null,
    initialize: noop, refresh: noop, ensureDefault: noop, select: async () => true,
    ...overrides,
  };
}

// DeviceSelect shows the label of its value in the closed combobox.
function shown(markup: string) {
  return /role="combobox"[^>]*><span>([^<]*)<\/span>/.exec(markup)?.[1];
}

describe("NativeMicrophoneSettings", () => {
  it("shows the system default while nothing is chosen, which is what a recording uses", () => {
    const markup = renderToStaticMarkup(<NativeMicrophoneSettings controls={controls({})} disabled={false} />);
    expect(shown(markup)).toBe("System default (current device)");
    expect(markup).not.toContain("Selected:");
  });

  it("asks for a choice when the system default can't be recorded", () => {
    const unusable = { ...microphone, objectSerial: null };
    const markup = renderToStaticMarkup(<NativeMicrophoneSettings disabled={false}
      controls={controls({ sources: { revision: "1", defaultSelectionToken: "token-mic", sources: [headset, unusable] } })} />);
    expect(shown(markup)).toBe("Choose a microphone");
  });

  it("shows the microphone that was chosen", () => {
    const markup = renderToStaticMarkup(<NativeMicrophoneSettings controls={controls({ selected: headset })} disabled={false} />);
    expect(shown(markup)).toBe("Headset Microphone");
    expect(markup).toContain("Selected: Headset Microphone.");
  });
});
