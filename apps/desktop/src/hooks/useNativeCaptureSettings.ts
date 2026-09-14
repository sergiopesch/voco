import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import {
  listNativeCaptureSources,
  nativeCaptureEnabled,
  selectNativeCaptureSource,
  type CaptureBackendMode,
  type NativeCaptureSource,
  type NativeCaptureSourceList,
} from "@/lib/nativeCaptureSettings";

export interface NativeMicrophoneControls {
  mode: CaptureBackendMode;
  sources: NativeCaptureSourceList | null;
  selected: NativeCaptureSource | null;
  busy: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (token: string) => Promise<void>;
}

export function useNativeCaptureSettings(): NativeMicrophoneControls {
  const mode = useStore((state) => state.captureBackendMode);
  const selected = useStore((state) => state.nativeCaptureSource);
  const [sources, setSources] = useState<NativeCaptureSourceList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const request = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current += 1; };
  }, []);

  const refresh = useCallback(async () => {
    const state = useStore.getState();
    if (state.captureBackendMode !== "native" || ["recording", "processing"].includes(state.status)) return;
    const id = ++request.current;
    setBusy(true);
    try {
      const next = await listNativeCaptureSources();
      if (!mounted.current || request.current !== id) return;
      setSources(next);
      const previous = useStore.getState().nativeCaptureSource;
      if (previous && !next.sources.some((source) => source.selectionToken === previous.selectionToken)) {
        useStore.getState().setNativeCaptureSource(null);
        setError("The microphone list changed. Choose and allow a microphone again.");
      } else setError(null);
    } catch (cause) {
      if (!mounted.current || request.current !== id) return;
      setSources(null);
      useStore.getState().setNativeCaptureSource(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current && request.current === id) setBusy(false);
    }
  }, []);

  const initialize = useCallback(async () => {
    const id = ++request.current;
    setBusy(true);
    try {
      const enabled = await nativeCaptureEnabled();
      if (!mounted.current || request.current !== id) return;
      useStore.getState().setCaptureBackendMode(enabled ? "native" : "webkit");
      setError(null);
      setBusy(false);
      if (enabled) await refresh();
    } catch (cause) {
      if (!mounted.current || request.current !== id) return;
      useStore.getState().setCaptureBackendMode("pending");
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
      throw cause;
    }
  }, [refresh]);

  const select = useCallback(async (token: string) => {
    const state = useStore.getState();
    if (state.captureBackendMode !== "native" || ["recording", "processing"].includes(state.status)) return;
    const id = ++request.current;
    setBusy(true);
    // A change must never leave the previous grant looking like the new choice.
    state.setNativeCaptureSource(null);
    try {
      const source = await selectNativeCaptureSource(token);
      if (!mounted.current || request.current !== id) return;
      useStore.getState().setNativeCaptureSource(source);
      setError(null);
    } catch (cause) {
      if (mounted.current && request.current === id) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current && request.current === id) setBusy(false);
    }
  }, []);

  return { mode, sources, selected, busy, error, initialize, refresh, select };
}
