import { type FinalCursorReconciliation, withCursorAppendSeparator } from "./liveCommitPolicy";

export type DesktopRecognitionRole = "preview" | "final";
export type DesktopStreamEvent = "recognized" | "appended" | "failed" | "coalesced" | "superseded"
  | "waiting_agreement" | "unchanged" | "revised" | "empty" | "preview_wait" | "final_wait";

function desktopWords(text: string): Array<{ word: string; end: number }> {
  return Array.from(text.matchAll(/\S+/gu), match => ({
    // Ignore presentation at word edges, but retain apostrophes, signs, decimal
    // points and hyphens inside words. Changed words must never be guessed away.
    word: match[0].replace(/^[“"([]+|[.,!?;:”)"\]]+$/gu, "").toLowerCase(),
    end: match.index + match[0].length,
  }));
}

/** Agreement is anchored to the phrase, independent of changing sentence punctuation. */
export function stableDesktopPrefix(previous: string, next: string): string {
  const left = desktopWords(previous.trim());
  const text = next.trim();
  const right = desktopWords(text);
  if (!left.length) return "";
  // A shorter revised tail can still corroborate complete leading words.
  let agreed = 0;
  while (agreed < left.length && agreed < right.length && left[agreed]?.word
    && left[agreed]?.word === right[agreed]?.word) agreed++;
  // A word still at the end of both hypotheses may be unfinished. A terminal
  // punctuation mark in both results is also an explicit word boundary.
  if (agreed === right.length && !(/[.!?,;:]$/.test(previous.trim()) && /[.!?,;:]$/.test(text))) agreed--;
  return agreed > 0 ? text.slice(0, right[agreed - 1]?.end ?? 0) : "";
}

/** Finds quiet phrase boundaries without splitting speech or rewriting prior output. */
export class DesktopPhraseSegmenter {
  private position = 0;
  private frameEnergy = 0;
  private frameSamples = 0;
  private lastSpeechEnd = 0;
  private speechFrames = 0;
  private boundary = 0;
  private readonly frameSize: number;

  constructor(private readonly sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("Invalid phrase sample rate");
    this.frameSize = Math.max(1, Math.round(sampleRate * 0.02));
  }

  append(samples: Float32Array): number[] {
    const boundaries: number[] = [];
    for (const sample of samples) {
      this.position++;
      this.frameSamples++;
      this.frameEnergy += sample * sample;
      if (this.frameSamples < this.frameSize) continue;
      const speech = Math.sqrt(this.frameEnergy / this.frameSamples) >= 0.006;
      this.frameSamples = 0;
      this.frameEnergy = 0;
      if (speech) {
        this.lastSpeechEnd = this.position;
        this.speechFrames++;
      } else if (this.speechFrames >= 15 && this.position - this.lastSpeechEnd >= this.sampleRate * 0.45
        && this.position - this.boundary >= this.sampleRate) {
        this.boundary = this.position;
        this.speechFrames = 0;
        boundaries.push(this.boundary);
      }
    }
    return boundaries;
  }
}

/** Bound speculative work independently of the capture callback size. */
export class DesktopPreviewCadence {
  private nextEnd: number;
  private startupEnd: number;
  private startupSettled = false;
  private start = 0;
  private limitReported = false;
  constructor(private readonly sampleRate: number) {
    this.nextEnd = Math.ceil(sampleRate * 0.8);
    this.startupEnd = Math.ceil(sampleRate);
  }
  reset(start: number): void {
    this.start = start;
    this.limitReported = false;
    this.startupSettled = false;
    this.nextEnd = start + Math.ceil(this.sampleRate * 0.8);
    this.startupEnd = start + Math.ceil(this.sampleRate);
  }
  settleStartup(): void {
    this.startupSettled = true;
    this.startupEnd = Infinity;
  }
  takeLimitNotice(end: number): boolean {
    if (this.limitReported || end - this.start <= this.sampleRate * 30) return false;
    this.limitReported = true;
    return true;
  }
  due(end: number): boolean {
    const elapsed = end - this.start;
    if (elapsed > this.sampleRate * 30) return false;
    const regular = end >= this.nextEnd;
    if (regular) this.nextEnd = end + Math.ceil(this.sampleRate * 0.5);
    // Advance the original clock even before audio is decodable. Extra startup
    // checks must not shift later windows or accumulate a catch-up backlog.
    if (elapsed < this.sampleRate) return false;
    if (regular) {
      this.startupEnd = !this.startupSettled && elapsed < this.sampleRate * 5
        ? end + Math.ceil(this.sampleRate * 0.25) : Infinity;
      return true;
    }
    if (elapsed < this.sampleRate * 5 && end >= this.startupEnd) {
      this.startupEnd = Infinity;
      return true;
    }
    return false;
  }
}

export function remainingDesktopText(committed: string, next: string): FinalCursorReconciliation {
  const text = next.trim();
  if (!committed) return { status: "safe", appendText: text };
  const left = desktopWords(committed);
  const right = desktopWords(text);
  if (left.length > right.length || left.some((token, i) => token.word !== right[i]?.word)) {
    return { status: "unsafe", appendText: "" };
  }
  if (text.startsWith(committed)) return { status: "safe", appendText: text.slice(committed.length) };
  const boundary = right[left.length - 1];
  if (!boundary) return { status: "unsafe", appendText: "" };
  let end = boundary.end;
  // Retain the punctuation already delivered; append new terminal punctuation
  // only if the committed phrase did not yet contain it.
  if (!/[.,!?;:”)"\]]$/.test(committed.trimEnd())) {
    end -= text.slice(0, end).match(/[.,!?;:”)"\]]+$/u)?.[0].length ?? 0;
  }
  return { status: "safe", appendText: text.slice(end) };
}

/** Serialize recognition and paste; one pending snapshot replaces obsolete work. */
export class DesktopPhraseQueue {
  private pending: Promise<void> = Promise.resolve();
  private failure: unknown = null;
  private cancelled = false;
  private parts: string[] = [];
  private committed = "";
  private previous = "";
  private previewPending: { audio: Float32Array; cancelled: boolean; queuedAt: number } | null = null;
  private previewActive: { cancelled: boolean } | null = null;

  constructor(private readonly recognize: (audio: Float32Array, role: DesktopRecognitionRole) => Promise<string>,
    private readonly paste: (text: string) => Promise<void>,
    private readonly observed: (text: string) => void,
    private readonly onFailure: () => void = () => {},
    private readonly onPreview: (event: DesktopStreamEvent, durationMs?: number) => void = () => {}) {}

  private get stopped(): boolean { return this.cancelled || this.failure !== null; }

  private schedule(work: () => Promise<void>): void {
    this.pending = this.pending.then(async () => {
      if (this.stopped) return;
      try { await work(); }
      catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error));
        this.onFailure();
      }
    });
  }

  private async append(text: string): Promise<boolean> {
    if (!text) return false;
    const prefix = this.parts.join(" ") + (this.parts.length && this.committed ? " " : "") + this.committed;
    const suffix = withCursorAppendSeparator(prefix, text);
    this.committed += withCursorAppendSeparator(this.committed, text);
    // Retain text before dispatch because a rejected promise may be uncertain.
    this.observed([...this.parts, this.committed].filter(Boolean).join(" "));
    await this.paste(suffix);
    return true;
  }

  preview(audio: Float32Array): void {
    if (this.stopped) return;
    if (this.previewPending) {
      this.previewPending.audio = audio;
      this.previewPending.queuedAt = performance.now();
      this.onPreview("coalesced");
      return;
    }
    const request = { audio, cancelled: false, queuedAt: performance.now() };
    this.previewPending = request;
    this.schedule(async () => {
      if (this.previewPending === request) this.previewPending = null;
      if (request.cancelled) return;
      this.previewActive = request;
      this.onPreview("preview_wait", Math.round(performance.now() - request.queuedAt));
      let text: string;
      try { text = (await this.recognize(request.audio, "preview")).trim(); }
      catch {
        // A speculative decode failure does not discard the final audio path.
        this.previous = "";
        this.onPreview("failed");
        return;
      }
      finally { this.previewActive = null; }
      if (this.stopped) return;
      this.onPreview("recognized");
      if (request.cancelled) return;
      if (!text || text === "(no speech detected)") { this.previous = ""; this.onPreview("empty"); return; }
      const stable = stableDesktopPrefix(this.previous, text);
      this.previous = text;
      if (!stable) { this.onPreview("waiting_agreement"); return; }
      const remaining = remainingDesktopText(this.committed, stable);
      // A changed hypothesis cannot edit already dispatched text. Wait for final
      // reconciliation rather than guess a new overlap or issue backspaces.
      if (remaining.status !== "safe") this.onPreview("revised");
      else if (await this.append(remaining.appendText)) this.onPreview("appended");
      else this.onPreview("unchanged");
    });
  }

  enqueue(audio: Float32Array): void {
    if (this.stopped) return;
    if (this.previewActive && !this.previewActive.cancelled) {
      this.previewActive.cancelled = true;
      this.onPreview("superseded");
    }
    if (this.previewPending) {
      this.previewPending.cancelled = true;
      this.previewPending = null;
      this.onPreview("superseded");
    }
    const queuedAt = performance.now();
    this.schedule(async () => {
      this.onPreview("final_wait", Math.round(performance.now() - queuedAt));
      let text = (await this.recognize(audio, "final")).trim();
      if (this.stopped) return;
      if (text === "(no speech detected)") text = "";
      // Keep the complete recognized result available if it revises an already
      // inserted prefix; a generic editor offers no safe replacement transaction.
      const remaining = remainingDesktopText(this.committed, text);
      if (remaining.status !== "safe") {
        this.observed([...this.parts, text].filter(Boolean).join(" "));
        throw new Error("Recognition revised text already inserted. Review the retained transcript.");
      }
      await this.append(remaining.appendText);
      if (this.committed) this.parts.push(this.committed);
      this.committed = "";
      this.previous = "";
    });
  }

  cancel(): void { this.cancelled = true; }
  async finish(): Promise<void> {
    await this.pending;
    if (this.failure) throw this.failure;
  }
}
