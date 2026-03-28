import { useEffect } from "react";
import { useStore } from "@/store/useStore";
import { getConfig } from "@/lib/tauri";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { useDictation } from "@/hooks/useDictation";

export function App() {
  const { setConfig, setError } = useStore();
  const { toggle, moveWindowOffScreen } = useDictation();
  useGlobalShortcut(toggle);

  useEffect(() => {
    async function init() {
      try {
        setConfig(await getConfig());
        moveWindowOffScreen();
      } catch (err) {
        setError(
          `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    init();
  }, [setConfig, setError, moveWindowOffScreen]);

  return null;
}
