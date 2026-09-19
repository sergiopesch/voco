#!/usr/bin/env python3
"""Replay pinned public speech into the real worker; never open audio/input devices.

This measures the subprocess boundary, not capture, the recipient, or pixel paint.
Raw public-fixture text stays in the explicitly requested private evidence directory.
"""
import argparse
import array
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import subprocess
import sys
import time
import wave

from speech_worker import WorkerResponses

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def write(path, value):
    with path.open('x') as handle:
        json.dump(value, handle, indent=2, allow_nan=False)
        handle.write('\n')


def fixtures(split):
    result = []
    for label, relative in [('development', 'tests/fixtures/speech'),
                            ('held-out', 'tests/fixtures/speech/adversarial')]:
        if split not in (label, 'all'):
            continue
        folder = ROOT / relative
        for item in json.loads((folder / 'manifest.json').read_text())['fixtures']:
            path = folder / item['file']
            if digest(path) != item['sha256']:
                raise ValueError('fixture digest mismatch')
            with wave.open(str(path)) as wav:
                if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
                    raise ValueError('requires mono PCM16')
                samples = array.array('h', wav.readframes(wav.getnframes()))
                if sys.byteorder != 'little':
                    samples.byteswap()
                rate = wav.getframerate()
            result.append({**item, 'split': label, 'rate': rate,
                           'audio': [sample / 32768 for sample in samples],
                           'referenceFormattingAudited': False})
    return result


def exchange(child, reader, session, seq, op, **fields):
    child.stdin.write((json.dumps(dict(session=session, seq=seq, op=op, **fields)) + '\n').encode())
    child.stdin.flush()
    response = reader.read(timeout=30)
    if (response.get('session') != session or response.get('seq') != seq
            or response.get('mode') != 'append-only' or 'error' in response
            or (response.get('text') is not None and not isinstance(response['text'], str))):
        raise RuntimeError('invalid worker response')
    return response


def replay(child, reader, item, trial, packet_ms, paced):
    session = f"evaluation-{item['id']}-{trial}"
    begin = time.monotonic()
    exchange(child, reader, session, 0, 'start')
    started = time.monotonic()
    rate, audio = item['rate'], item['audio']
    packet = round(rate * packet_ms / 1000)
    updates, durations, ages = [], [], []
    max_rss = 0
    import psutil
    process = psutil.Process(child.pid)
    seq = 0
    for offset in range(0, len(audio), packet):
        seq += 1
        chunk = audio[offset:offset + packet]
        available_s = (offset + len(chunk)) / rate
        if paced:
            time.sleep(max(0, started + available_s - time.monotonic()))
        sent = time.monotonic()
        ages.append(max(0, (sent - started - available_s) * 1000) if paced else None)
        response = exchange(child, reader, session, seq, 'push', audio=chunk, rate=rate)
        ended = time.monotonic()
        durations.append((ended - sent) * 1000)
        max_rss = max(max_rss, process.memory_info().rss)
        if response['text'] is not None:
            updates.append(dict(text=response['text'], atMs=(ended-started)*1000,
                                audioEndMs=available_s*1000, final=False))
    stopping = time.monotonic()
    response = exchange(child, reader, session, seq+1, 'finish')
    ended = time.monotonic()
    if not isinstance(response['text'], str):
        raise RuntimeError('finish requires final text')
    updates.append(dict(text=response['text'], atMs=(ended-started)*1000,
                        audioEndMs=len(audio)/rate*1000, final=True))
    cpu = process.cpu_times()
    return dict(id=item['id'], trial=trial, split=item['split'], status='completed',
                audioSha256=item['sha256'], durationMs=len(audio)/rate*1000,
                reference=item['reference'], referenceFormattingAudited=False,
                hypothesis=response['text'], updates=updates,
                startAckMs=(started-begin)*1000, finishAckMs=(ended-stopping)*1000,
                elapsedMs=(ended-started)*1000,
                requestServiceMs=sum(durations)+(ended-stopping)*1000,
                pushMs=durations, ingressQueueAgeMs=ages,
                sampledWorkerRssBytes=max_rss, cumulativeCpuSeconds=cpu.user+cpu.system)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--context', type=int, choices=[0, 1], default=1)
    parser.add_argument('--threads', type=int, choices=range(1, 9), default=4)
    parser.add_argument('--packet-ms', type=int, choices=[20, 40, 50, 100], default=20)
    parser.add_argument('--repeats', type=int, choices=range(1, 11), default=1)
    parser.add_argument('--split', choices=['development', 'held-out', 'all'], default='development')
    parser.add_argument('--paced', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    items = fixtures(args.split)
    args.output.mkdir(parents=True, exist_ok=False)
    runtime = args.runtime.resolve()
    files = [p for p in runtime.rglob('*') if p.is_file() and
             (p.suffix == '.py' or '.so' in p.name or p.suffix == '.gguf')]
    identity = {str(p.relative_to(runtime)): digest(p) for p in sorted(files)}
    plan = dict(schemaVersion=1, boundary='real_worker_json_protocol_no_capture_or_destination',
                sourceCommit=subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip(),
                harnessSha256=digest(Path(__file__)), runtimeHashes=identity,
                host=dict(system=platform.platform(), machine=platform.machine(), cpuCount=os.cpu_count()),
                config=dict(context=args.context, threads=args.threads, packetMs=args.packet_ms,
                            gate='zero', paced=args.paced, repeats=args.repeats, split=args.split),
                fixtures=[{k: v for k, v in x.items() if k != 'audio'} for x in items])
    write(args.output / 'plan.json', plan)
    env = {**os.environ, 'VOCO_NEMOTRON_CONTEXT': str(args.context),
           'NEMO_SPEECH_CPU_THREADS': str(args.threads), 'VOCO_PERFORMANCE_LOG': '0',
           'VOCO_NEMO_BACKEND': 'pool', 'VOCO_SILENCE_GATE': 'zero',
           'VOCO_NEMOTRON_MODEL': str(runtime / 'models/nemotron-speech-streaming-en-0.6b.q8_0.gguf'),
           'LD_LIBRARY_PATH': str(runtime / 'lib'), 'PYTHONDONTWRITEBYTECODE': '1'}
    # API credentials are unnecessary in a local inference child.
    for name in list(env):
        if 'TYPESAFE' in name:
            del env[name]
    rows = []
    launched = time.monotonic()
    with (args.output / 'worker.stderr').open('x') as errors:
        child = subprocess.Popen([sys.executable, str(runtime / 'stream_worker.py')],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, env=env)
        try:
            reader = WorkerResponses(child.stdout)
            if reader.read(timeout=120).get('ready') is not True:
                raise RuntimeError('worker not ready')
            cold_ready = (time.monotonic() - launched)*1000
            with (args.output / 'trials.jsonl').open('x') as receipt:
                for trial in range(args.repeats):
                    order = list(items)
                    random.Random(20260919+trial).shuffle(order)
                    for item in order:
                        try:
                            row = replay(child, reader, item, trial, args.packet_ms, args.paced)
                        except Exception as error:
                            row = dict(id=item['id'], trial=trial, split=item['split'],
                                       status='error', errorType=type(error).__name__)
                            receipt.write(json.dumps(row)+'\n'); receipt.flush()
                            raise
                        rows.append(row)
                        receipt.write(json.dumps(row, allow_nan=False)+'\n'); receipt.flush()
                        print(f"{item['id']} trial {trial+1}: completed", flush=True)
            child.stdin.close()
            child.wait(timeout=10)
            if child.returncode != 0:
                raise RuntimeError('worker exit failure')
            write(args.output / 'run.json', dict(**plan, coldReadyMs=cold_ready, trials=rows))
        finally:
            if child.poll() is None:
                child.kill(); child.wait()
            child.stdout.close()
            if not child.stdin.closed:
                child.stdin.close()


if __name__ == '__main__':
    main()
