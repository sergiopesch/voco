#!/usr/bin/env python3
"""Score Study A: score_said.py TRIALS.json RUNS.jsonl OUT_DIR

Needs neither recognizer nor audio. For each kind of pair (other recording,
same recording, third recording) and each set of data, the outcomes of the far
and near trials under rule 1 and rule 2, with the clause heard plainly and
leaned toward the typed window, and of the two controls, heard plainly.
"""
import json, sys
from pathlib import Path
from ownscore import outcome
from rules import rule1, rule2
from text import words

SETS = {'held out': ('test-clean', 'test-other', 'dev-clean', 'dev-other'), 'train-clean-100': ('train-clean-100',)}
CONFIGS = [('rule 1, plain', rule1, False), ('rule 2, plain', rule2, False), ('rule 1, leaned', rule1, True), ('rule 2, leaned', rule2, True)]


def main():
    trials = json.loads(Path(sys.argv[1]).read_text())['trials']
    runs = {(r['arm'], r['id']): r['text'] for r in map(json.loads, Path(sys.argv[2]).read_text().splitlines())}
    out = Path(sys.argv[3]); out.mkdir(parents=True, exist_ok=True)
    summary, lines = {}, []
    for name, subsets in SETS.items():
        for kind in ('other', 'same', 'third'):
            chosen = [t for t in trials if t['kind'] == kind and t['subset'] in subsets]
            if not chosen:
                continue
            lines.append(f'== {name}, {kind} recording: {len(chosen)} pairs, {len({(t["speaker"], t["clause"]) for t in chosen})} clauses ==')
            plain_same = sum(words(runs['C', t['clip']]) == t['typed'][t['first']:t['last'] + 1] for t in chosen)
            lines.append(f'Clause on its own written as in the dictation: {100 * plain_same / len(chosen):.1f}% ({plain_same}/{len(chosen)})')
            for label, rule, leaned in CONFIGS:
                counts = {k: dict(right=0, none=0, contained=0, collateral=0) for k in ('far', 'near', 'same', 'elsewhere')}
                for index, trial in enumerate(chosen):
                    plain = words(runs['C', trial['clip']])
                    for planted in ('far', 'near'):
                        heard = words(runs[planted, trial['id']]) if leaned else plain
                        typed = list(trial['typed']); typed[trial['target']] = trial[planted]
                        counts[planted][outcome(rule, typed, trial['typed'], trial['first'], trial['last'], heard, False)] += 1
                    counts['same'][outcome(rule, trial['typed'], trial['typed'], trial['first'], trial['last'], plain, True)] += 1
                    other = chosen[(index + 7) % len(chosen)]
                    if other['clause'] != trial['clause']:
                        counts['elsewhere'][outcome(rule, other['typed'], other['typed'], None, None, plain, True)] += 1
                made, asked = counts['far']['right'] + counts['near']['right'], 2 * len(chosen)
                total = sum(sum(c.values()) for c in counts.values())
                collateral = sum(c['collateral'] for c in counts.values())
                summary[f'{name} | {kind} | {label}'] = dict(pairs=len(chosen), right=made, asked=asked, share=round(made / asked, 4),
                                                             collateral=collateral, trials=total, outcomes=counts)
                lines.append(f'  {label:<15} right {100 * made / asked:.1f}% ({made}/{asked})  collateral {collateral}/{total}  '
                             + '  '.join(f'{k}: {c["right"]}/{c["none"]}/{c["contained"]}/{c["collateral"]}' for k, c in counts.items()))
            lines.append('')
    # Two attempts, where a clause was said three times: the second recording, then the third.
    for name, subsets in SETS.items():
        by = {}
        for t in trials:
            if t['subset'] in subsets and t['kind'] in ('other', 'third'):
                by.setdefault((t['dictation'], t['kind']), t)
        firsts = [(by[d, 'other'], by[d, 'third']) for (d, kind) in by if kind == 'third' and (d, 'other') in by]
        if firsts:
            one = two = 0
            for a, b in firsts:
                results = []
                for trial in (a, b):
                    typed = list(trial['typed']); typed[trial['target']] = trial['near']
                    results.append(outcome(rule2, typed, trial['typed'], trial['first'], trial['last'], words(runs['near', trial['id']]), False))
                one += results[0] == 'right'; two += results[0] == 'right' or (results[0] == 'none' and results[1] == 'right')
            lines.append(f'{name}: near trials with a third recording, rule 2 leaned: right at the first attempt {one}/{len(firsts)}, within two {two}/{len(firsts)}')
            summary[f'{name} | two attempts'] = dict(pairs=len(firsts), first=one, withinTwo=two)
    key = 'held out | other | rule 2, leaned'
    if key in summary:
        s = summary[key]; safe = s['collateral'] / s['trials'] <= .01
        summary['bars'] = dict(safe=safe, useful=safe and s['share'] >= .8, magic=safe and s['share'] >= .95)
        lines += ['', 'Bars, held out, other recording, rule 2 leaned: ' + ', '.join(f'{k} {"met" if v else "not met"}' for k, v in summary['bars'].items())]
    (out / 'said-summary.json').write_text(json.dumps(summary, indent=1) + '\n')
    (out / 'said-tables.txt').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
