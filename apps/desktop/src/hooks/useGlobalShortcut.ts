import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { traceHotkeyEvent } from "@/lib/tauri";

const TOGGLE_EVENT = "voco:toggle-dictation";
const TOGGLE_REALTIME_EVENT = "voco:toggle-realtime";

export function useGlobalShortcut(
  toggle: () => void,
  toggleRealtime: () => void,
  shouldHandleHotkey: () => boolean,
  canHandleHotkey: boolean,
  appStartMs: number,
  onHotkeyPressed: () => void,
) {
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const toggleRealtimeRef = useRef(toggleRealtime);
  toggleRealtimeRef.current = toggleRealtime;
  const shouldHandleHotkeyRef = useRef(shouldHandleHotkey);
  shouldHandleHotkeyRef.current = shouldHandleHotkey;
  const onHotkeyPressedRef = useRef(onHotkeyPressed);
  onHotkeyPressedRef.current = onHotkeyPressed;
  const handlerReadyLoggedRef = useRef(false);
  const [listenerRegistered, setListenerRegistered] = useState(false);

  useEffect(() => {
    const cleanupFns: Array<() => void> = [];
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

        cleanupFns.push(cleanup);
        setListenerRegistered(true);
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

    void getCurrentWindow()
      .listen(TOGGLE_REALTIME_EVENT, () => {
        if (!shouldHandleHotkeyRef.current()) {
          return;
        }
        toggleRealtimeRef.current();
      })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }

        cleanupFns.push(cleanup);
      })
      .catch((error) => {
        console.warn("Failed to register realtime toggle listener:", error);
      });

    return () => {
      disposed = true;
      cleanupFns.forEach((cleanup) => cleanup());
    };
  }, [appStartMs]);

  useEffect(() => {
    if (!listenerRegistered || !canHandleHotkey || handlerReadyLoggedRef.current) {
      return;
    }

    handlerReadyLoggedRef.current = true;
    traceHotkeyEvent("frontend_hotkey_handler_ready").catch(() => {});
  }, [canHandleHotkey, listenerRegistered]);
}
