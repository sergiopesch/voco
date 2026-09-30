#!/usr/bin/env node
import { validateSpeechFixtureWav } from "./speech-score.mjs";
import { scoreSpeechIntegrity } from "./speech-integrity.mjs";

// Fixed before evaluation; never tune this threshold to a run.
export const CONTINUITY_MAX_WER = 0.15;
const REPETITIONS = 18;
const SAMPLE_RATE = 16_000;
const PAUSE_SAMPLES = SAMPLE_RATE / 4;

export function buildRepeatedSpeech(wav, seconds) {
  validateSpeechFixtureWav(wav, seconds);
  const unit = Buffer.concat([wav.subarray(44), Buffer.alloc(PAUSE_SAMPLES * 2)]);
  const body = Buffer.concat(Array(REPETITIONS).fill(unit));
  const repeated = Buffer.concat([wav.subarray(0, 44), body]);
  repeated.writeUInt32LE(repeated.length - 8, 4);
  repeated.writeUInt32LE(body.length, 40);
  return repeated;
}

export function checkRepeatedContinuity(reference, hypothesis, phrase) {
  const integrity = scoreSpeechIntegrity(reference, hypothesis, {
    repetition: { phrase, count: REPETITIONS },
  });
  const werPassed = integrity.accuracy.wer <= CONTINUITY_MAX_WER;
  return { ...integrity, werPassed, passed: werPassed && integrity.integrityPassed };
}
