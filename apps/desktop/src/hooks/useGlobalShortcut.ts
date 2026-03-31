import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const TOGGLE_EVENT = "voice:toggle-dictation";

export function useGlobalShortcut(
  toggle: () => void,
  enabled: boolean,
  appStartMs: number,
  onHotkeyPressed: () => void,
) {
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let unlisten: (() => void) | null = null;
    let disposed = false;

    void getCurrentWindow()
      .listen(TOGGLE_EVENT, () => {
        onHotkeyPressed();
        toggleRef.current();
      })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }

        unlisten = cleanup;
        const elapsed = Math.round(performance.now() - appStartMs);
        console.info("Hotkey listener attached");
        console.info(
          `[timing] app start -> hotkey listener attachment: ${elapsed}ms`,
        );
      })
      .catch((error) => {
        console.warn("Failed to register dictation toggle listener:", error);
      });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [appStartMs, enabled, onHotkeyPressed]);
}
