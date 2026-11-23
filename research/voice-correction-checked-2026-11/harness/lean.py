#!/usr/bin/env python3
"""Recognize each phrase on its own, leaned toward the words of a typed window,
through the real worker's My words boost (PREREGISTRATION.md, Leaning).

  lean.py ITEMS.json TRIALS.json RUNS.jsonl OUT.jsonl

Run with /usr/bin/python3. For each trial, the lists of Experiment 1 (the
window complete, with the far word, the near word and nothing planted) and of
Experiment 2 (the window as typed at the key press, the same three). One
session for each different list of an item; a line holds the list. Appends to
OUT.jsonl and skips what it holds.
"""
import json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / 'voice-correction-2026-11' / 'harness'))
from run import RATE, PACKET, Worker, load  # the first study's driver of the real worker
sys.path.insert(0, str(HERE))
from core import listed, surface, typed_at


def lists(trial, run):
    """{(experiment, kind): list} for one trial."""
    out = {}
    whole = surface(run['text'])[:trial['last'] + 1 + trial['after']]
    at_tap = surface(typed_at(run, 0))
    for experiment, shown in ((1, whole), (2, at_tap)):
        for kind in ('far', 'near', 'same'):
            tokens = list(shown)
            if kind != 'same' and trial['target'] < len(tokens):
                tokens[trial['target']] = trial[kind]
            out[experiment, kind] = listed(tokens)
    return out


def recognize(worker, session, audio, terms):
    worker.exchange(session, 0, 'start', words=terms)
    seq = 0
    for offset in range(0, len(audio), PACKET):
        seq += 1
        worker.exchange(session, seq, 'push', audio=audio[offset:offset + PACKET].tolist(), rate=RATE)
    return worker.exchange(session, seq + 1, 'finish')['text']


def main():
    items = {item['id']: item for item in json.loads(Path(sys.argv[1]).read_text())['items']}
    trials = json.loads(Path(sys.argv[2]).read_text())['trials']
    runs = {(run['arm'], run['id']): run for run in map(json.loads, Path(sys.argv[3]).read_text().splitlines())}
    out = Path(sys.argv[4])
    done = {(r['id'], tuple(r['words'])) for r in map(json.loads, out.read_text().splitlines())} if out.exists() else set()
    worker = Worker()
    with out.open('a') as log:
        for index, trial in enumerate(trials):
            audio = None
            for number, terms in enumerate(dict.fromkeys(map(tuple, lists(trial, runs['P', trial['id']]).values()))):
                if (trial['id'], terms) in done or not terms:
                    continue
                if audio is None:
                    audio = load(items[trial['id']]['audio'])
                text = recognize(worker, f'L{number}-{trial["id"]}', audio, list(terms))
                log.write(json.dumps(dict(arm='L', id=trial['id'], words=list(terms), text=text), ensure_ascii=False) + '\n'); log.flush()
            if index % 25 == 0:
                print(index, len(trials), flush=True)
    worker.child.stdin.close(); worker.child.wait(timeout=60)
    print('done', flush=True)


if __name__ == '__main__':
    main()
