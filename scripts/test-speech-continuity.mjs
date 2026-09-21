#!/usr/bin/env node
import { validateSpeechFixtureWav } from "./speech-score.mjs";
import { scoreSpeechIntegrity } from "./speech-integrity.mjs";

// Fixed prospectively before evaluating the corrected merger. The old merger
// deleted 24/72 reference words (33.33%); never tune this threshold to a run.
export const CONTINUITY_MAX_WER = 0.15;
const REPETITIONS = 18;
const SAMPLE_RATE = 16_000;
const PAUSE_SAMPLES = SAMPLE_RATE / 4;
const CHUNK_SAMPLES = SAMPLE_RATE * 30;
const STRIDE_SAMPLES = SAMPLE_RATE * 29;

export function buildRepeatedSpeech(wav, seconds) {
  validateSpeechFixtureWav(wav, seconds);
  const unit = Buffer.concat([wav.subarray(44), Buffer.alloc(PAUSE_SAMPLES * 2)]);
  const body = Buffer.concat(Array(REPETITIONS).fill(unit));
  const repeated = Buffer.concat([wav.subarray(0, 44), body]);
  repeated.writeUInt32LE(repeated.length - 8, 4);
  repeated.writeUInt32LE(body.length, 40);
  return repeated;
}

export function checkCanonicalContinuity(previous, result) {
  if (!result || typeof result.canonicalText !== "string" || typeof result.appendText !== "string" || typeof result.chunkText !== "string") {
    throw new Error("Malformed canonical worker response");
  }
  if (!result.canonicalText.startsWith(previous) || result.canonicalText !== previous + result.appendText) {
    throw new Error("Canonical prefix was changed, removed, or replayed");
  }
  return result.canonicalText;
}

export function continuityWindows(samples) {
  if (!Number.isSafeInteger(samples) || samples <= 0) throw new Error("Positive sample count required");
  const windows = [];
  for (let start = 0; start < samples; start += STRIDE_SAMPLES) {
    const end = Math.min(start + CHUNK_SAMPLES, samples);
    windows.push({ startSample: start, endSample: end });
    if (end === samples) break;
  }
  return windows;
}

export function checkRepeatedContinuity(reference, hypothesis, phrase) {
  const integrity = scoreSpeechIntegrity(reference, hypothesis, {
    repetition: { phrase, count: REPETITIONS },
  });
  const werPassed = integrity.accuracy.wer <= CONTINUITY_MAX_WER;
  return { ...integrity, werPassed, passed: werPassed && integrity.integrityPassed };
}
