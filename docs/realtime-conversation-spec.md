# Realtime Conversation Specification

This document defines the expected behavior for VOCO realtime voice conversation mode.
It is the implementation and QA reference for making `Alt+R` work on the first try,
keeping the session conversational, and proving that the animated VOCO mic reflects
both user speech and assistant speech.

## Scope

Realtime conversation is separate from normal dictation.

- Normal dictation uses `Alt+D`.
- Realtime conversation uses `Alt+R`.
- Normal dictation records locally, transcribes locally, and inserts or forwards text.
- Realtime conversation streams microphone audio to OpenAI Realtime over WebSocket and
  plays assistant audio locally.

The critical product promise is:

> Press `Alt+R`, speak naturally, hear a concise response, interrupt if needed, and press
> `Alt+R` again to stop. The VOCO mic visual must move with the user's voice and with the
> assistant's spoken response.

## User-Facing Requirements

### First Toggle

`Alt+R` must work on the first press after app launch.

Acceptance criteria:

- If the frontend handler is not ready yet, the backend buffers one pending realtime toggle.
- When the frontend becomes ready, the pending realtime toggle is replayed exactly once.
- Duplicate keyboard backend events within the debounce window do not start and immediately stop realtime.
- Realtime does not reuse the dictation toggle path.
- `Alt+D` remains normal dictation.
- `Alt+R` is reserved and cannot be configured as the dictation hotkey.

Expected trace sequence on a successful first start:

```text
realtime_hotkey_event_received_evdev OR realtime_hotkey_event_received_global_shortcut
eval_realtime_toggle_entered
realtime_toggle_event_emitted
frontend_realtime_toggle_received
realtime_start_requested
realtime_client_secret_created
realtime_websocket_connecting
realtime_websocket_open
realtime_get_user_media_started
realtime_get_user_media_done
realtime_microphone_track_started
realtime_microphone_track_settings
realtime_audio_graph_connected
```

If the key is pressed before the frontend is ready, this sequence must include:

```text
realtime_toggle_event_buffered
pending_realtime_toggle_replayed
```

### Stop Toggle

Pressing `Alt+R` while realtime is connecting, listening, thinking, or speaking must stop
the session.

Acceptance criteria:

- The WebSocket is closed.
- Microphone tracks are stopped.
- Audio processor/source/silent sink nodes are disconnected.
- Assistant playback sources are stopped.
- The visual level resets to zero.
- The app returns to idle realtime status.
- The hidden overlay disappears.

Expected trace sequence:

```text
realtime_hotkey_event_received_evdev OR realtime_hotkey_event_received_global_shortcut
eval_realtime_toggle_entered
realtime_toggle_event_emitted
frontend_realtime_toggle_received
realtime_stop_requested
```

### Conversation

The user should be able to speak naturally after realtime is live.

Acceptance criteria:

- Microphone samples are streamed as PCM16, 24 kHz, base64 payloads using
  `input_audio_buffer.append`.
- The backend-created Realtime session uses short, concise instructions.
- Server VAD detects the user's speech without requiring a second key press.
- When the user stops speaking, the session produces a response automatically.
- Assistant audio is played from `response.output_audio.delta`.
- User interruption cancels queued or active assistant playback and sends `response.cancel`
  when a response is active.
- The app stays in realtime until the user presses `Alt+R` again or an unrecoverable error occurs.

### No Waffle

The assistant should be concise by default.

Acceptance criteria:

- Realtime session instructions require short answers.
- The response style is 1-2 short sentences unless the user asks for detail.
- The assistant should respond to the latest user interruption, not continue the old answer.

## Realtime State Machine

The frontend realtime hook owns these user-visible states:

| State | Meaning | Allowed Next States |
|-------|---------|---------------------|
| `idle` | Realtime is off | `connecting` |
| `connecting` | Token, WebSocket, and mic are being prepared | `listening`, `error`, `idle` |
| `listening` | WebSocket and mic graph are live; waiting for speech or response | `speaking`, `error`, `idle` |
| `speaking` | Assistant audio is being received or played | `listening`, `error`, `idle` |
| `error` | Realtime failed and is stopped or must be stopped | `connecting`, `idle` |

Recommended future refinement:

| State | Why |
|-------|-----|
| `hearing-user` | Distinguishes live user speech from passive listening |
| `thinking` | Distinguishes speech detected/turn ended from assistant playback |

These extra states are not required for the current implementation, but they make the
“stuck on listening” class of failures easier to identify.

## “Stuck On Listening” Definition

A realtime session is stuck on listening when all of the following are true:

- `realtime_websocket_open` occurred.
- `realtime_audio_graph_connected` occurred.
- The UI remains `listening`.
- The user speaks audibly for at least 2 seconds.
- No assistant response starts within 8 seconds after speech ends.

This is not considered stuck if the mic is silent, muted, denied, or the selected input device
is wrong.

## “Stuck On Listening” Required Diagnostics

To debug this class reliably, VOCO must emit non-content trace events.
These events must never include transcripts, microphone samples, response text, or API keys.

Required trace events:

```text
realtime_input_audio_chunk_sent
realtime_input_audio_level_detected
realtime_local_speech_started
realtime_local_speech_stopped
realtime_server_speech_started
realtime_server_speech_stopped
realtime_input_audio_commit_fallback_sent
realtime_server_input_committed
realtime_response_create_fallback_sent
realtime_server_response_created
realtime_output_audio_delta
realtime_server_response_done
realtime_output_audio_level_detected
realtime_no_speech_timeout
realtime_no_response_timeout
realtime_response_cancel_ignored_error
```

Recommended fields:

| Field | Purpose | Privacy Rule |
|-------|---------|--------------|
| `t_ms` | Time correlation | Allowed |
| `backend_used` | Hotkey source | Allowed |
| `session_type` | Wayland/X11 | Allowed |
| `audio_level_bucket` | `silent`, `low`, `medium`, `high` | Allowed |
| `chunk_count` | Confirms streaming | Allowed |
| `response_delta_count` | Confirms playback | Allowed |
| `selected_device_configured` | Confirms whether a saved mic device was requested | Allowed |
| `track_sample_rate` | Browser-reported microphone track sample rate | Allowed |
| `track_channel_count` | Browser-reported microphone channel count | Allowed |
| `echo_cancellation` | Browser-reported capture processing flag | Allowed |
| `noise_suppression` | Browser-reported capture processing flag | Allowed |
| `auto_gain_control` | Browser-reported capture processing flag | Allowed |

Forbidden fields:

- Raw audio samples
- Base64 audio payloads
- Transcript text
- Assistant response text
- API keys
- Realtime client secret

## Audio Requirements

### Input Capture

Input audio must satisfy:

- Source: selected VOCO input device or system default if none is selected
- Capture API: WebView `getUserMedia`
- Processing node: `ScriptProcessorNode` in the current implementation
- Input channel: mono channel 0
- Resample target: 24 kHz
- Transport format: PCM16 little-endian
- WebSocket event type: `input_audio_buffer.append`

Failure behavior:

- If `getUserMedia` fails, show realtime error and stop.
- If WebSocket opens but mic graph fails, close WebSocket and show error.
- If mic samples are consistently silent, keep listening but expose enough diagnostics to identify silence.

### Output Playback

Output audio must satisfy:

- Source event: `response.output_audio.delta`
- Payload: PCM16 base64
- Playback sample rate: 24 kHz
- Playback API: Web Audio `AudioBufferSourceNode`
- Multiple deltas are queued using `nextOutputTimeRef`.

Failure behavior:

- If audio context is suspended, resume it before playback.
- If the user starts speaking while assistant playback is active, stop queued playback.
- If the server reports an error, show realtime error and stop or allow restart.

## Animation Requirements

The VOCO realtime mic visual must not be a decorative timer. It must be driven by live audio.

### User Speech

When microphone samples arrive:

- Calculate the visual level from the input sample buffer.
- Smooth the level to avoid jitter.
- Drive the mic scale, ring scale, glow, and wave bars from the normalized level.
- Decay to zero when chunks stop or become silent.

### Assistant Speech

When assistant audio deltas arrive:

- Decode PCM16 audio.
- Calculate the visual level from the decoded samples.
- Drive the same mic visual from the assistant level.
- Continue to decay naturally between output chunks.

### Required Visual Behavior

Acceptance criteria:

- While realtime is inactive, the mic visual is calm.
- While realtime is listening and the room is quiet, the visual is nearly still.
- While the user speaks, the mic image, rings, glow, and wave bars move.
- While the assistant speaks, the same visual moves.
- Motion is smooth and never resizes surrounding layout.
- Reduced-motion users do not get unnecessary animation transitions.

## Overlay Requirements

When realtime is started from `Alt+R`, VOCO usually hides the main panel. The hidden overlay
must therefore show realtime status.

Acceptance criteria:

- Starting realtime from a visible surface hides the surface and shows the realtime overlay.
- The overlay is always-on-top and non-interactive, matching dictation overlay behavior.
- The overlay contains the VOCO mic visual.
- The overlay indicates `Connecting`, `Listening`, or `Speaking`.
- Stopping realtime hides the overlay.
- Dictation overlay takes priority if dictation is actively recording or processing.

## Backend Requirements

### API Key Handling

The standard OpenAI API key must stay in the Rust/Tauri backend.

Allowed sources:

```text
OPENAI_API_KEY
~/.openclaw/realtime.env
```

Requirements:

- The frontend never receives the standard API key.
- The backend mints a short-lived Realtime client secret.
- The frontend receives only the short-lived client secret.
- Logs and traces never include either key.

### Realtime Session

The backend creates the Realtime session with:

- Model: current configured realtime model
- Concise instructions
- Server VAD
- Output voice
- Low reasoning effort where supported

Required hardening for stuck-listening issues:

- The server VAD config should explicitly request automatic response creation if the API supports it.
- If server VAD detects and commits a turn but automatic response creation is disabled or unavailable, the frontend must request a response after the commit.
- If local microphone levels show a sustained speech start and stop but server VAD never commits the turn, the frontend must commit the input buffer and request a response as a fallback.
- The implementation must not depend on undocumented default VAD behavior.

## WebSocket Requirements

The frontend opens:

```text
wss://api.openai.com/v1/realtime?model=<model>
```

Required subprotocols:

```text
realtime
openai-insecure-api-key.<short-lived-client-secret>
```

Required CSP:

```text
connect-src 'self' https://api.github.com https://api.openai.com wss://api.openai.com
```

Connection acceptance criteria:

- `realtime_websocket_connecting` is traced before opening.
- `realtime_websocket_open` is traced after open.
- No mic capture starts before the WebSocket is open.
- Mic graph connection is traced after successful capture.
- WebSocket close while active produces an error status unless the user requested stop.

## Interruption Requirements

Realtime must support interruption.

Acceptance criteria:

- If server reports user speech started while assistant response is active, stop local playback.
- If a response is active, send `response.cancel`.
- A cancellation race where the server has already ended the response must not tear down realtime.
- The UI returns to listening or hearing-user state.
- The next assistant response addresses the latest user speech.

## Error Handling Requirements

User-facing errors must be short and actionable.

| Failure | Expected Behavior |
|---------|-------------------|
| Missing API key | Tell user where to place `OPENAI_API_KEY` |
| Client secret request failed | Show Realtime startup error with server detail |
| WebSocket error | Show socket failure and allow retry |
| Mic denied | Show microphone failure and allow settings check |
| Mic graph failure | Close WebSocket and show mic failure |
| Server error | Show Realtime error and allow retry |
| No speech detected | Stay listening, but diagnostics must show silent input |
| Speech detected but no response | Show a timeout hint and keep session recoverable |

## Test Plan

### Unit Tests

Required:

- Realtime mic visual clamps level values.
- Realtime mic visual writes level-driven CSS variables.
- Dictation hotkey validation rejects `Alt+R`.
- Realtime client secret parsing rejects missing `value`.
- Realtime API key loading supports env and `~/.openclaw/realtime.env`.
- PCM16 encode/decode helpers preserve sample shape within expected precision.
- Resampler returns expected sample count.

### Integration Tests

Required:

- `Alt+R` event from backend emits `voco:toggle-realtime`.
- Early realtime toggle buffers until frontend handler ready.
- Duplicate realtime toggle inside debounce window is ignored.
- Realtime start creates client secret, opens WebSocket, then connects mic graph.
- Local speech-stop without server VAD commit sends `input_audio_buffer.commit` and then `response.create`.
- Realtime stop closes socket, stops tracks, disconnects graph, and resets visual level.

### Linux Runtime Smoke Test

On Wayland, the preferred automated test is a temporary uinput keyboard that emits real evdev
events. The expected trace must include:

```bash
./scripts/realtime-runtime-smoke.sh
```

```text
evdev_device_worker_started
realtime_hotkey_event_received_evdev
eval_realtime_toggle_entered
realtime_toggle_event_emitted
frontend_realtime_toggle_received
realtime_start_requested
realtime_client_secret_created
realtime_websocket_open
realtime_get_user_media_done
realtime_microphone_track_started
realtime_microphone_track_settings
realtime_audio_graph_connected
realtime_stop_requested
```

The runtime smoke launches VOCO with an isolated temporary config and selects a temporary
Pulse/PipeWire remapped monitor source by label. The default mode accepts either assistant
output or `realtime_no_speech_timeout` after startup so it can still diagnose machines where
virtual capture devices are unavailable. When assistant output is required, the smoke also
captures VOCO's default output sink and requires non-silent rendered audio. The release gate
is the stricter response mode:

```bash
./scripts/realtime-runtime-smoke.sh --require-response
```

For desktop interruption proof, run:

```bash
./scripts/realtime-runtime-smoke.sh --interrupt
```

Interrupt mode injects a longer first utterance, waits for assistant output audio, injects a
second utterance while the assistant is responding, and requires:

```text
realtime_response_cancel_sent
at least two realtime_server_response_created events
at least two realtime_server_response_done events
```

### Realtime Protocol Smoke Test

When `OPENAI_API_KEY` is configured locally, run:

```bash
npm run smoke:realtime
npm run smoke:realtime -- --interrupt
```

This test records a short local text-to-speech sample into a temporary Pulse/PipeWire null
sink, streams the generated PCM16 audio to OpenAI Realtime with the same session config as
VOCO, and reports only non-content event counts. It must never print the API key, transcript,
assistant text, raw audio, or base64 audio payload.

The interrupt mode cancels the first assistant response after output audio starts, streams a
second generated utterance into the same session, and requires a second audible assistant
response. This is the protocol-level acceptance test for realtime interruption before live
desktop microphone testing.

Acceptance criteria:

- The summary has `"ok": true`.
- `responseCreated` is greater than zero.
- `outputAudioDelta` is greater than zero.
- `outputBytes` is greater than zero.
- `outputRms` is greater than `0.0005`.
- `responseDone` is greater than zero.
- Either server VAD commits the input or the fallback commit path is used.
- In interrupt mode, `cancelSent`, `secondResponseCreated`, `secondOutputAudioDelta`, and
  `secondResponseDone` are all greater than zero.

Manual fallback:

1. Start VOCO from the installed binary.
2. Press `Alt+R`.
3. Confirm realtime overlay appears.
4. Speak: “give me a short test reply”.
5. Confirm the VOCO mic visual moves while speaking.
6. Confirm assistant speaks back.
7. Confirm the VOCO mic visual moves during assistant playback.
8. Interrupt the assistant with a new sentence.
9. Confirm the assistant stops the old answer and follows the new sentence.
10. Press `Alt+R`.
11. Confirm realtime stops and overlay disappears.

### Required Validation Commands

Run before release:

```bash
npm run check
npm test -- --run
npm run lint -w apps/desktop
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run build
```

## Release Checklist

Before considering realtime conversation complete:

- [ ] Local git status is clean.
- [ ] GitHub default branch contains the final commit.
- [ ] Installed binary was rebuilt from the final commit.
- [ ] `Alt+R` first press starts realtime from a fresh app launch.
- [ ] Realtime startup trace reaches `realtime_audio_graph_connected`.
- [ ] Speaking into the mic produces visible mic animation; automated runtime trace includes the input-level event that drives it.
- [ ] Speaking into the mic produces server speech-start/speech-stop evidence.
- [ ] Assistant response produces `response.output_audio.delta`.
- [ ] Assistant response is audible.
- [ ] Assistant playback drives the same mic animation; automated runtime trace includes the output-level event that drives it.
- [ ] User interruption cancels active assistant playback.
- [ ] Second `Alt+R` stops realtime cleanly.
- [ ] Missing API key path shows actionable error.
- [ ] Wrong mic or silent mic can be diagnosed from non-content trace events.

## Current Known Risk

If VOCO starts realtime and remains on `Listening`, the highest-probability causes are:

- Microphone capture is connected but the selected input is silent or wrong.
- Audio chunks are being sent but server VAD is not detecting speech.
- Server VAD detects speech but automatic response creation is not behaving as expected.
- The server is responding with events the frontend is not tracing yet.
- Assistant response is created but output audio deltas are not arriving or not decoded.

Implemented hardening now covers the main stuck-listening branches:

- session creation explicitly requests audio output, PCM 24 kHz input/output, server VAD, automatic responses, and interruption.
- frontend tracing records audio chunk flow, local speech detection, server VAD events, server commits, response creation, audio deltas, output level, and timeout hints.
- after server commit, the frontend sends a delayed `response.create` fallback if no response starts.
- after local sustained speech stops with no server commit, the frontend sends `input_audio_buffer.commit` and then the same delayed `response.create` fallback.

Automated runtime proof should include:

```text
realtime_server_speech_started OR realtime_local_speech_started
realtime_server_speech_stopped OR realtime_local_speech_stopped
realtime_server_input_committed OR realtime_input_audio_commit_fallback_sent
realtime_server_response_created
realtime_output_audio_delta
realtime_server_response_done
realtime_response_cancel_sent in interrupt mode
```
