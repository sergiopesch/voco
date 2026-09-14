# Streaming improvement candidate

This source is an isolated copy of the retained model benchmark prototype. Runtime/build commands, evidence, limitations and tasks are in the surrounding `streaming-improvements-2026-09-13` directory: `REPRODUCE.md`, `REPORT.md`, `NEXT-STEPS.md`, `ENVIRONMENT.json` and `SHA256SUMS`.

The app requires explicit local `VOCO_STREAM_PYTHON` and `VOCO_STREAM_WORKER` paths. Model and worker dependencies are not part of the current Debian package. Existing UI, capture, target guards and recovery behavior remain inherited from the benchmark source. New recognition/insertion scheduling, exact-prefix checks and worker lifecycle are candidate-only. Acoustic VAD is experimental and disabled by default. No installed or default model change is represented by this source.
