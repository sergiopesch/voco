"""Trial only. Start the speech worker the way VOCO starts it, with only the
variables it reads and Python's -E -s -B, dictate each public clip in 100 ms
packets, and score the text against the reference as speech-score.mjs does.
Prints one JSON report; exits 1 when a clip or the aggregate misses its bar.

Usage: worker_check.py PYTHON WORKER FIXTURES_DIR
"""
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import time
import unicodedata
import wave

ALLOWED = ("HOME", "XDG_STATE_HOME", "LANG", "LC_ALL", "LC_CTYPE", "NEMO_SPEECH_CPU_THREADS",
           "VOCO_NEMOTRON_CONTEXT", "VOCO_NEMOTRON_MODEL", "VOCO_NEMO_BACKEND",
           "VOCO_PERFORMANCE_LOG", "VOCO_SILENCE_GATE")


def words(text):
    text = unicodedata.normalize("NFKC", text).lower().replace("’", "'").replace("‘", "'")
    return re.findall(r"[^\W_]+(?:'[^\W_]+)*", text)


def edits(reference, hypothesis):
    row = list(range(len(hypothesis) + 1))
    for i, word in enumerate(reference, 1):
        previous, row[0] = row[0], i
        for j, other in enumerate(hypothesis, 1):
            previous, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, previous + (word != other))
    return row[-1]


def main():
    python, worker, fixtures = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    manifest = json.loads((fixtures / "manifest.json").read_text())
    environment = {name: value for name, value in os.environ.items() if name in ALLOWED}
    started = time.monotonic()
    child = subprocess.Popen([python, "-E", "-s", "-B", worker], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, text=True, env=environment)

    def read():
        line = child.stdout.readline()
        if not line:
            raise SystemExit(f"The worker closed its output (exit {child.wait()})")
        return json.loads(line)

    ready = read()
    ready_seconds = time.monotonic() - started
    if ready.get("ready") is not True:
        raise SystemExit(f"The worker did not become ready: {ready}")

    def exchange(op, session, seq, **fields):
        child.stdin.write(json.dumps({"op": op, "session": session, "seq": seq, **fields}) + "\n")
        child.stdin.flush()
        response = read()
        if "error" in response or response.get("session") != session or response.get("seq") != seq:
            raise SystemExit(f"Unexpected worker response to {op}: {response}")
        return response

    results, total_edits, total_words = [], 0, 0
    for fixture in manifest["fixtures"]:
        with wave.open(str(fixtures / fixture["file"])) as clip:
            if (clip.getframerate(), clip.getsampwidth(), clip.getnchannels()) != (16000, 2, 1):
                raise SystemExit(f"{fixture['file']} isn't 16 kHz mono PCM16")
            frames = clip.readframes(clip.getnframes())
        audio = [sample / 32768 for sample in struct.unpack(f"<{len(frames) // 2}h", frames)]
        session = fixture["id"]
        clip_started = time.monotonic()
        exchange("start", session, 0)
        seq = 1
        for offset in range(0, len(audio), 1600):
            exchange("push", session, seq, audio=audio[offset:offset + 1600], rate=16000)
            seq += 1
        text = exchange("finish", session, seq)["text"]
        reference, hypothesis = words(fixture["reference"]), words(text)
        count = edits(reference, hypothesis)
        total_edits, total_words = total_edits + count, total_words + len(reference)
        results.append({"id": session, "text": text, "wer": round(count / len(reference), 4),
                        "maxWer": fixture["maxWer"], "seconds": round(time.monotonic() - clip_started, 2),
                        "passed": count / len(reference) <= fixture["maxWer"]})
    child.stdin.close()
    code = child.wait(timeout=10)
    aggregate = total_edits / total_words
    report = {"readySeconds": round(ready_seconds, 2), "aggregateWer": round(aggregate, 4),
              "maxAggregateWer": manifest["maxAggregateWer"], "exit": code, "fixtures": results}
    print(json.dumps(report, indent=2))
    passed = all(result["passed"] for result in results) and aggregate <= manifest["maxAggregateWer"]
    sys.exit(0 if passed and code == 0 else 1)


if __name__ == "__main__":
    main()
