import { clampLivePreviewDelay } from "@/lib/liveCommitPolicy";
import {
  createPreviewToken,
  type DictationPreviewToken,
  type DictationSessionState,
} from "@/lib/dictationSession";
import {
  planCanonicalWork,
  planNextCompleteSourceBlock,
  type CanonicalCursorSession,
  type CanonicalSourceBlock,
  type CanonicalWork,
} from "@/lib/canonicalCursorSession";

export type Ref<T> = { current: T };

export interface LivePreviewScheduleEnv {
  sessionRef: Ref<DictationSessionState>;
  phaseRef: Ref<string>;
  canonicalSessionRef: Ref<CanonicalCursorSession | null>;
  canonicalCheckpointInFlightRef: Ref<Promise<void> | null>;
  canonicalCheckpointDeferredRef: Ref<boolean>;
  livePreviewTimeoutRef: Ref<ReturnType<typeof setTimeout> | null>;
  livePreviewNextDelayMsRef: Ref<number>;
  audioBufferRef: Ref<{ sampleCount: number }>;
  planCanonicalWork: typeof planCanonicalWork;
  planNextCompleteSourceBlock: typeof planNextCompleteSourceBlock;
  processCanonicalWork: (work: CanonicalWork, deliverCheckpoint: boolean) => Promise<void>;
  prepareCanonicalSourceBlock: (block: CanonicalSourceBlock) => Promise<void>;
  isCurrentSession: (sessionId: number) => boolean;
  shouldRunLivePreview: () => boolean;
  shouldUseFastLiveConfirmation: () => boolean;
  runLivePreview: (token: DictationPreviewToken) => unknown;
  traceDictationEvent: (event: string) => Promise<void>;
  window?: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
  console?: Pick<Console, "warn">;
}

/**
 * Owns the live-preview timer and canonical-pump timer interaction.
 * Sample arrivals without canonical work must not postpone a pending preview.
 */
export function createLivePreviewSchedule(env: LivePreviewScheduleEnv) {
  const timers = env.window ?? globalThis;
  const log = env.console ?? console;

  function clearLivePreviewTimer() {
    if (env.livePreviewTimeoutRef.current !== null) {
      timers.clearTimeout(env.livePreviewTimeoutRef.current);
      env.livePreviewTimeoutRef.current = null;
    }
  }

  function scheduleLivePreview(delayMs = env.livePreviewNextDelayMsRef.current) {
    clearLivePreviewTimer();
    if (env.canonicalCheckpointInFlightRef.current) {
      return;
    }
    const token = createPreviewToken(env.sessionRef.current);
    const safeDelayMs = clampLivePreviewDelay(
      delayMs,
      env.shouldUseFastLiveConfirmation(),
    );
    env.livePreviewTimeoutRef.current = timers.setTimeout(() => {
      env.livePreviewTimeoutRef.current = null;
      void env.runLivePreview(token);
    }, safeDelayMs);
  }

  function pumpCanonicalCheckpoints(): void {
    if (
      env.canonicalCheckpointInFlightRef.current ||
      env.canonicalCheckpointDeferredRef.current ||
      env.phaseRef.current !== "recording" ||
      !env.canonicalSessionRef.current
    ) {
      return;
    }

    // Sample arrivals without canonical work must not postpone a pending preview.
    // Keep planner errors in the existing asynchronous deferred-checkpoint path.
    try {
      if (
        !env.planCanonicalWork(env.canonicalSessionRef.current, false) &&
        !env.planNextCompleteSourceBlock(
          env.canonicalSessionRef.current,
          env.audioBufferRef.current.sampleCount,
        )
      ) {
        return;
      }
    } catch {
      // The unchanged pump below handles invalid state and reports the failure.
    }

    const pumpSessionId = env.sessionRef.current.sessionId;
    const pump = (async () => {
      try {
        while (env.phaseRef.current === "recording" && env.isCurrentSession(pumpSessionId)) {
          const state = env.canonicalSessionRef.current;
          if (!state) {
            return;
          }
          const work = env.planCanonicalWork(state, false);
          if (work) {
            await env.processCanonicalWork(work, true);
            continue;
          }
          const sourceBlock = env.planNextCompleteSourceBlock(
            state,
            env.audioBufferRef.current.sampleCount,
          );
          if (!sourceBlock) {
            return;
          }
          await env.prepareCanonicalSourceBlock(sourceBlock);
        }
      } catch (error) {
        if (!env.isCurrentSession(pumpSessionId)) return;
        if (!env.canonicalCheckpointDeferredRef.current) {
          env.traceDictationEvent("dictation_canonical_checkpoint_failed").catch(
            () => {},
          );
        }
        env.canonicalCheckpointDeferredRef.current = true;
        log.warn("Canonical cursor checkpoint deferred until stop:", error);
      }
    })().finally(() => {
      if (env.canonicalCheckpointInFlightRef.current === pump) {
        env.canonicalCheckpointInFlightRef.current = null;
      }
      if (env.phaseRef.current === "recording" && env.shouldRunLivePreview()) {
        scheduleLivePreview();
      }
    });
    env.canonicalCheckpointInFlightRef.current = pump;
  }

  return { clearLivePreviewTimer, scheduleLivePreview, pumpCanonicalCheckpoints };
}
