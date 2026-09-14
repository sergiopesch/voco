import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { refreshShortcutHeartbeat, releaseBrowserRecording, traceHotkeyEvent } from "@/lib/tauri";
import type { DictationTriggerAction } from "@/lib/dictationTrigger";

const TOGGLE_EVENT = "voco:toggle-dictation";
const TOGGLE_REALTIME_EVENT = "voco:toggle-realtime";

export function shouldMarkHotkeyHandlerReady(
  dictationListenerRegistered: boolean,
  realtimeListenerRegistered: boolean,
  canHandleHotkey: boolean,
  alreadyLogged: boolean,
) {
  return (
    dictationListenerRegistered &&
    realtimeListenerRegistered &&
    canHandleHotkey &&
    !alreadyLogged
  );
}

export function useGlobalShortcut(
  toggle: (triggerId?: string, action?: DictationTriggerAction) => void,
  toggleRealtime: (triggerId?: string) => void,
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
  const [dictationListenerRegistered, setDictationListenerRegistered] = useState(false);
  const [realtimeListenerRegistered, setRealtimeListenerRegistered] = useState(false);

  useEffect(() => {
    const cleanupFns: Array<() => void> = [];
    let disposed = false;

    void getCurrentWindow()
      .listen<{ triggerId?: string; action?: DictationTriggerAction } | null>(TOGGLE_EVENT, (event) => {
        traceHotkeyEvent("frontend_toggle_received").catch(() => {});
        onHotkeyPressedRef.current();
        if (!shouldHandleHotkeyRef.current()) {
          if (event.payload?.action === "start" && event.payload.triggerId?.startsWith("browser:")) {
            void releaseBrowserRecording(event.payload.triggerId).catch(() => {});
          }
          return;
        }
        toggleRef.current(event.payload?.triggerId, event.payload?.action);
      })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }

        cleanupFns.push(cleanup);
        setDictationListenerRegistered(true);
        traceHotkeyEvent("frontend_hotkey_listener_registered").catch(() => {});
        const elapsed = Math.round(performance.now() - appStartMs);
        console.info("Frontend dictation event subscription registered");
        console.info(
          `[timing] app start -> frontend dictation event subscription: ${elapsed}ms`,
        );
      })
      .catch((error) => {
        console.warn("Failed to register dictation toggle listener:", error);
      });

    void getCurrentWindow()
      .listen<{ triggerId?: string } | null>(TOGGLE_REALTIME_EVENT, (event) => {
        if (!shouldHandleHotkeyRef.current()) {
          return;
        }
        toggleRealtimeRef.current(event.payload?.triggerId);
      })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }

        cleanupFns.push(cleanup);
        setRealtimeListenerRegistered(true);
        traceHotkeyEvent("frontend_realtime_hotkey_listener_registered").catch(() => {});
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
    if (!dictationListenerRegistered || !realtimeListenerRegistered || !canHandleHotkey) return;
    const refresh = () => { void refreshShortcutHeartbeat(true).catch(() => {}); };
    refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => {
      window.clearInterval(timer);
      void refreshShortcutHeartbeat(false).catch(() => {});
    };
  }, [canHandleHotkey, dictationListenerRegistered, realtimeListenerRegistered]);

  useEffect(() => {
    if (
      !shouldMarkHotkeyHandlerReady(
        dictationListenerRegistered,
        realtimeListenerRegistered,
        canHandleHotkey,
        handlerReadyLoggedRef.current,
      )
    ) {
      return;
    }

    handlerReadyLoggedRef.current = true;
    traceHotkeyEvent("frontend_hotkey_handler_ready").catch(() => {});
  }, [canHandleHotkey, dictationListenerRegistered, realtimeListenerRegistered]);
}
