#!/usr/bin/env python3
"""The fresh said-again groups, and their score (PREREGISTRATION.md, Data and
Experiment 1).

  said.py select OUT.json           the train-clean-100 groups the second study did not draw
  said.py score TRIALS.json RUNS.jsonl OUT_DIR

Between the two, the second study's pipeline runs unchanged on OUT.json
(research/voice-correction-primitives-2026-11/harness: said.py dictate, cut.py,
said.py clips, trials and lean). The score needs neither recognizer nor audio.
"""
import json, sys
from pathlib import Path
from core import judge
from rules import rule1, rule2, rule3
from text import words

SECOND = Path(__file__).resolve().parents[2] / 'voice-correction-primitives-2026-11' / 'results'
CONFIGS = [(f'{name}, {"leaned" if lean else "plain"}', rule, lean) for lean in (False, True)
           for name, rule in (('rule 1', rule1), ('rule 2', rule2), ('rule 3', rule3))]


def select(out):
    key = lambda group: (group['subset'], group['speaker'], group['clause'])
    drawn = {key(group) for group in json.loads((SECOND / 'said-groups.json').read_text())['groups']}
    groups = [group for group in json.loads((SECOND / 'groups.json').read_text())['groups']
              if group['subset'] == 'train-clean-100' and key(group) not in drawn]
    Path(out).write_text(json.dumps(dict(groups=groups), indent=1, ensure_ascii=False) + '\n')
    print(len(groups), 'groups;', sum(len(g['utterances']) for g in groups), 'utterances;',
          round(sum(u['seconds'] for g in groups for u in g['utterances']) / 60, 1), 'minutes')


def score(trials_path, runs_path, out_dir):
    trials = json.loads(Path(trials_path).read_text())['trials']
    runs = {(r['arm'], r['id']): r['text'] for r in map(json.loads, Path(runs_path).read_text().splitlines())}
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    summary, lines = {}, []
    for kind in ('other', 'same', 'third'):
        chosen = [t for t in trials if t['kind'] == kind]
        if not chosen:
            continue
        lines.append(f'== train-clean-100, fresh groups, {kind} recording: {len(chosen)} pairs, {len({(t["speaker"], t["clause"]) for t in chosen})} clauses ==')
        for label, rule, lean in CONFIGS:
            counts = {k: dict(right=0, none=0, contained=0, collateral=0) for k in ('far', 'near', 'same', 'elsewhere')}
            for index, trial in enumerate(chosen):
                plain = words(runs['C', trial['clip']])
                for planted in ('far', 'near'):
                    heard = words(runs[planted, trial['id']]) if lean else plain
                    typed = list(trial['typed']); typed[trial['target']] = trial[planted]
                    counts[planted][judge(rule, typed, typed, trial['typed'], heard, trial['first'], trial['last'], False)[0]] += 1
                counts['same'][judge(rule, trial['typed'], trial['typed'], trial['typed'], plain, trial['first'], trial['last'], True)[0]] += 1
                other = chosen[(index + 7) % len(chosen)]
                if other['clause'] != trial['clause']:
                    counts['elsewhere'][judge(rule, other['typed'], other['typed'], other['typed'], plain, None, None, True)[0]] += 1
            made, asked = counts['far']['right'] + counts['near']['right'], 2 * len(chosen)
            total = sum(sum(c.values()) for c in counts.values())
            collateral = sum(c['collateral'] for c in counts.values())
            wrong = collateral + sum(c['contained'] for c in counts.values())
            summary[f'{kind} | {label}'] = dict(pairs=len(chosen), right=made, asked=asked, share=round(made / asked, 4),
                                                collateral=collateral, wrong=wrong, trials=total, outcomes=counts)
            lines.append(f'  {label:<15} right {100 * made / asked:.1f}% ({made}/{asked})  collateral {collateral}/{total}  wrong changes {wrong}/{total}  '
                         + '  '.join(f'{k}: {c["right"]}/{c["none"]}/{c["contained"]}/{c["collateral"]}' for k, c in counts.items()))
        lines.append('')
    (out / 'said-summary.json').write_text(json.dumps(summary, indent=1) + '\n')
    (out / 'said-tables.txt').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    {'select': select, 'score': score}[sys.argv[1]](*sys.argv[2:])
