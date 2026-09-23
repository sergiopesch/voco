import test from 'node:test';
import assert from 'node:assert/strict';
import {browserCaptureStopEvidence} from './browser-capture-lifecycle.mjs';
const row = (event, session = 4, t_ms = 0) => ({event, dictation_session_id: session, t_ms});
const stopped = [row('dictation_recording_stopped', 4, 19662), row('dictation_audio_teardown_completed', 4, 19723)];

test('navigation can stop capture and retain recovery without becoming idle', () => {
  assert.deepEqual(browserCaptureStopEvidence([...stopped, row('dictation_recovery_retained', 4, 19833)], 4),
    {sessionId: 4, terminal: 'dictation_recovery_retained', stopToTeardownMs: 61});
});
test('successful final delivery still establishes a stopped recording', () => {
  assert.equal(browserCaptureStopEvidence([...stopped, row('dictation_stop_to_idle')], 4).terminal, 'dictation_stop_to_idle');
});
test('another session or a partial teardown cannot prove this microphone stopped', () => {
  assert.equal(browserCaptureStopEvidence([...stopped, row('dictation_stop_to_idle', 3)], 4), null);
  assert.equal(browserCaptureStopEvidence([row('dictation_recording_stopped'), row('dictation_recovery_retained')], 4), null);
  assert.equal(browserCaptureStopEvidence([row('dictation_audio_teardown_completed'), row('dictation_stop_to_idle')], 4), null);
});
test('terminal observations must follow Stop and capture teardown', () => {
  assert.equal(browserCaptureStopEvidence([row('dictation_recovery_retained'), ...stopped], 4), null);
  assert.equal(browserCaptureStopEvidence([stopped[1], stopped[0], row('dictation_stop_to_idle')], 4), null);
  assert.equal(browserCaptureStopEvidence([...stopped, row('dictation_stop_to_idle')], undefined), null);
});
