import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { getConfig } from "@/lib/tauri";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { useDictation } from "@/hooks/useDictation";
import { StatusOverlay } from "@/components/StatusOverlay";

export function App() {
  const status = useStore((state) => state.status);
  const setConfig = useStore((state) => state.setConfig);
  const setError = useStore((state) => state.setError);
  const {
    prepareWindow,
    initializeMicrophone,
    syncIndicatorWindow,
    toggle,
    onHotkeyPressed,
  } = useDictation();
  const [initComplete, setInitComplete] = useState(false);
  const appStartMsRef = useRef(performance.now());
  const initStartedRef = useRef(false);

  useGlobalShortcut(toggle, initComplete, appStartMsRef.current, onHotkeyPressed);

  useEffect(() => {
    if (initStartedRef.current) {
      return;
    }
    initStartedRef.current = true;

    async function init() {
      try {
        setConfig(await getConfig());
        await prepareWindow();
        await initializeMicrophone(appStartMsRef.current);
      } catch (err) {
        setError(
          `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setInitComplete(true);
      }
    }
    void init();
  }, [initializeMicrophone, prepareWindow, setConfig, setError]);

  useEffect(() => {
    void syncIndicatorWindow(status);
  }, [status, syncIndicatorWindow]);

  return <StatusOverlay />;
}
