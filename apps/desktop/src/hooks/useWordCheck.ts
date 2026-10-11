import { useCallback, useEffect, useRef, useState } from "react";
import { isDictationActive } from "@/lib/activityMode";
import { loadEverydayWords } from "@/lib/everydayWords";
import type { Teaching } from "@/lib/myWords";
import { useStore } from "@/store/useStore";

export type WordCheckState =
  | { phase: "idle" }
  | { phase: "starting" | "listening" | "finishing"; entry: string }
  | { phase: "heard"; entry: string; transcript: string; everyday: ReadonlySet<string> }
  | { phase: "taught"; entry: string; teaching: Teaching }
  | { phase: "failed"; entry: string; message: string };

// Say it ends by itself once the voice has stopped: the visual level that
// counts as speaking, the level below which it is quiet, and how long each lasts.
const SPEAKING_LEVEL = 0.45;
const QUIET_LEVEL = 0.3;
const SPOKEN_MS = 200;
const QUIET_MS = 900;
// Words that stop changing end it too, in a room too loud to fall quiet.
const SETTLED_MS = 1400;
const NOTHING_SAID_MS = 5000;
const LONGEST_MS = 8000;
const START_TIMEOUT_MS = 10000;

/** Starts a check; `current` turns false once the check has given up, so a
 * start still waiting for the microphone records nothing. */
export type StartWordCheck = (current: () => boolean) => Promise<string | null>;

/** One Say it check at a time: it records for VOCO's window only, ends when
 * the person stops speaking, and returns what VOCO heard. */
export function useWordCheck(start: StartWordCheck, stop: () => void) {
  const [state, setState] = useState<WordCheckState>({ phase: "idle" });
  const run = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = state.phase === "starting" || state.phase === "listening" || state.phase === "finishing";
  const activeRun = active ? run.current : null;
  const entry = "entry" in state ? state.entry : "";

  const begin = useCallback(async (word: string) => {
    const id = ++run.current;
    setState({ phase: "starting", entry: word });
    // The list loads while VOCO listens, so the result never waits for it.
    void loadEverydayWords().catch(() => {});
    const problem = await start(() => mounted.current && run.current === id);
    if (problem && id === run.current) setState({ phase: "failed", entry: word, message: problem });
  }, [start]);

  // Follows the recording the check started, from the store its owner updates.
  useEffect(() => {
    if (activeRun === null) return;
    const begun = performance.now();
    let seen = false, stopping = false;
    let recordingAt: number | null = null, lastAt = begun, spokenMs = 0, quietSince: number | null = null;
    let words = "", wordsAt = begun;
    const finish = (next: WordCheckState) => { if (run.current === activeRun) setState(next); };
    // The check reports its own failure, so setup and Settings stay as they were.
    const fail = (message: string) => {
      const store = useStore.getState();
      store.setError(null);
      store.setStatus("idle");
      finish({ phase: "failed", entry, message });
    };
    const timer = window.setInterval(() => {
      const store = useStore.getState();
      const now = performance.now();
      // A start can fail between two looks, before the check ever sees it run.
      if (store.dictationPurpose === "words" && store.status === "error") {
        window.clearInterval(timer);
        fail(store.error ?? "The check couldn't finish. Try again.");
        return;
      }
      if (store.dictationPurpose === "words" && isDictationActive(store.status)) {
        seen = true;
        if (store.status === "recording") {
          recordingAt ??= now;
          setState(current => current.phase === "starting" ? { phase: "listening", entry } : current);
          const level = store.audioLevel;
          if (level >= SPEAKING_LEVEL) { spokenMs += now - lastAt; quietSince = null; }
          else if (level < QUIET_LEVEL) quietSince ??= now;
          if (store.transcript !== words) { words = store.transcript; wordsAt = now; }
          const listened = now - recordingAt;
          const ended = spokenMs >= SPOKEN_MS && quietSince !== null && now - quietSince >= QUIET_MS;
          const settled = words.trim() !== "" && now - wordsAt >= SETTLED_MS && level < SPEAKING_LEVEL;
          if (!stopping && (ended || settled || listened >= LONGEST_MS || (spokenMs === 0 && listened >= NOTHING_SAID_MS))) {
            stopping = true;
            stop();
          }
        } else if (store.status === "processing") {
          setState(current => current.phase === "listening" || current.phase === "starting" ? { phase: "finishing", entry } : current);
        }
        lastAt = now;
        return;
      }
      lastAt = now;
      if (!seen) {
        if (now - begun > START_TIMEOUT_MS) {
          window.clearInterval(timer);
          fail("VOCO couldn't start listening. Try again.");
          // A start still waiting for the microphone now records nothing.
          run.current += 1;
        }
        return;
      }
      window.clearInterval(timer);
      if (store.error) {
        fail(store.error);
        return;
      }
      const transcript = store.transcript;
      // Without the list VOCO can't warn about everyday words, so it teaches
      // nothing. A chunk that failed to load stays failed until VOCO restarts.
      void loadEverydayWords().then(
        everyday => finish({ phase: "heard", entry, transcript, everyday }),
        () => finish({ phase: "failed", entry, message: "VOCO couldn't read its list of everyday words. Restart VOCO, then try again." }));
    }, 50);
    return () => window.clearInterval(timer);
  }, [activeRun, entry, stop]);

  // A check still listening when its page closes ends there.
  const listening = useRef(false);
  listening.current = active;
  useEffect(() => () => { if (listening.current) stop(); }, [stop]);

  const end = useCallback(() => { if (active) stop(); }, [active, stop]);
  const reset = useCallback(() => { run.current += 1; setState({ phase: "idle" }); }, []);
  const taught = useCallback((word: string, teaching: Teaching) => {
    run.current += 1;
    setState({ phase: "taught", entry: word, teaching });
  }, []);
  return { state, active, begin, end, reset, taught };
}
