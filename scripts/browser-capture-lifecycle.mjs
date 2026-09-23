// A retained recovery is a terminal recording state even though the UI is not idle.
// Require the capture-release witness before either terminal outcome.
export function browserCaptureStopEvidence(events, sessionId) {
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) return null;
  const session = events.filter(event => event.dictation_session_id === sessionId);
  const stopIndex = session.findIndex(event => event.event === 'dictation_recording_stopped');
  const teardownIndex = session.findIndex((event, index) =>
    index > stopIndex && event.event === 'dictation_audio_teardown_completed');
  if (stopIndex < 0 || teardownIndex < 0) return null;
  const terminal = session.slice(teardownIndex + 1).find(event =>
    ['dictation_stop_to_idle', 'dictation_recovery_retained'].includes(event.event));
  if (!terminal) return null;
  const stop = session[stopIndex], teardown = session[teardownIndex];
  return {
    sessionId,
    terminal: terminal.event,
    stopToTeardownMs: Number.isFinite(stop.t_ms) && Number.isFinite(teardown.t_ms)
      ? teardown.t_ms - stop.t_ms : null,
  };
}
