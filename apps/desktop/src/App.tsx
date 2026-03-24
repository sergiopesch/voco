import { useEffect } from "react";
import { useStore } from "@/store/useStore";
import { getConfig, getPlatformInfo, getModelStatus } from "@/lib/tauri";
import { Overlay } from "@/components/Overlay";
import { ModelSetup } from "@/components/ModelSetup";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { useDictation } from "@/hooks/useDictation";

export function App() {
  const { modelReady, setConfig, setPlatform, setModelReady, setError } =
    useStore();

  const { showWindowLarge, moveWindowOffScreen } = useDictation();
  useGlobalShortcut();

  useEffect(() => {
    async function init() {
      try {
        const [config, platform, model] = await Promise.all([
          getConfig(),
          getPlatformInfo(),
          getModelStatus(),
        ]);
        setConfig(config);
        setPlatform(platform);
        setModelReady(model.downloaded);

        if (!model.downloaded) {
          showWindowLarge();
        } else {
          // Model ready — move window off-screen (keep WebView alive for mic access)
          moveWindowOffScreen();
        }
      } catch (err) {
        setError(
          `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    init();
  }, [setConfig, setPlatform, setModelReady, setError, showWindowLarge, moveWindowOffScreen]);

  if (!modelReady) {
    return (
      <div className="h-screen bg-gray-950/95 backdrop-blur-sm rounded-2xl overflow-hidden">
        <ModelSetup
          onComplete={() => {
            setModelReady(true);
            moveWindowOffScreen();
          }}
        />
      </div>
    );
  }

  return <Overlay />;
}
