// Production NVIDIA stream: serialize bounded audio IPC and append-only delivery.
// Capture/recovery belong to the hook; target checks and key dispatch remain native.
import { invoke } from "@tauri-apps/api/core";
import { type DesktopStreamEvent } from "./desktopPhraseStream";


export function appendOnlySuffix(committed: string, text: string): string {
  if (!text.startsWith(committed)) {
    throw new Error("Recognition revised an inserted prefix; transcript retained.");
  }
  return text.slice(committed.length);
}

// Request sequence is the hypothesis identity in the worker protocol. IDs are
// scoped by the random stream session and never contain transcript content.
export interface PasteCorrelation {
  session: string;
  dictationSessionId?: number;
  deliverySeq: number;
  hypothesisSeq: number;
}

export function textLengths(text: string, prefix: string): Record<string, number> {
  return {
    [`${prefix}_utf16_units`]: text.length,
    [`${prefix}_utf8_bytes`]: new TextEncoder().encode(text).length,
    [`${prefix}_unicode_scalars`]: Array.from(text).length,
  };
}

export class BenchmarkPhraseQueue {
  private pending: Promise<void> = Promise.resolve();
  private cancelled = false;
  private failure: unknown = null;
  private committed = "";
  private buffered: number[] = [];
  private rate = 16000;
  private captureRate: number | null = null;
  private queuedSeconds = 0;
  private session = crypto.randomUUID();
  private seq = 0;
  private ending = false;
  private latest = "";
  private delivery: Promise<void> = Promise.resolve();
  private delivering = false;
  private latestSeq = 0;
  private committedSeq = 0;
  private deliverySeq = 0;
  private completedDeliveries = 0;
  private hypothesisCount = 0;
  private committedHypothesisCount = 0;
  private latestAt = 0;
  private pendingSince: number | null = null;
  private terminalRecorded = false;
  private capturedSamples = 0;
  private enqueuedSamples = 0;
  private respondedSamples = 0;
  private captureCallbacks = 0;
  private maxQueueAgeMs = 0;
  private activeDeliverySeq: number | null = null;
  private failedDeliverySeq: number | null = null;
  private finishResponded = false;
  private qualityInFlight = 0;
  private qualitySeq = 0;
  private qualityDropped = 0;

  private quality(event: string, fields: Record<string, number | boolean | string | null> = {}) {
    // Bound IPC independently of the native recorder's bounded disk queue.
    const qualitySeq = this.qualitySeq++;
    if (this.qualityInFlight >= 32) { this.qualityDropped++; return; }
    this.qualityInFlight++;
    // Fire and forget: recorder failures cannot block or fail dictation.
    void invoke("benchmark_stream", { request: {
      op: "quality", event, session: this.session,
      dictation_session_id: this.dictationSessionId, quality_seq: qualitySeq,
      quality_dropped: this.qualityDropped, ...fields,
    } }).catch(() => { this.qualityDropped++; }).finally(() => { this.qualityInFlight--; });
  }

  private terminal() {
    if (this.terminalRecorded) return;
    this.terminalRecorded = true;
    this.quality("terminal", {
      outcome: this.failure ? "failed" : this.cancelled ? "cancelled" : this.finishResponded ? "finished" : "incomplete",
      hypothesis_count: this.hypothesisCount, delivery_count: this.deliverySeq,
      dispatched_count: this.completedDeliveries, hypothesis_seq: this.latestSeq,
      committed_hypothesis_seq: this.committedSeq,
      active_delivery_seq: this.activeDeliverySeq, failed_delivery_seq: this.failedDeliverySeq,
      pending_delivery_count: this.delivering ? 1 : 0,
      captured_samples: this.capturedSamples, enqueued_samples: this.enqueuedSamples,
      responded_samples: this.respondedSamples, buffered_samples: this.buffered.length,
      capture_callback_count: this.captureCallbacks, sample_rate: this.captureRate,
      max_queue_age_ms: this.maxQueueAgeMs, finish_responded: this.finishResponded,
      accepted_equals_dispatched: this.latest === this.committed,
      ...textLengths(this.latest, "accepted"), ...textLengths(this.committed, "dispatched"),
      destination_content_observation: "unavailable",
    });
  }

  constructor(
    private paste: (text: string, correlation: PasteCorrelation) => Promise<void>,
    private observed: (text: string) => void,
    private onFailure: () => void,
    private onPreview: (event: DesktopStreamEvent, durationMs?: number) => void,
    private dictationSessionId?: number,
  ) {
    this.schedule("start");
  }

  private fail(error: unknown, reason = "transport_failed") {
    if (this.failure) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.buffered = [];
    void invoke("benchmark_stream", {
      request: { op: "diagnostic", reason, session: this.session, dictation_session_id: this.dictationSessionId },
    }).catch(() => {});
    this.onFailure();
  }

  private schedule(op: string, audio?: number[]) {
    const rate = this.rate;
    const seq = this.seq++;
    const queuedAt = performance.now();
    const seconds = (audio?.length ?? 0) / rate;
    this.queuedSeconds += seconds;
    if (this.queuedSeconds > 3) {
      this.fail(new Error("Recognition fell over three seconds behind; audio retained for recovery."), "backlog_limit");
      return;
    }
    const sampleStart = this.enqueuedSamples;
    this.enqueuedSamples += audio?.length ?? 0;
    const sampleEnd = this.enqueuedSamples;
    this.pending = this.pending.then(async () => {
      let phase = "transport_failed";
      try {
        if (this.cancelled || this.failure) return;
        const queueAgeMs = performance.now() - queuedAt;
        this.maxQueueAgeMs = Math.max(this.maxQueueAgeMs, queueAgeMs);
        const response = await invoke<{ text: string | null; mode: string; session: string; seq: number }>("benchmark_stream", {
          request: { op, audio, rate, session: this.session, seq, dictation_session_id: this.dictationSessionId, queue_age_ms: queueAgeMs, sample_start: sampleStart, sample_end: sampleEnd },
        });
        if (this.cancelled) return;
        phase = "response_invalid";
        if (response.session !== this.session || response.seq !== seq || response.mode !== "append-only") {
          throw new Error("Unexpected recognizer response");
        }
        this.respondedSamples += audio?.length ?? 0;
        if (op === "finish") this.finishResponded = true;
        if (response.text === null) return;
        if (typeof response.text !== "string") throw new Error("Invalid recognizer text");
        const text = response.text;
        this.observed(text);
        const hypothesisRecorded = text !== this.latest || op === "finish";
        if (hypothesisRecorded) {
          this.quality("hypothesis", {
            hypothesis_seq: seq, previous_hypothesis_seq: this.latestSeq,
            source: op === "finish" ? "finish" : "push",
            append_only: text.startsWith(this.latest), changed: text !== this.latest,
            queue_age_ms: queueAgeMs, sample_start: sampleStart, sample_end: sampleEnd,
            ...textLengths(text, "recognized"), ...textLengths(this.latest, "previous"),
            ...textLengths(this.committed, "committed"),
          });
        }
        phase = "prefix_revision";
        appendOnlySuffix(this.latest, text);
        if (text !== this.latest) {
          this.hypothesisCount++;
          this.latestAt = performance.now();
          if (this.pendingSince === null) this.pendingSince = this.latestAt;
        }
        if (hypothesisRecorded) this.latestSeq = seq;
        this.latest = text;
        this.deliver();
      } catch (error) {
        if (phase === "prefix_revision") this.onPreview("revised");
        this.fail(error, phase);
      } finally {
        this.queuedSeconds -= seconds;
      }
    });
  }

  private deliver() {
    if (this.delivering || this.cancelled || this.failure) return;
    this.delivering = true;
    this.delivery = (async () => {
      try {
        while (!this.cancelled && !this.failure && this.latest !== this.committed) {
          const target = this.latest;
          const suffix = appendOnlySuffix(this.committed, target);
          const hypothesisSeq = this.latestSeq;
          const hypothesisCount = this.hypothesisCount;
          const deliverySeq = ++this.deliverySeq;
          const started = performance.now();
          this.activeDeliverySeq = deliverySeq;
          this.quality("delivery_requested", {
            delivery_seq: deliverySeq, hypothesis_seq: hypothesisSeq,
            committed_hypothesis_seq: this.committedSeq,
            coalesced_hypotheses: Math.max(0, hypothesisCount - this.committedHypothesisCount - 1),
            pending_age_ms: started - (this.pendingSince ?? started),
            latest_age_ms: started - this.latestAt,
            ...textLengths(this.committed, "committed"), ...textLengths(target, "target"),
            ...textLengths(suffix, "suffix"),
          });
          this.pendingSince = null;
          await this.paste(suffix, {
            session: this.session, dictationSessionId: this.dictationSessionId,
            deliverySeq, hypothesisSeq,
          });
          this.completedDeliveries++;
          this.committedSeq = hypothesisSeq;
          this.committedHypothesisCount = hypothesisCount;
          this.committed = target;
          this.quality("delivery_dispatched", {
            delivery_seq: deliverySeq, hypothesis_seq: hypothesisSeq,
            duration_ms: performance.now() - started,
            ...textLengths(this.committed, "committed"),
            destination_content_observation: "unavailable",
          });
          this.activeDeliverySeq = null;
          this.onPreview("appended");
        }
      } catch (error) {
        this.failedDeliverySeq = this.activeDeliverySeq;
        this.quality("delivery_failed", { delivery_seq: this.activeDeliverySeq,
          destination_content_observation: "unavailable" });
        this.activeDeliverySeq = null;
        this.fail(error, "insertion_failed");
      } finally {
        this.delivering = false;
      }
    })();
  }

  pushAudio(audio: Float32Array, rate: number) {
    if (this.cancelled || this.failure || this.ending) return;
    if (!Number.isInteger(rate) || rate < 8000 || rate > 384000 || !audio.every(Number.isFinite)) {
      this.fail(new Error("Invalid capture audio"), "capture_invalid");
      return;
    }
    if (!audio.length) return;
    // The first sub-frame callback already establishes sample geometry. Packet
    // sequence alone cannot detect a rate change while that frame is buffered.
    if (this.captureRate !== null && rate !== this.captureRate) {
      this.fail(new Error("Capture sample rate changed"), "capture_invalid");
      return;
    }
    this.captureCallbacks++;
    this.capturedSamples += audio.length;
    this.captureRate = rate;
    this.rate = rate;
    const count = Math.round(rate * 0.02);
    let offset = 0;
    // Fill only one packet at a time. Splicing a complete callback repeatedly
    // shifts its remaining samples and temporarily retains an unbounded buffer.
    while (offset < audio.length && !this.failure) {
      const end = Math.min(audio.length, offset + count - this.buffered.length);
      for (; offset < end; offset++) this.buffered.push(audio[offset]!);
      if (this.buffered.length === count) {
        const packet = this.buffered;
        this.buffered = [];
        this.schedule("push", packet);
      }
    }
  }

  enqueue() {
    if (this.ending || this.cancelled || this.failure) return;
    this.ending = true;
    if (this.buffered.length) {
      const packet = this.buffered;
      this.buffered = [];
      this.schedule("push", packet);
    }
    this.schedule("finish");
  }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.buffered = [];
    this.pending = this.pending.then(async () => {
      await invoke("benchmark_stream", { request: { op: "cancel", session: this.session, seq: this.seq++, dictation_session_id: this.dictationSessionId } }).catch(() => {});
      await this.delivery;
      this.terminal();
    });
  }

  async finish() {
    await this.pending;
    await this.delivery;
    this.terminal();
    if (this.failure) throw this.failure;
  }
}
