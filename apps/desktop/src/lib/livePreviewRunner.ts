import {
  ANCHORED_LIVE_PREVIEW_MAX_SECONDS,
  LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS,
  LIVE_PREVIEW_MAX_SECONDS,
  LIVE_PREVIEW_MIN_INTERVAL_MS,
  LIVE_PREVIEW_MIN_SECONDS,
  TARGET_SAMPLE_RATE,
  nextLivePreviewDelay,
  withCursorAppendSeparator,
} from "@/lib/liveCommitPolicy";
import {
  collectAudioSamplesRange,
  collectRecentAudioSamples,
  clearAudioCaptureBuffer,
  type AudioCaptureBuffer,
} from "@/lib/audioCaptureBuffer";
import { removeDcOffsetInPlace } from "@/lib/audioLevel";
import {
  disableLiveCursorInsertion,
  disableLivePreview,
  isActivePreviewToken,
  recordPreviewDuration,
  type DictationPreviewToken,
  type DictationSessionState,
} from "@/lib/dictationSession";
import {
  previewGeometryWithinSnapshot,
  reviseOwnedPreedit,
  type PreviewAudioSnapshot,
} from "@/lib/livePreviewWindow";
import type { AppConfig, PreviewTranscription } from "@/types";
import { usesCanonicalCursorStreaming } from "@/lib/dictationOutputPlan";
import type { CursorDeliveryEvent } from "@/lib/dictationDelivery";

export type Ref<T> = { current: T };

export interface LivePreviewRunnerEnv {
  sessionRef: Ref<DictationSessionState>;
  phaseRef: Ref<string>;
  sessionConfigRef: Ref<AppConfig | null>;
  audioBufferRef: Ref<AudioCaptureBuffer>;
  captureDescriptorRef: Ref<unknown>;
  livePreviewInFlightRef: Ref<Promise<void> | null>;
  livePreviewCacheRef: Ref<{
    key: string;
    preview: PreviewTranscription;
    preparedSampleCount: number;
  } | null>;
  livePreviewTimeoutRef?: Ref<ReturnType<typeof setTimeout> | null>;
  livePreviewNextDelayMsRef: Ref<number | null>;
  livePreviewAudioStartSampleRef: Ref<number>;
  lastLivePreviewTextRef: Ref<string>;
  liveCursorCandidateTextRef: Ref<string>;
  liveDraftConfirmedTextRef: Ref<string>;
  liveCursorInsertionDisabledRef: Ref<boolean>;
  livePreviewFailureNotifiedRef: Ref<boolean>;
  liveCursorFallbackNotifiedRef?: Ref<boolean>;
  ownedPreeditActiveRef: Ref<boolean>;
  ownedPreeditCommittedTextRef: Ref<string>;
  debugCaptureEnabledRef: Ref<boolean>;
  debugPreviewFramesRef?: Ref<unknown[]>;
  ownedPreeditProgressiveRef?: Ref<boolean>;
  liveCursorTextRef?: Ref<string>;
  recordingSampleRate: () => number;
  shouldRunLivePreview: () => boolean;
  shouldUseFastLiveConfirmation: () => boolean;
  scheduleLivePreview: (delayMs?: number) => void;
  clearLivePreviewTimer: () => void;
  usesCanonicalCursorStreaming: typeof usesCanonicalCursorStreaming;
  resampleAudioBuffer: (
    samples: Float32Array,
    sourceRate: number,
    targetRate: number,
  ) => Promise<Float32Array>;
  previewTranscribeAudio: (samples: Float32Array) => Promise<PreviewTranscription | null>;
  setInterimTranscript: (text: string) => void;
  waitForOwnedPreeditStart: () => Promise<boolean>;
  publishOwnedPreedit: (
    confirmedText: string,
    preeditText: string,
    provisionalText: string,
    latestPreviewText: string,
  ) => Promise<boolean>;
  traceDictationEvent: (
    event: string,
    fields?: Record<string, number | undefined>,
  ) => Promise<void>;
  showNotification: (title: string, body: string) => Promise<void>;
  transitionCursorDelivery?: (event: CursorDeliveryEvent) => void;
  console?: Pick<Console, "warn">;
}

/**
 * Runs one live-preview decode against a frozen audio snapshot, then updates
 * owned-preedit cursor text. Stop/Cancel/canonical invalidation of the token
 * must not enqueue stale native work.
 */
export function createLivePreviewRunner(env: LivePreviewRunnerEnv) {
  const log = env.console ?? console;

  function stopLivePreview() {
    env.clearLivePreviewTimer();
    env.livePreviewCacheRef.current = null;
    env.lastLivePreviewTextRef.current = "";
    env.liveCursorCandidateTextRef.current = "";
    env.liveDraftConfirmedTextRef.current = "";
  }

  function clearCapturedAudio(): void {
    env.livePreviewCacheRef.current = null;
    clearAudioCaptureBuffer(env.audioBufferRef.current);
    env.captureDescriptorRef.current = null;
  }

  async function updateLiveCursorText(
    nextText: string,
    preview: PreviewTranscription,
    sampleRate: number,
    previewStartSample: number,
    previewEndSample: number,
    snapshot: PreviewAudioSnapshot,
  ) {
    const config = env.sessionConfigRef.current;
    if (
      !env.usesCanonicalCursorStreaming(config) ||
      env.sessionRef.current.liveCursorInsertionDisabled ||
      env.liveCursorInsertionDisabledRef.current
    ) {
      return;
    }

    const previousCandidate = env.liveCursorCandidateTextRef.current;
    env.liveCursorCandidateTextRef.current = nextText;

    const ownedPreeditActive = await env.waitForOwnedPreeditStart();
    if (env.phaseRef.current !== "recording") {
      return;
    }
    if (
      ownedPreeditActive &&
      env.ownedPreeditActiveRef.current
    ) {
      const revision = reviseOwnedPreedit(
        env.liveDraftConfirmedTextRef.current,
        previousCandidate,
        nextText,
        preview,
        previewGeometryWithinSnapshot(preview, snapshot),
      );
      env.liveDraftConfirmedTextRef.current = revision.confirmedText;
      env.liveCursorCandidateTextRef.current = revision.candidateText;
      if (revision.advanceDurationMs > 0) {
        env.livePreviewAudioStartSampleRef.current = Math.min(
          previewStartSample +
            Math.max(
              1,
              Math.round((revision.advanceDurationMs / 1000) * sampleRate),
            ),
          previewEndSample,
        );
        env.traceDictationEvent("dictation_live_preview_window_advanced", {
          chunkCount: revision.advancedSegmentCount,
          durationMs: revision.advanceDurationMs,
        }).catch(() => {});
      }

      const confirmedText = env.ownedPreeditCommittedTextRef.current;
      const preeditText = withCursorAppendSeparator(
        confirmedText,
        revision.provisionalText,
      );
      await env.publishOwnedPreedit(
        confirmedText,
        preeditText,
        confirmedText + preeditText,
        nextText,
      );
      return;
    }

    env.sessionRef.current = disableLiveCursorInsertion(env.sessionRef.current);
    env.liveCursorInsertionDisabledRef.current = true;
    env.transitionCursorDelivery?.("ownership-unavailable");
    env.setInterimTranscript(nextText);
    env.traceDictationEvent("dictation_live_cursor_overlay_fallback").catch(() => {});
    if (env.liveCursorFallbackNotifiedRef && !env.liveCursorFallbackNotifiedRef.current) {
      env.liveCursorFallbackNotifiedRef.current = true;
      env.showNotification(
        "Live cursor streaming unavailable",
        "VOCO cannot prove ownership of this target, so it will not type a later result into another field.",
      ).catch(() => {});
    }
  }

  async function runLivePreview(token: DictationPreviewToken): Promise<void> {
    if (
      !isActivePreviewToken(env.sessionRef.current, token) ||
      !env.shouldRunLivePreview()
    ) {
      return;
    }

    if (env.livePreviewInFlightRef.current) {
      env.scheduleLivePreview(
        env.shouldUseFastLiveConfirmation()
          ? LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS
          : LIVE_PREVIEW_MIN_INTERVAL_MS,
      );
      return;
    }

    const previewPromise: Promise<void> = (async () => {
      const sampleRate = env.recordingSampleRate();
      const usesAnchoredCursorWindow = env.usesCanonicalCursorStreaming(
        env.sessionConfigRef.current,
      );
      const previewStartSample = usesAnchoredCursorWindow
        ? Math.min(
            env.livePreviewAudioStartSampleRef.current,
            env.audioBufferRef.current.sampleCount,
          )
        : Math.max(
            0,
            env.audioBufferRef.current.sampleCount -
              Math.round(sampleRate * LIVE_PREVIEW_MAX_SECONDS),
          );
      const maximumSamples = Math.round(sampleRate * (usesAnchoredCursorWindow
        ? ANCHORED_LIVE_PREVIEW_MAX_SECONDS : LIVE_PREVIEW_MAX_SECONDS));
      const previewEndSample = Math.min(env.audioBufferRef.current.sampleCount, previewStartSample + maximumSamples);
      const sourceSampleCount = previewEndSample - previewStartSample;
      if (sourceSampleCount < sampleRate * LIVE_PREVIEW_MIN_SECONDS) {
        if (env.shouldUseFastLiveConfirmation()) {
          env.livePreviewNextDelayMsRef.current = LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS;
        }
        env.traceDictationEvent("dictation_live_preview_skipped_short_audio").catch(() => {});
        return;
      }

      const key = `${token.sessionId}:${token.generation}:${sampleRate}:${previewStartSample}:${previewEndSample}`;
      const cached = env.livePreviewCacheRef.current?.key === key ? env.livePreviewCacheRef.current : null;
      let preview: PreviewTranscription | null;
      let preparedSampleCount: number;
      if (cached) {
        preview = cached.preview;
        preparedSampleCount = cached.preparedSampleCount;
        // Replay normal confirmation/geometry checks, without another native
        // decode or a fabricated zero-duration recognition measurement.
        env.traceDictationEvent("dictation_live_preview_reused").catch(() => {});
      } else {
        const previewSamples = usesAnchoredCursorWindow
          ? collectAudioSamplesRange(env.audioBufferRef.current, previewStartSample, maximumSamples)
          : collectRecentAudioSamples(env.audioBufferRef.current, maximumSamples);
        let prepared = removeDcOffsetInPlace(previewSamples);
        if (Math.abs(sampleRate - TARGET_SAMPLE_RATE) > 1) {
          prepared = await env.resampleAudioBuffer(prepared, sampleRate, TARGET_SAMPLE_RATE);
        }
        if (!isActivePreviewToken(env.sessionRef.current, token)) return;
        preparedSampleCount = prepared.length;
        const startedAt = performance.now();
        preview = await env.previewTranscribeAudio(prepared);
        const durationMs = Math.round(performance.now() - startedAt);
        if (!isActivePreviewToken(env.sessionRef.current, token)) return;
        env.sessionRef.current = recordPreviewDuration(env.sessionRef.current, token, durationMs);
        env.livePreviewNextDelayMsRef.current = nextLivePreviewDelay(durationMs, env.shouldUseFastLiveConfirmation());
        env.traceDictationEvent("dictation_live_preview_completed", { durationMs }).catch(() => {});
        // Null also means busy/unavailable at the native boundary. It must be
        // retried, not cached as proof of silent audio.
        env.livePreviewCacheRef.current = preview?.text.trim()
          ? { key, preview, preparedSampleCount } : null;
      }

      const normalizedPreview = preview?.text.trim() ?? "";
      if (normalizedPreview.length === 0) {
        if (env.shouldUseFastLiveConfirmation()) {
          env.livePreviewNextDelayMsRef.current = LIVE_PREVIEW_CONFIRMATION_INTERVAL_MS;
        }
        env.traceDictationEvent("dictation_live_preview_empty").catch(() => {});
        return;
      }

      if (isActivePreviewToken(env.sessionRef.current, token) && preview) {
        const previewChanged = normalizedPreview !== env.lastLivePreviewTextRef.current;
        env.lastLivePreviewTextRef.current = normalizedPreview;
        if (previewChanged) {
          env.setInterimTranscript(normalizedPreview);
        }
        await updateLiveCursorText(
          normalizedPreview,
          preview,
          sampleRate,
          previewStartSample,
          previewEndSample,
          {
            preparedSampleCount,
            sourceSampleCount,
            sourceSampleRate: sampleRate,
          },
        );
        if (env.debugCaptureEnabledRef.current && env.debugPreviewFramesRef) {
          env.debugPreviewFramesRef.current.push({
            sequence: env.debugPreviewFramesRef.current.length + 1,
            sourceSampleRate: sampleRate,
            capturedSampleCount: env.audioBufferRef.current.sampleCount,
            previewStartSample,
            preview,
            stateAfter: {
              candidateText: env.liveCursorCandidateTextRef.current,
              committedWindowText: "",
              committedCursorText: env.ownedPreeditProgressiveRef?.current
                ? env.ownedPreeditCommittedTextRef.current
                : env.liveCursorTextRef?.current ?? "",
              nextPreviewStartSample: env.livePreviewAudioStartSampleRef.current,
              blockedCommitCount: 0,
              cursorInsertionDisabled:
                env.liveCursorInsertionDisabledRef.current ||
                env.sessionRef.current.liveCursorInsertionDisabled,
            },
          });
        }
        env.traceDictationEvent(
          previewChanged
            ? "dictation_live_preview_updated"
            : "dictation_live_preview_confirmed",
        ).catch(() => {});
      }
    })()
      .catch((error) => {
        log.warn("Live dictation preview failed:", error);
        if (isActivePreviewToken(env.sessionRef.current, token)) {
          env.sessionRef.current = disableLivePreview(env.sessionRef.current);
          env.liveCursorInsertionDisabledRef.current = true;
          env.traceDictationEvent("dictation_live_cursor_overlay_fallback").catch(() => {});
          if (!env.livePreviewFailureNotifiedRef.current) {
            env.livePreviewFailureNotifiedRef.current = true;
            env.setInterimTranscript(
              "Live preview paused. Final insertion will still run when you stop dictation.",
            );
            env.showNotification(
              "Live preview paused",
              "VOCO could not produce a live preview. Final insertion will still run when you stop dictation.",
            ).catch(() => {});
          }
        }
        env.traceDictationEvent("dictation_live_preview_failed").catch(() => {});
      })
      .finally(() => {
        if (env.livePreviewInFlightRef.current === previewPromise) {
          env.livePreviewInFlightRef.current = null;
        }
        if (
          isActivePreviewToken(env.sessionRef.current, token)
        ) {
          env.scheduleLivePreview();
        }
      });

    env.livePreviewInFlightRef.current = previewPromise;
    await previewPromise;
  }

  return { runLivePreview, updateLiveCursorText, stopLivePreview, clearCapturedAudio };
}
