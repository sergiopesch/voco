import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { traceHotkeyEvent } from "@/lib/tauri";

const TOGGLE_EVENT = "voco:toggle-dictation";

export function useGlobalShortcut(
  toggle: () => void,
  shouldHandleHotkey: () => boolean,
  canHandleHotkey: boolean,
  appStartMs: number,
  onHotkeyPressed: () => void,
) {
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const shouldHandleHotkeyRef = useRef(shouldHandleHotkey);
  shouldHandleHotkeyRef.current = shouldHandleHotkey;
  const onHotkeyPressedRef = useRef(onHotkeyPressed);
  onHotkeyPressedRef.current = onHotkeyPressed;
  const handlerReadyLoggedRef = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;

    void getCurrentWindow()
      .listen(TOGGLE_EVENT, () => {
        traceHotkeyEvent("frontend_toggle_received").catch(() => {});
        onHotkeyPressedRef.current();
        if (!shouldHandleHotkeyRef.current()) {
          return;
        }
        toggleRef.current();
      })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }

        unlisten = cleanup;
        traceHotkeyEvent("frontend_hotkey_listener_registered").catch(() => {});
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
  }, [appStartMs]);

  useEffect(() => {
    if (!canHandleHotkey || handlerReadyLoggedRef.current) {
      return;
    }

    handlerReadyLoggedRef.current = true;
    traceHotkeyEvent("frontend_hotkey_handler_ready").catch(() => {});
  }, [canHandleHotkey]);
}
