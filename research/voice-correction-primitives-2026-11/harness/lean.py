#!/usr/bin/env python3
"""Recognize each phrase on its own with the session leaned toward the words
of that trial's typed window, through the real worker's My words boost.

  lean.py OWN.json RUNS.jsonl --splits dev [--grams N]

With VOCO_CORRECTION_LAB naming the folder that holds LibriSpeech/, and the
first study's items beside this record. One session for each trial and kind
(far, near, same), since the planted word is in the window and so in the list.
--grams 2 lists each pair of neighbouring window words instead of each word.
Appends to RUNS.jsonl and skips what it holds.
"""
import argparse, json, sys, time
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / 'voice-correction-2026-11' / 'harness'))
from run import RATE, PACKET, Worker, load  # the first study's driver

WINDOW = 30


def listed(shown, grams):
    """The window's words, or its runs of `grams` words, once each, as typed."""
    tokens = shown[-WINDOW:]
    terms = [' '.join(tokens[i:i + grams]) for i in range(len(tokens) - grams + 1)]
    seen, unique = set(), []
    for term in terms:
        if term.casefold() not in seen:
            seen.add(term.casefold()); unique.append(term)
    return unique[:100]


def recognize(worker, session, audio, words):
    worker.exchange(session, 0, 'start', words=words)
    seq = 0
    for offset in range(0, len(audio), PACKET):
        seq += 1
        worker.exchange(session, seq, 'push', audio=audio[offset:offset + PACKET].tolist(), rate=RATE)
    return worker.exchange(session, seq + 1, 'finish')['text']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('own'); parser.add_argument('out')
    parser.add_argument('--splits', default='dev'); parser.add_argument('--grams', type=int, default=1)
    args = parser.parse_args()
    trials = [t for t in json.loads(Path(args.own).read_text())['trials'] if t['split'] in args.splits.split(',')]
    items = {item['id']: item for item in json.loads((HERE.parents[1] / 'voice-correction-2026-11/results/items.json').read_text())['items']}
    out = Path(args.out)
    done = {(r['arm'], r['id']) for r in map(json.loads, out.read_text().splitlines())} if out.exists() else set()
    worker = Worker()
    with out.open('a') as log:
        for index, trial in enumerate(trials):
            audio = None
            for kind in ('far', 'near', 'same'):
                if (kind, trial['id']) in done:
                    continue
                if audio is None:
                    audio = load(items[trial['id']]['audio'])
                shown = list(trial['shown'])
                if kind != 'same':
                    shown[trial['target']] = trial[kind]
                text = recognize(worker, f'{kind}-{trial["id"]}', audio, listed(shown, args.grams))
                log.write(json.dumps(dict(arm=kind, id=trial['id'], text=text, grams=args.grams), ensure_ascii=False) + '\n'); log.flush()
            if index % 50 == 0:
                print(index, len(trials), flush=True)
    worker.child.stdin.close(); worker.child.wait(timeout=60)
    print('done', flush=True)


if __name__ == '__main__':
    main()
