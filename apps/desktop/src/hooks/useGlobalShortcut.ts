import { useEffect, useRef } from "react";
import { useDictation } from "@/hooks/useDictation";

export function useGlobalShortcut() {
  const { toggle } = useDictation();
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  useEffect(() => {
    // Expose toggle function globally so Rust can call it via window.eval()
    (window as unknown as Record<string, unknown>).__toggleDictation = () => {
      console.log("__toggleDictation called from Rust");
      toggleRef.current();
    };

    return () => {
      delete (window as unknown as Record<string, unknown>).__toggleDictation;
    };
  }, []);
}
