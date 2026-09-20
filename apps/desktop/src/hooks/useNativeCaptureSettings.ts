import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { errorMessage } from "@/lib/dictationRecovery";
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
  ensureDefault: (replaceSelection?: boolean) => Promise<void>;
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
      setError(errorMessage(cause));
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
      setError(errorMessage(cause));
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
      if (mounted.current && request.current === id) setError(errorMessage(cause));
    } finally {
      if (mounted.current && request.current === id) setBusy(false);
    }
  }, []);

  const ensureDefault = useCallback(async (replaceSelection = false) => {
    const state = useStore.getState();
    if (state.captureBackendMode === "pending") throw new Error("Microphone setup is still loading. Please try again.");
    if (state.captureBackendMode !== "native" || (state.nativeCaptureSource && !replaceSelection)) return;
    const id = ++request.current;
    const assertCurrent = () => {
      if (!mounted.current || request.current !== id) throw new Error("Microphone selection changed. Please start again.");
    };
    setBusy(true);
    try {
      const next = await listNativeCaptureSources();
      assertCurrent();
      setSources(next);
      const source = next.sources.find(source => source.selectionToken === next.defaultSelectionToken && source.objectSerial && !source.isMonitor);
      if (!source) throw new Error("No default microphone is available. Connect a microphone or choose one in Microphone settings.");
      const selection = await selectNativeCaptureSource(source.selectionToken);
      assertCurrent();
      useStore.getState().setNativeCaptureSource(selection);
      setError(null);
    } finally {
      if (mounted.current && request.current === id) setBusy(false);
    }
  }, []);

  return { mode, sources, selected, busy, error, initialize, refresh, select, ensureDefault };
}
