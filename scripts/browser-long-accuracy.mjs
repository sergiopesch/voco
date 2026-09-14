import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {scoreTranscript, validateSpeechManifest, validateSpeechFixtureWav} from './speech-score.mjs';
import {CONTINUITY_MAX_WER, checkCanonicalContinuity} from './test-speech-continuity.mjs';
import {scoreSpeechIntegrity} from './speech-integrity.mjs';

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

// Return failed scores as evidence rather than throwing before they can be saved.
export function scoreLongCapture(capture, plan, targetPrefix, targetAfterFocusLoss) {
  const failures = [];
  const require = (condition, message) => { if (!condition) failures.push(message); };
  require(capture.schemaVersion === 2, 'Debug capture schemaVersion must be 2');
  require(Array.isArray(capture.canonicalChunks) && capture.canonicalChunks.length >= 2, 'At least two canonical chunks are required');
  let previous = '';
  for (const chunk of Array.isArray(capture.canonicalChunks) ? capture.canonicalChunks : []) {
    try { previous = checkCanonicalContinuity(previous, chunk.result); }
    catch (error) { failures.push(error.message); }
  }
  const canonicalText = capture.canonicalChunks?.at(-1)?.result?.canonicalText;
  const finalTranscript = capture.finalTranscript;
  require(typeof targetPrefix === 'string' && targetPrefix.length > 0, 'Committed target prefix must be nonempty');
  require(targetAfterFocusLoss === targetPrefix, 'Original target changed after focus loss');
  require(capture.committedCursorText === targetPrefix, 'Debug committed cursor text must match the original target prefix');
  require(typeof canonicalText === 'string' && canonicalText.startsWith(targetPrefix), 'Final canonical text must preserve the committed prefix');
  const outputs = {};
  for (const [name, text] of Object.entries({canonicalText, finalTranscript})) {
    const score = typeof text === 'string' ? scoreTranscript(plan.reference, text) : null;
    const werPassed = score !== null && score.hypothesisWords > 0 && Number.isFinite(score.wer) && score.wer <= plan.maxWer;
    require(werPassed, `${name} must be nonempty and satisfy full-reference WER <= ${plan.maxWer}`);
    let integrity = null;
    if (plan.mode === 'repeated') {
      try { integrity = scoreSpeechIntegrity(plan.reference, text, plan.integrityRequirements); }
      catch (error) { failures.push(`${name}: ${error.message}`); }
      require(integrity?.integrityPassed === true, `${name} must preserve the exact frozen repetition sequence and count`);
    }
    outputs[name] = {text, score, werPassed, integrity, integrityPassed: plan.mode === 'repeated' ? integrity?.integrityPassed === true : null};
  }
  return {passed: failures.length === 0,
    werPassed: Object.values(outputs).every(output => output.werPassed),
    integrityPassed: plan.mode === 'repeated' ? Object.values(outputs).every(output => output.integrityPassed) : null,
    failures, plan, targetPrefix, targetAfterFocusLoss, outputs};
}
