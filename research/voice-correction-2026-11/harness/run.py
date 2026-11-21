#!/usr/bin/env python3
"""Run arms S, P and R through the real speech worker (PREREGISTRATION.md, Recognition).

  run.py ITEMS.json RUNS.jsonl    with VOCO_CORRECTION_LAB naming the folder that
                                  holds LibriSpeech/, and a provisioned runtime/speech

Appends one line per session and skips the sessions RUNS.jsonl already holds, so
an interrupted run continues. Never opens an audio or input device.
"""
import json, os, subprocess, sys, time
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts'))
from speech_worker import WorkerResponses

LAB = Path(os.environ['VOCO_CORRECTION_LAB'])
RATE, PACKET = 16000, 1600


def load(relative):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(LAB / 'LibriSpeech' / relative), '-f', 'f32le',
                          '-ac', '1', '-ar', str(RATE), '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32)


class Worker:
    def __init__(self):
        env = {name: value for name, value in os.environ.items() if not name.startswith(('VOCO_', 'NEMO_'))}
        env.update(NEMO_SPEECH_CPU_THREADS='4', VOCO_PERFORMANCE_LOG='0', PYTHONDONTWRITEBYTECODE='1')
        # As VOCO starts it: -E -s -B, never -I.
        self.child = subprocess.Popen([sys.executable, '-E', '-s', '-B', str(ROOT / 'runtime/speech/stream_worker.py')],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
        self.reader = WorkerResponses(self.child.stdout)
        if self.reader.read(timeout=300).get('ready') is not True:
            raise RuntimeError('worker did not become ready')

    def exchange(self, session, seq, op, **fields):
        self.child.stdin.write((json.dumps(dict(session=session, seq=seq, op=op, **fields)) + '\n').encode())
        self.child.stdin.flush()
        response = self.reader.read(timeout=120)
        if (response.get('session') != session or response.get('seq') != seq
                or response.get('mode') != 'append-only' or 'error' in response):
            raise RuntimeError(f'invalid worker response for {session}')
        return response

    def recognize(self, session, audio):
        """The final text, how many pushes returned new text, and the time from
        sending the last packet to the final text."""
        self.exchange(session, 0, 'start')
        seq = updates = 0
        latest = ''
        last_sent = time.monotonic()
        for offset in range(0, len(audio), PACKET):
            seq += 1
            last_sent = time.monotonic()
            text = self.exchange(session, seq, 'push', audio=audio[offset:offset + PACKET].tolist(), rate=RATE)['text']
            if text is not None:
                if not text.startswith(latest):
                    raise RuntimeError(f'{session} revised earlier words')
                latest = text; updates += 1
        final = self.exchange(session, seq + 1, 'finish')['text']
        if not isinstance(final, str):
            raise RuntimeError(f'{session} finished without text')
        return final, updates, (time.monotonic() - last_sent) * 1000


def main():
    plan = json.loads(Path(sys.argv[1]).read_text())
    out = Path(sys.argv[2])
    done = {(r['arm'], r['id']) for r in map(json.loads, out.read_text().splitlines())} if out.exists() else set()
    sessions = [('S', item['id'], [item['audio']]) for item in plan['items']]
    sessions += [('R', item['id'], [item['audio']]) for item in plan['resumes']]
    sessions += [('P', item['id'], [item['previous']['audio'], item['audio'], item['next']['audio']]) for item in plan['items']]
    worker = Worker()
    with out.open('a') as log:
        for index, (arm, key, files) in enumerate(sessions):
            if (arm, key) in done:
                continue
            audio = np.concatenate([load(name) for name in files])
            started = time.monotonic()
            text, updates, tail_ms = worker.recognize(f'{arm}-{key}', audio)
            log.write(json.dumps(dict(arm=arm, id=key, text=text, updates=updates, audioSeconds=round(len(audio) / RATE, 3),
                                      elapsedMs=round((time.monotonic() - started) * 1000, 1), tailMs=round(tail_ms, 1)),
                                 ensure_ascii=False) + '\n')
            log.flush()
            if index % 50 == 0:
                print(f'{index}/{len(sessions)} {arm}', flush=True)
    worker.child.stdin.close()
    if worker.child.wait(timeout=60):
        raise RuntimeError('worker exited with a failure')
    print('done', flush=True)


if __name__ == '__main__':
    main()
