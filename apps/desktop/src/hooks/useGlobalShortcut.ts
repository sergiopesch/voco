import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ackBrowserStop, refreshShortcutHeartbeat, releaseBrowserRecording, traceHotkeyEvent } from "@/lib/tauri";
import { isBrowserTrigger, type DictationTriggerAction } from "@/lib/dictationTrigger";

const TOGGLE_EVENT = "voco:toggle-dictation";

export function shouldMarkHotkeyHandlerReady(
  dictationListenerRegistered: boolean,
  canHandleHotkey: boolean,
  alreadyLogged: boolean,
) {
  return (
    dictationListenerRegistered &&
    canHandleHotkey &&
    !alreadyLogged
  );
}

export function browserStopReceipt(
  triggerId: string | undefined,
  action: DictationTriggerAction | undefined,
  handled: boolean,
): string | null {
  return handled && action === "stop" && isBrowserTrigger(triggerId) ? triggerId : null;
}

export function shouldProcessHotkeyEvent(
  canHandleHotkey: boolean,
  triggerId?: string,
  action?: DictationTriggerAction,
  stopSession?: string,
): boolean {
  return canHandleHotkey || (action === "stop" && (isBrowserTrigger(triggerId) ||
    (triggerId === "tray:stop" && typeof stopSession === "string" && stopSession.length > 0)));
}

export function useGlobalShortcut(
  toggle: (triggerId?: string, action?: DictationTriggerAction, stopSession?: string) => boolean | Promise<boolean>,
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
  const [dictationListenerRegistered, setDictationListenerRegistered] = useState(false);

  useEffect(() => {
    const cleanupFns: Array<() => void> = [];
    let disposed = false;

    void getCurrentWindow()
      .listen<{ triggerId?: string; action?: DictationTriggerAction; stopSession?: string } | null>(TOGGLE_EVENT, (event) => {
        traceHotkeyEvent("frontend_toggle_received").catch(() => {});
        onHotkeyPressedRef.current();
        const { triggerId, action, stopSession } = event.payload ?? {};
        if (!shouldProcessHotkeyEvent(shouldHandleHotkeyRef.current(), triggerId, action, stopSession)) {
          if (event.payload?.action === "start" && event.payload.triggerId?.startsWith("browser:")) {
            void releaseBrowserRecording(event.payload.triggerId).catch(() => {});
          }
          return;
        }
        void Promise.resolve(toggleRef.current(triggerId, action, stopSession))
          .then((handled) => {
            const receipt = browserStopReceipt(triggerId, action, handled);
            if (receipt) return ackBrowserStop(receipt);
          })
          .catch(() => {});
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

    return () => {
      disposed = true;
      cleanupFns.forEach((cleanup) => cleanup());
    };
  }, [appStartMs]);

  useEffect(() => {
    if (!dictationListenerRegistered || !canHandleHotkey) return;
    const refresh = () => { void refreshShortcutHeartbeat(true).catch(() => {}); };
    refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => {
      window.clearInterval(timer);
      void refreshShortcutHeartbeat(false).catch(() => {});
    };
  }, [canHandleHotkey, dictationListenerRegistered]);

  useEffect(() => {
    if (
      !shouldMarkHotkeyHandlerReady(
        dictationListenerRegistered,
        canHandleHotkey,
        handlerReadyLoggedRef.current,
      )
    ) {
      return;
    }

    handlerReadyLoggedRef.current = true;
    traceHotkeyEvent("frontend_hotkey_handler_ready").catch(() => {});
  }, [canHandleHotkey, dictationListenerRegistered]);
}
