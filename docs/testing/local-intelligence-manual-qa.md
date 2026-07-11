# Local Intelligence Manual QA

Use this checklist to validate transcript enhancement and local assistant mode with a real
OpenAI-compatible localhost model server.

## Preflight

1. Start from a clean working app build:

```bash
npm run check
npm test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

2. Start a localhost model server. Example shape:

```bash
llama-server --host 127.0.0.1 --port 8080 --model /path/to/model.gguf
```

3. Open VOCO Settings -> Output and set:

- Local model endpoint: `http://127.0.0.1:8080/v1/chat/completions`
- Local model name: blank unless the server requires a specific model id

## Test Matrix

| ID | Scenario | Steps | Pass Criteria |
| -- | -------- | ----- | ------------- |
| LI-01 | Test local model success | Press `Test local model` with `llama-server` running | Status says it connected to the exact endpoint being tested |
| LI-02 | Test local model failure | Stop `llama-server`, press `Test local model` | Status includes the exact endpoint and an actionable connection/detail error |
| LI-03 | Enhancement off | Set Transcript enhancement to `Off`, dictate `hello world` | Raw ASR output is inserted; no local model request is required |
| LI-04 | Commands only | Set Transcript enhancement to `Voice formatting commands`, dictate `first line new paragraph bullet point check gpio seventeen new bullet stop` | Inserted text preserves paragraph and bullet structure |
| LI-05 | Conservative polish success | Start `llama-server`, set Transcript enhancement to `Conservative local polish`, dictate `hello world this is a test` | Inserted text is punctuated/cased, and meaning is preserved |
| LI-06 | Conservative polish fallback | Stop `llama-server`, keep `Conservative local polish`, dictate a short sentence | VOCO inserts the raw/formatted transcript and shows a non-blocking local enhancement warning |
| LI-07 | Local assistant success | Set After transcription to `Ask local model and type answer`, start `llama-server`, dictate a simple question | VOCO inserts the local model answer, not the raw question |
| LI-08 | Local assistant failure | Stop `llama-server`, keep `Ask local model and type answer`, dictate a simple question | VOCO enters an error state and does not insert a stale or partial answer |
| LI-09 | OpenClaw unchanged | Restore an OpenClaw target and run the existing OpenClaw voice bridge check | OpenClaw behavior matches the pre-local-intelligence path |
| LI-10 | Realtime unchanged | Start and stop realtime with `Alt+Shift+R` | Realtime still starts, stops, and keeps its separate audio path |

## Evidence To Capture

- VOCO version and install channel
- local model server command and model filename, without private paths if sharing publicly
- endpoint used
- whether model name was blank or set
- Wayland or X11 session
- pass/fail for LI-01 through LI-10
- any latency observations for ASR, enhancement, and local assistant phases

## Exit Criteria

Local intelligence is ready for daily dictation only when:

- all required automated checks pass
- LI-01 through LI-08 pass on at least one Ubuntu/Debian desktop session
- LI-09 and LI-10 show no regression in existing optional flows
- failure cases never lose raw dictation text for enhancement and never insert stale local assistant output
