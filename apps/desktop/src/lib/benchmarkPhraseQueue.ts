// Pinned append-only recognizer; capture, focus guards and recovery remain native.
import { invoke } from "@tauri-apps/api/core";
import { type DesktopStreamEvent, type DesktopRecognitionRole } from "./desktopPhraseStream";

void invoke("benchmark_stream", { request: { op: "warmup" } }).catch(() => {});

export function appendOnlySuffix(committed: string, text: string): string {
  if (!text.startsWith(committed)) {
    throw new Error("Recognition revised an inserted prefix; transcript retained.");
  }
  return text.slice(committed.length);
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

  constructor(
    _recognize: (audio: Float32Array, role: DesktopRecognitionRole) => Promise<string>,
    private paste: (text: string) => Promise<void>,
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
    this.pending = this.pending.then(async () => {
      let phase = "transport_failed";
      try {
        if (this.cancelled || this.failure) return;
        const response = await invoke<{ text: string | null; mode: string; session: string; seq: number }>("benchmark_stream", {
          request: { op, audio, rate, session: this.session, seq, dictation_session_id: this.dictationSessionId, queue_age_ms: performance.now() - queuedAt },
        });
        if (this.cancelled) return;
        phase = "response_invalid";
        if (response.session !== this.session || response.seq !== seq || response.mode !== "append-only") {
          throw new Error("Unexpected recognizer response");
        }
        if (response.text === null) return;
        if (typeof response.text !== "string") throw new Error("Invalid recognizer text");
        const text = response.text;
        this.observed(text);
        phase = "prefix_revision";
        appendOnlySuffix(this.latest, text);
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
          await this.paste(suffix);
          this.committed = target;
          this.onPreview("appended");
        }
      } catch (error) {
        this.fail(error, "insertion_failed");
      } finally {
        this.delivering = false;
      }
    })();
  }

  pushAudio(audio: Float32Array, rate: number) {
    if (this.cancelled || this.failure || this.ending) return;
    if (!Number.isInteger(rate) || rate < 8000 || rate > 96000 || !audio.every(Number.isFinite)) {
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

  enqueue(_audio: Float32Array) {
    if (this.ending || this.cancelled || this.failure) return;
    this.ending = true;
    if (this.buffered.length) {
      const packet = this.buffered;
      this.buffered = [];
      this.schedule("push", packet);
    }
    this.schedule("finish");
  }

  preview(_audio: Float32Array) {}

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.buffered = [];
    this.pending = this.pending.then(async () => {
      await invoke("benchmark_stream", { request: { op: "cancel", session: this.session, seq: this.seq++ } }).catch(() => {});
    });
  }

  async finish() {
    await this.pending;
    await this.delivery;
    if (this.failure) throw this.failure;
  }
}
