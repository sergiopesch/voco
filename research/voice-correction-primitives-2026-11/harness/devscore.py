#!/usr/bin/env python3
"""Score rules on own-text trials: devscore.py OWN.json RUNS.jsonl [RUNS2.jsonl ...] --splits dev

Heard words come from arm S of the first runs file; a later runs file may give
arms 'far' and 'near' (sessions leaned toward that trial's typed window), which
then replace arm S for that kind.
"""
import argparse, json
from pathlib import Path
from rules import WINDOW, rule1, rule2
from text import words

RULES = {'rule1': rule1, 'rule2': rule2, 'rule2-fuzzy-only': lambda w, h: rule2(w, h, trim=0),
         'rule2-trim-only': lambda w, h: rule2(w, h, fuzzy=False)}


def outcome(rule, typed, wanted, first, last, heard, control):
    offset = max(0, len(typed) - WINDOW)
    result = rule(typed[offset:], heard)
    goal = wanted[offset:]
    if result is None:
        return 'right' if control else 'none'
    if result == goal:
        return 'right'
    if first is None:
        return 'collateral'
    a, b = first - offset, last - offset
    inside = result[:a + 1] == goal[:a + 1] and result[len(result) - (len(goal) - b):] == goal[b:]
    return 'contained' if inside else 'collateral'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('own'); parser.add_argument('runs', nargs='+')
    parser.add_argument('--splits', default='dev')
    parser.add_argument('--leaned', action='store_true', help='use arms far/near of the later runs files')
    args = parser.parse_args()
    trials = json.loads(Path(args.own).read_text())['trials']
    runs = {}
    for path in args.runs:
        runs.update({(run['arm'], run['id']): run for run in map(json.loads, Path(path).read_text().splitlines())})
    for split in args.splits.split(','):
        chosen = [t for t in trials if split in ('all', t['split'])]
        print(f'== {split}: {len(chosen)} items{" (leaned)" if args.leaned else ""} ==')
        for name, rule in RULES.items():
            counts = {kind: dict(right=0, none=0, contained=0, collateral=0) for kind in ('far', 'near', 'same', 'elsewhere')}
            for index, trial in enumerate(chosen):
                plain = words(runs['S', trial['id']]['text'])
                for kind in ('far', 'near'):
                    heard = words(runs[kind, trial['id']]['text']) if args.leaned else plain
                    typed = list(trial['typed']); typed[trial['target']] = trial[kind]
                    counts[kind][outcome(rule, typed, trial['typed'], trial['first'], trial['last'], heard, False)] += 1
                same_heard = words(runs['same', trial['id']]['text']) if args.leaned and ('same', trial['id']) in runs else plain
                counts['same'][outcome(rule, trial['typed'], trial['typed'], trial['first'], trial['last'], same_heard, True)] += 1
                other = chosen[(index + 7) % len(chosen)]
                counts['elsewhere'][outcome(rule, other['typed'], other['typed'], None, None, plain, True)] += 1
            made = counts['far']['right'] + counts['near']['right']
            collateral = sum(c['collateral'] for c in counts.values())
            print(f'{name:<18} right {100 * made / (2 * len(chosen)):.1f}% ({made}/{2 * len(chosen)})  collateral {collateral}/{4 * len(chosen)}  '
                  + '  '.join(f'{kind}: {c["right"]}/{c["none"]}/{c["contained"]}/{c["collateral"]}' for kind, c in counts.items()))


if __name__ == '__main__':
    main()
