#!/usr/bin/env python3
"""Said again: recognition and trials for clauses one speaker says in two
recordings (PREREGISTRATION.md, Study A).

  said.py select GROUPS.json OUT.json          the pre-registered choice of groups
  said.py dictate CHOSEN.json RUNS.jsonl       each utterance whole, through the real worker
  said.py clips CHOSEN.json CUTS.json RUNS.jsonl   each cut clause on its own
  said.py trials CHOSEN.json CUTS.json RUNS.jsonl OUT.json
  said.py lean TRIALS.json CUTS.json RUNS.jsonl    each trial's clause, leaned toward its typed window

With VOCO_CORRECTION_LAB naming the folder that holds LibriSpeech/. Recognition
appends to RUNS.jsonl and skips what it holds.
"""
import json, random, sys
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / 'voice-correction-2026-11' / 'harness'))
from run import Worker, load  # the first study's driver of the real worker
from lean import listed, recognize
from own import surface
from text import align, distance, words

SEED = 20261122
TRAIN = 141
AFTER = (0, 4, 8)


def select(groups_path, out):
    """Every held-out group, and TRAIN train-clean-100 groups drawn with the seed."""
    groups = json.loads(Path(groups_path).read_text())['groups']
    train = [g for g in groups if g['subset'] == 'train-clean-100']
    random.Random(SEED).shuffle(train)
    chosen = [g for g in groups if g['subset'] != 'train-clean-100'] + sorted(train[:TRAIN], key=lambda g: (g['speaker'], g['clause']))
    Path(out).write_text(json.dumps(dict(groups=chosen), indent=1, ensure_ascii=False) + '\n')
    print(len(chosen), 'groups;', sum(len(g['utterances']) for g in chosen), 'utterances;',
          round(sum(u['seconds'] for g in chosen for u in g['utterances']) / 60, 1), 'minutes')


def log_runs(path):
    out = Path(path)
    done = {(r['arm'], r['id']) for r in map(json.loads, out.read_text().splitlines())} if out.exists() else set()
    return out, done


def dictate(chosen, runs):
    groups = json.loads(Path(chosen).read_text())['groups']
    out, done = log_runs(runs)
    worker = Worker()
    with out.open('a') as log:
        seen = set(done)
        for number, group in enumerate(groups):
            for utterance in group['utterances']:
                if ('U', utterance['id']) in seen:
                    continue
                seen.add(('U', utterance['id']))
                text, _, _ = worker.recognize('U-' + utterance['id'], load(utterance['audio']))
                log.write(json.dumps(dict(arm='U', id=utterance['id'], text=text), ensure_ascii=False) + '\n'); log.flush()
            if number % 25 == 0: print(number, len(groups), flush=True)
    worker.child.stdin.close(); worker.child.wait(timeout=60); print('done', flush=True)


def clip(utterance_audio, cut):
    return utterance_audio[cut['startSample']:cut['endSample']]


def clips(chosen, cuts_path, runs):
    groups = json.loads(Path(chosen).read_text())['groups']
    cuts = json.loads(Path(cuts_path).read_text())['cuts']
    out, done = log_runs(runs)
    worker = Worker()
    with out.open('a') as log:
        for number, group in enumerate(groups):
            for utterance in group['utterances']:
                key = f"{utterance['id']}:{utterance['first']}"
                if cuts[key]['reason'] or ('C', key) in done:
                    continue
                text, _, tail = worker.recognize('C-' + key, clip(load(utterance['audio']), cuts[key]))
                log.write(json.dumps(dict(arm='C', id=key, text=text, tailMs=round(tail, 1)), ensure_ascii=False) + '\n'); log.flush()
            if number % 25 == 0: print(number, len(groups), flush=True)
    worker.child.stdin.close(); worker.child.wait(timeout=60); print('done', flush=True)


def trials(chosen, cuts_path, runs, out):
    groups = json.loads(Path(chosen).read_text())['groups']
    cuts = json.loads(Path(cuts_path).read_text())['cuts']
    texts = {r['id']: r['text'] for r in map(json.loads, Path(runs).read_text().splitlines()) if r['arm'] == 'U'}
    vocabulary = sorted({word for group in groups for utterance in group['utterances'] for word in words(utterance['reference'])})
    rng = random.Random(SEED)
    built, left_out, number = [], {}, 0
    for group in groups:
        said = group['utterances']
        pairs = [('other', 0, 1), ('other', 1, 0), ('same', 0, 0), ('same', 1, 1)] + ([('third', 0, 2)] if len(said) > 2 else [])
        planted = {}
        for kind, d, c in pairs:
            dictation, correction = said[d], said[c]
            key = f"{correction['id']}:{correction['first']}"
            reason = cuts[key]['reason'] and 'no clip: ' + cuts[key]['reason']
            typed, shown = words(texts[dictation['id']]), surface(texts[dictation['id']])
            reference = words(dictation['reference'])
            aligned = align(reference, typed)
            first, last = dictation['first'], dictation['last']
            left = -1 if first == 0 else aligned[first - 1][0]
            right = len(typed) if last == len(reference) - 1 else aligned[last + 1][0]
            if not reason and (left is None or right is None or right - left - 1 < 3):
                reason = "the clause's place in the typed text is unknown or under three words"
            if reason:
                left_out[kind, reason] = left_out.get((kind, reason), 0) + 1
                continue
            start, stop = left + 1, right - 1
            if d not in planted:   # one planted word for each dictation, whatever corrects it
                target = rng.randrange(start + 1, stop)
                word = typed[target]
                far = rng.choice(vocabulary)
                while far == word or far in (typed[target - 1], typed[target + 1]):
                    far = rng.choice(vocabulary)
                gaps = {other: distance(word, other) for other in vocabulary if other != word}
                near = rng.choice(sorted(other for other, gap in gaps.items() if gap == min(gaps.values())))
                planted[d] = (target, far, near, AFTER[number % 3]); number += 1
            target, far, near, after = planted[d]
            end = stop + 1 + after
            built.append(dict(id=f"{dictation['id']}>{key}", kind=kind, subset=group['subset'], speaker=group['speaker'], clause=group['clause'],
                              dictation=dictation['id'], clip=key, audio=correction['audio'], typed=typed[:end], shown=shown[:end],
                              first=start, last=stop, target=target, far=far, near=near))
    Path(out).write_text(json.dumps(dict(seed=SEED, leftOut={f'{k}: {r}': n for (k, r), n in sorted(left_out.items())}, trials=built),
                                    indent=1, ensure_ascii=False) + '\n')
    print(len(built), 'trials', {k: sum(t['kind'] == k for t in built) for k in ('other', 'same', 'third')}, 'left out', left_out)


def lean(trials_path, cuts_path, runs):
    plan = json.loads(Path(trials_path).read_text())['trials']
    cuts = json.loads(Path(cuts_path).read_text())['cuts']
    out, done = log_runs(runs)
    worker = Worker()
    with out.open('a') as log:
        for number, trial in enumerate(plan):
            audio = None
            for kind in ('far', 'near'):
                if (kind, trial['id']) in done:
                    continue
                if audio is None:
                    audio = clip(load(trial['audio']), cuts[trial['clip']])
                shown = list(trial['shown']); shown[trial['target']] = trial[kind]
                text = recognize(worker, f'{kind}-{number}', audio, listed(shown, 1))
                log.write(json.dumps(dict(arm=kind, id=trial['id'], text=text), ensure_ascii=False) + '\n'); log.flush()
            if number % 50 == 0: print(number, len(plan), flush=True)
    worker.child.stdin.close(); worker.child.wait(timeout=60); print('done', flush=True)


if __name__ == '__main__':
    {'select': select, 'dictate': dictate, 'clips': clips, 'trials': trials, 'lean': lean}[sys.argv[1]](*sys.argv[2:])
