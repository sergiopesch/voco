#!/usr/bin/env python3
"""Dictate each passage and each phrase through the real speech worker
(PREREGISTRATION.md, Recognition).

  run.py ITEMS.json RUNS.jsonl [--limit N]

With VOCO_CORRECTION_LAB naming the folder that holds LibriSpeech/, and a
provisioned runtime/speech. Run it with the Python VOCO's worker runs on,
/usr/bin/python3. Appends one line per session and skips what RUNS.jsonl holds.

Arm P is the passage in one session, as one dictation: the previous utterance
and the phrase in 100 ms packets, the last one short, as a Stop flushes it;
then the next utterance. Its line holds the final text and, for every push
that returned new text, the seconds of audio sent so far and the length of
that text, which is the start of the final text. `tap` is the seconds of audio
before the next utterance. Arm S is the phrase in a session of its own.
"""
import argparse, hashlib, json, sys
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / 'voice-correction-2026-11' / 'harness'))
from run import RATE, PACKET, Worker, load  # the first study's driver of the real worker


def packets(audio):
    return [audio[offset:offset + PACKET] for offset in range(0, len(audio), PACKET)]


def passage(worker, item):
    parts = [load(part['audio']) for part in (item['previous'], item, item['next'])]
    before, after = np.concatenate(parts[:2]), parts[2]
    session = 'P-' + item['id']
    worker.exchange(session, 0, 'start')
    seq = sent = 0
    texts = []
    for packet in packets(before) + packets(after):
        seq += 1; sent += len(packet)
        text = worker.exchange(session, seq, 'push', audio=packet.tolist(), rate=RATE)['text']
        if text is not None:
            texts.append((round(sent / RATE, 4), text))
    final = worker.exchange(session, seq + 1, 'finish')['text']
    revised = [[seconds, text] for seconds, text in texts if not final.startswith(text)]
    digest = hashlib.sha256(b''.join(part.tobytes() for part in parts)).hexdigest()
    return dict(arm='P', id=item['id'], text=final, tap=round(len(before) / RATE, 4), seconds=round(sent / RATE, 4),
                timeline=[[seconds, len(text)] for seconds, text in texts if final.startswith(text)], revised=revised, audioSha256=digest)


def alone(worker, item):
    audio = load(item['audio'])
    text, _, _ = worker.recognize('S-' + item['id'], audio)
    return dict(arm='S', id=item['id'], text=text, audioSha256=hashlib.sha256(audio.tobytes()).hexdigest())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('items'); parser.add_argument('out'); parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    items = json.loads(Path(args.items).read_text())['items'][:args.limit]
    out = Path(args.out)
    done = {(r['arm'], r['id']) for r in map(json.loads, out.read_text().splitlines())} if out.exists() else set()
    worker = Worker()
    with out.open('a') as log:
        for index, item in enumerate(items):
            for arm, session in (('P', passage), ('S', alone)):
                if (arm, item['id']) not in done:
                    log.write(json.dumps(session(worker, item), ensure_ascii=False) + '\n'); log.flush()
            if index % 25 == 0:
                print(f'{index}/{len(items)}', flush=True)
    worker.child.stdin.close()
    if worker.child.wait(timeout=60):
        raise RuntimeError('worker exited with a failure')
    print('done', flush=True)


if __name__ == '__main__':
    main()
