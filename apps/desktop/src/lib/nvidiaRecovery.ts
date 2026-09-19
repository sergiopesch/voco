import { invoke } from "@tauri-apps/api/core";
import { captureSampleLimit } from "./dictationRecovery";

interface RecoveryResponse {
  session: string;
  seq: number;
  mode: "append-only";
  text: string | null;
}

/** One explicit recognition attempt. It has no destination or delivery callback.
 * The native recovery worker is separate from the live stream. Only a complete
 * finish response is published; cancellation drains its own request and worker. */
export class NvidiaRecovery {
  private readonly session = crypto.randomUUID();
  private seq = 0;
  private cancelled = false;
  private operation: Promise<string> | null = null;

  cancel() { this.cancelled = true; }

  settled(): Promise<void> {
    return this.operation?.then(() => {}, () => {}) ?? Promise.resolve();
  }

  transcribe(audio: Float32Array, rate: number): Promise<string> {
    if (this.operation) throw new Error("Recovery attempt already started.");
    this.operation = this.run(audio, rate);
    return this.operation;
  }

  private assertActive() {
    if (this.cancelled) throw new Error("Recovery cancelled; audio remains available.");
  }

  private async request(op: "start" | "push" | "finish", audio?: Float32Array, rate?: number) {
    this.assertActive();
    const seq = this.seq++;
    const response = await invoke<RecoveryResponse>("recover_stream", {
      request: { op, session: this.session, seq,
        ...(audio ? { audio: Array.from(audio), rate } : {}) },
    });
    this.assertActive();
    if (!response || response.session !== this.session || response.seq !== seq ||
        response.mode !== "append-only" ||
        (response.text !== null && typeof response.text !== "string")) {
      throw new Error("Invalid recovery response; audio remains available.");
    }
    return response.text;
  }

  private async run(audio: Float32Array, rate: number): Promise<string> {
    if (!Number.isInteger(rate) || rate < 8000 || rate > 96000 ||
        !audio.length || audio.length > captureSampleLimit(rate) || !audio.every(Number.isFinite)) {
      throw new Error("Invalid recovery audio.");
    }
    let started = false;
    try {
      this.assertActive();
      // A rejected Start can still have created a worker, so always clean up.
      started = true;
      await this.request("start");
      const packetSize = Math.round(rate * 0.1);
      for (let offset = 0; offset < audio.length; offset += packetSize) {
        await this.request("push", audio.subarray(offset, offset + packetSize), rate);
      }
      const text = await this.request("finish");
      if (text === null) throw new Error("Recovery finished without a transcript.");
      return text;
    } finally {
      if (started) {
        await invoke("recover_stream", {
          request: { op: "cancel", session: this.session, seq: this.seq++ },
        }).catch(() => {});
      }
    }
  }
}
