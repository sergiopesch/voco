#!/usr/bin/env python3
"""TEST ONLY: run one engine configuration over the benchmark corpus.

  run.py CONFIG --corpus DIR --out FILE.jsonl [--sets a,b] [--every N] [--paced]

Feeds each utterance in 100 ms packets, as VOCO's worker receives them, and
records each call's compute time and the pasteable text whenever it changes.
Without --paced packets go as fast as the engine takes them, and score.py
replays the measured times on a real-time clock. With --paced each packet waits
for its real arrival time, to check that replay. One configuration per
process: NeMo-Speech.cpp and whisper.cpp each bundle their own ggml.
"""
import argparse
import hashlib
import json
import os
import pathlib
import platform
import sys
import time

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import engines  # noqa: E402

ROOT = pathlib.Path(os.environ.get("BENCH_ROOT", "/opt/bench"))
MODELS = {
    "nemotron-en": ROOT / "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf",
    "nemotron-35": ROOT / "models/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf",
    "parakeet": ROOT / "models/parakeet-tdt-0.6b-v3.q8_0.gguf",
    "whisper-turbo": ROOT / "models/ggml-large-v3-turbo-q8_0.bin",
}
CONFIGS = {
    "nemo-en-r0": ("stream", "nemotron-en", dict(right_context=0)),
    "nemo-en-r1": ("stream", "nemotron-en", dict(right_context=1)),
    "nemo-en-r6": ("stream", "nemotron-en", dict(right_context=6)),
    "nemo-en-r13": ("stream", "nemotron-en", dict(right_context=13)),
    "nemo35-r1": ("stream", "nemotron-35", dict(right_context=1, language="en-US")),
    "nemo35-r3": ("stream", "nemotron-35", dict(right_context=3, language="en-US")),
    "nemo35-r6": ("stream", "nemotron-35", dict(right_context=6, language="en-US")),
    "parakeet-offline": ("offline", "parakeet", {}),
    "parakeet-win-10-2-2": ("window", "parakeet", dict(left=10.0, chunk=2.0, right=2.0)),
    "parakeet-win-8-1-1": ("window", "parakeet", dict(left=8.0, chunk=1.0, right=1.0)),
    "whisper-offline": ("whisper-offline", "whisper-turbo", {}),
    "whisper-la2": ("whisper-la2", "whisper-turbo", dict(min_chunk=1.0)),
}
PACKET = 1600  # 100 ms at 16 kHz, VOCO's worker IPC grouping


def peak_rss_mb():
    for line in pathlib.Path("/proc/self/status").read_text().splitlines():
        if line.startswith("VmHWM:"):
            return round(int(line.split()[1]) / 1024, 1)
    return None


def build(name, threads):
    kind, model, options = CONFIGS[name]
    path = str(MODELS[model])
    if kind.startswith("whisper"):
        whisper = engines.Whisper(str(ROOT / "libws_shim.so"), path, threads)
        return engines.WhisperOffline(whisper) if kind == "whisper-offline" else engines.WhisperLA2(whisper, **options)
    nsc = engines.Nsc(str(ROOT / "libbench_research.so"))
    if kind == "stream":
        return engines.NscStream(nsc, path, **options)
    if kind == "offline":
        return engines.NscOffline(nsc, path)
    return engines.WindowedOffline(nsc, path, **options)


def utterance(engine, audio, paced):
    steps, last, violations = [], "", 0
    started = time.perf_counter()
    engine.begin()
    for k, offset in enumerate(range(0, len(audio), PACKET)):
        packet = audio[offset:offset + PACKET]
        if paced:
            due = started + (offset + len(packet)) / engines.RATE
            delay = due - time.perf_counter()
            if delay > 0:
                time.sleep(delay)
        t0 = time.perf_counter()
        text = engine.push(packet)
        ms = (time.perf_counter() - t0) * 1000
        if text != last:
            violations += 0 if text.startswith(last) else 1
            steps.append([k, round(ms, 3), text, round((time.perf_counter() - started) * 1000, 1)])
            last = text
        else:
            steps.append([k, round(ms, 3)])
    t0 = time.perf_counter()
    final = engine.end()
    end_ms = (time.perf_counter() - t0) * 1000
    violations += 0 if final.startswith(last) else 1
    return {"steps": steps, "endMs": round(end_ms, 3), "final": final, "violations": violations,
            "wallMs": round((time.perf_counter() - started) * 1000, 1)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("config", choices=sorted(CONFIGS))
    parser.add_argument("--corpus", required=True, type=pathlib.Path)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    parser.add_argument("--sets", default="")
    parser.add_argument("--every", type=int, default=1, help="take every Nth utterance of each set")
    parser.add_argument("--paced", action="store_true")
    parser.add_argument("--threads", type=int, default=int(os.environ.get("NEMO_SPEECH_CPU_THREADS", "4")))
    args = parser.parse_args()
    os.environ["NEMO_SPEECH_CPU_THREADS"] = str(args.threads)
    manifest = [json.loads(line) for line in (args.corpus / "manifest.jsonl").read_text().splitlines() if line]
    if args.sets:
        manifest = [e for e in manifest if e["set"] in args.sets.split(",")]
    if args.every > 1:
        by_set = {}
        for entry in manifest:
            by_set.setdefault(entry["set"], []).append(entry)
        manifest = [e for entries in by_set.values() for e in entries[::args.every]]
    kind, model, options = CONFIGS[args.config]
    digest = hashlib.sha256(MODELS[model].read_bytes()).hexdigest()
    t0 = time.perf_counter()
    engine = build(args.config, args.threads)
    load_ms = (time.perf_counter() - t0) * 1000
    cpu = next((line.split(":", 1)[1].strip() for line in pathlib.Path("/proc/cpuinfo").read_text().splitlines()
                if line.startswith("model name")), platform.processor())
    header = {"config": args.config, "kind": kind, "model": model, "modelSha256": digest, "options": options,
              "threads": args.threads, "paced": args.paced, "loadMs": round(load_ms, 1), "cpu": cpu,
              "cpus": os.cpu_count(), "utterances": len(manifest), "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    audio = lambda e: np.fromfile(args.corpus / f"{e['id']}.f32", dtype=np.float32)  # noqa: E731
    warm = utterance(engine, audio(manifest[0]), False)  # VOCO warms its worker before readiness
    header["warmupWallMs"] = warm["wallMs"]
    with open(args.out, "w") as out:
        out.write(json.dumps({"header": header}) + "\n")
        for index, entry in enumerate(manifest):
            result = utterance(engine, audio(entry), args.paced)
            result.update(id=entry["id"], set=entry["set"], seconds=entry["seconds"])
            if isinstance(engine, engines.NscOffline):
                result["words"] = engine.words
            out.write(json.dumps(result) + "\n")
            out.flush()
            if index % 25 == 0:
                print(f"{args.config}: {index + 1}/{len(manifest)} {entry['id']}", flush=True)
        out.write(json.dumps({"footer": {"peakRssMb": peak_rss_mb(),
                                         "finished": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}}) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
