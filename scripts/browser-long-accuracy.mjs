import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {validateSpeechManifest, validateSpeechFixtureWav} from './speech-score.mjs';
import {CONTINUITY_MAX_WER} from './test-speech-continuity.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// Called before recording: bind the complete reference to the exact playback PCM.
export function freezeLongPlayback(manifestBytes, playbackBytes, wav, fixtureWavs) {
  const manifest = validateSpeechManifest(JSON.parse(manifestBytes));
  const playback = JSON.parse(playbackBytes);
  assert.equal(playback.selectedBeforeInference, true);
  assert.ok(['natural', 'repeated'].includes(playback.mode));
  const selected = [];
  let samples = 0;
  for (const row of playback.mode === 'repeated' ? Array(16).fill(manifest.fixtures[0]) : manifest.fixtures) {
    selected.push(row);
    samples += Math.round(row.seconds * 16000) + 4000;
    if (playback.mode === 'natural' && samples >= 37 * 16000) break;
  }
  assert.ok(samples >= 37 * 16000, 'Full long playback must span at least 37 seconds');
  assert.deepEqual(playback.fixtures, selected.map(({id, sha256, reference}) => ({id, sha256, reference})), 'Playback must retain the full prospective fixture selection and references');
  assert.equal(validateSpeechFixtureWav(wav, playback.durationSeconds), samples);
  assert.equal(hash(wav), playback.wavSha256);
  const parts = selected.flatMap(row => {
    const source = fixtureWavs[row.id];
    assert.equal(hash(source), row.sha256, `Fixture hash: ${row.id}`);
    validateSpeechFixtureWav(source, row.seconds);
    return [source.subarray(44), Buffer.alloc(8000)];
  });
  assert.ok(wav.subarray(44).equals(Buffer.concat(parts)), 'Playback PCM must match every complete selected fixture and pause');
  return {mode: playback.mode, integrityRequirements: playback.mode === 'repeated' ? {repetition: {phrase: selected[0].reference, count: selected.length}} : null, sourceManifestSha256: hash(manifestBytes), playbackManifestSha256: hash(playbackBytes), wavSha256: hash(wav), selectedBeforeInference: true, reference: selected.map(row => row.reference).join(' '), maxWer: playback.mode === 'repeated' ? CONTINUITY_MAX_WER : manifest.maxAggregateWer, samples};
}
