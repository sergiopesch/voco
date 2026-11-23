#!/usr/bin/env python3
"""Score Experiments 1 and 2 on own-text trials (PREREGISTRATION.md).

  score.py TRIALS.json RUNS.jsonl LEAN.jsonl OUT_DIR

Needs neither the recognizer nor the audio. Writes own-summary.json and
own-tables.txt.
"""
import json, sys
from pathlib import Path
from core import DELAYS, judge, listed, planted, surface, typed_at
from rules import rule1, rule2, rule3
from text import words

RULES = (('rule 1', rule1), ('rule 2', rule2), ('rule 3', rule3))
KINDS = ('far', 'near', 'same', 'elsewhere')


def tally():
    return {kind: dict(right=0, none=0, contained=0, collateral=0) for kind in KINDS}


def line(label, counts, trials):
    made, asked = counts['far']['right'] + counts['near']['right'], 2 * trials
    total = sum(sum(c.values()) for c in counts.values())
    collateral = sum(c['collateral'] for c in counts.values())
    wrong = collateral + sum(c['contained'] for c in counts.values())
    record = dict(right=made, asked=asked, share=round(made / asked, 4), collateral=collateral, wrong=wrong, trials=total, outcomes=counts)
    text = (f'  {label:<34} right {100 * made / asked:.1f}% ({made}/{asked})  collateral {collateral}/{total}  wrong changes {wrong}/{total}  '
            + '  '.join(f'{k}: {c["right"]}/{c["none"]}/{c["contained"]}/{c["collateral"]}' for k, c in counts.items()))
    return record, text


def main():
    trials = json.loads(Path(sys.argv[1]).read_text())['trials']
    runs = {(run['arm'], run['id']): run for run in map(json.loads, Path(sys.argv[2]).read_text().splitlines())}
    leaned = {(run['id'], tuple(run['words'])): run['text'] for run in map(json.loads, Path(sys.argv[3]).read_text().splitlines())}
    out = Path(sys.argv[4]); out.mkdir(parents=True, exist_ok=True)
    summary, lines = {}, []

    def heard(trial, shown, kind, lean):
        """The correction as heard: plainly, or leaned toward the shown window."""
        if not lean:
            return words(runs['S', trial['id']]['text'])
        tokens = list(shown)
        if kind != 'same' and trial['target'] < len(tokens):
            tokens[trial['target']] = trial[kind]
        return words(leaned[trial['id'], tuple(listed(tokens))])

    def run_policy(chosen, delay, lean, rule, leaning_delay):
        """Outcomes when the rule decides on the text typed `delay` seconds into
        the next utterance (None: the phrase and `after` more words, complete),
        with corrections leaned toward the text typed at `leaning_delay`."""
        counts = tally()
        for index, trial in enumerate(chosen):
            run = runs['P', trial['id']]
            final = words(run['text'])

            def typed_of(a_trial, a_run):
                if delay is None:
                    return words(a_run['text'])[:a_trial['last'] + 1 + a_trial['after']]
                return words(typed_at(a_run, delay))
            typed = typed_of(trial, run)
            shown = surface(run['text'])[:trial['last'] + 1 + trial['after']] if leaning_delay is None else surface(typed_at(run, leaning_delay))
            for kind in ('far', 'near', 'same'):
                document = planted(final, trial, kind)
                counts[kind][judge(rule, planted(typed, trial, kind), document, final,
                                   heard(trial, shown, kind, lean), trial['first'], trial['last'], kind == 'same')[0]] += 1
            other = chosen[(index + 7) % len(chosen)]
            other_run = runs['P', other['id']]
            other_typed = typed_of(other, other_run)
            other_final = words(other_run['text'])
            counts['elsewhere'][judge(rule, other_typed, other_final, other_final,
                                      words(runs['S', trial['id']]['text']), None, None, True)[0]] += 1
        return counts

    for name, subsets in (('all', ('dev-clean', 'dev-other')), ('dev-clean', ('dev-clean',)), ('dev-other', ('dev-other',))):
        chosen = [t for t in trials if t['subset'] in subsets]
        if not chosen:
            continue
        lines.append(f'== Experiment 1, {name}: {len(chosen)} items, the window complete ==')
        for lean in (False, True):
            for label, rule in RULES:
                key = f'1 | {name} | {label}, {"leaned" if lean else "plain"}'
                summary[key], text = line(key.split(' | ')[2], run_policy(chosen, None, lean, rule, None), len(chosen))
                lines.append(text)
        lines.append('')
        lines.append(f'== Experiment 2, {name}: {len(chosen)} items, decided some time into the next utterance ==')
        complete = {delay: sum(words(typed_at(runs['P', t['id']], delay))[:t['last'] + 1] == words(runs['P', t['id']]['text'])[:t['last'] + 1]
                               for t in chosen) for delay in DELAYS}
        for delay, count in complete.items():
            summary[f'2 | {name} | window complete at {delay} s'] = dict(items=count, of=len(chosen), share=round(count / len(chosen), 4))
            lines.append(f'  typed text holds every word of the phrase {delay} s into the next utterance: {100 * count / len(chosen):.1f}% ({count}/{len(chosen)})')
        for label, rule in RULES[1:]:
            for lean in (False, True):
                for delay in DELAYS:
                    key = f'2 | {name} | {label}, {"leaned at the key press" if lean else "plain"}, decided at {delay} s'
                    summary[key], text = line(key.split(' | ')[2], run_policy(chosen, delay, lean, rule, 0), len(chosen))
                    lines.append(text)
            key = f'2 | {name} | {label}, leaned at the key press, decided on the complete window'
            summary[key], text = line(key.split(' | ')[2], run_policy(chosen, None, True, rule, 0), len(chosen))
            lines.append(text)
        lines.append('')
    revised = sum(bool(run['revised']) for (arm, _), run in runs.items() if arm == 'P')
    passages = sum(arm == 'P' for arm, _ in runs)
    summary['append only'] = dict(passagesWithARevisedPush=revised, passages=passages)
    lines.append(f'Passages where a push returned text the final text does not start with: {revised}/{passages}')
    (out / 'own-summary.json').write_text(json.dumps(summary, indent=1) + '\n')
    (out / 'own-tables.txt').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
