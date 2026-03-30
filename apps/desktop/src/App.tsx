import { useEffect } from "react";
import { useStore } from "@/store/useStore";
import { getConfig } from "@/lib/tauri";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { useDictation } from "@/hooks/useDictation";
import { StatusOverlay } from "@/components/StatusOverlay";

export function App() {
  const status = useStore((state) => state.status);
  const setConfig = useStore((state) => state.setConfig);
  const setError = useStore((state) => state.setError);
  const { prepareWindow, syncIndicatorWindow, toggle } = useDictation();

  useGlobalShortcut(toggle);

  useEffect(() => {
    async function init() {
      try {
        setConfig(await getConfig());
        await prepareWindow();
      } catch (err) {
        setError(
          `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    void init();
  }, [prepareWindow, setConfig, setError]);

  useEffect(() => {
    void syncIndicatorWindow(status);
  }, [status, syncIndicatorWindow]);

  return <StatusOverlay />;
}
