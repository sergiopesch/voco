#!/usr/bin/env python3
"""Score the runs as PREREGISTRATION.md fixes; needs neither recognizer nor audio.

  score.py ITEMS.json TRIALS.json RUNS.jsonl OUT_DIR [--tolerance N] [--splits dev]

Writes summary.json and tables.txt. --tolerance and --splits are for the
exploratory variants on dev; the pre-registered run uses neither.
"""
import argparse, json, re, statistics
from pathlib import Path
from rule import WINDOW, correct
from text import align, words

CLOSE = re.compile(r'["”’)\]]+$')
KINDS = ('far', 'near', 'same', 'elsewhere')


def ends_sentence(text):
    stripped = CLOSE.sub('', text.strip())
    return stripped[-1:] in ('.', '?', '!')


def starts_capital(text):
    letter = next((c for c in text if c.isalpha()), '')
    return letter.isupper()


def share(part, whole):
    return dict(count=part, of=whole, share=round(part / whole, 4) if whole else None)


def passage_right(item, text):
    before, phrase, after = (words(part['reference']) for part in (item['previous'], item, item['next']))
    aligned = align(before + phrase + after, words(text))[len(before):len(before) + len(phrase)]
    return all(op == 'ok' for _, op in aligned) and all(b[0] == a[0] + 1 for a, b in zip(aligned, aligned[1:]))


def outcome(kind, trial, by_id, heard, tolerance):
    """One trial's outcome and whether the phrase's own anchors were heard."""
    source = by_id[trial['elsewhere']] if kind == 'elsewhere' else trial
    reference = source['typed']
    typed = list(reference)
    if kind in ('far', 'near'):
        typed[trial['target']] = trial[kind]
    offset = max(0, len(typed) - WINDOW)
    result = correct(typed[offset:], heard, tolerance)
    if result is None:
        return 'right' if kind in ('same', 'elsewhere') else 'none'
    wanted = reference[offset:]
    if result == wanted:
        return 'right'
    if kind == 'elsewhere':
        return 'collateral'
    first, last = trial['first'] - offset, trial['last'] - offset
    contained = result[:first + 1] == wanted[:first + 1] and result[len(result) - (len(wanted) - last):] == wanted[last:]
    return 'contained' if contained else 'collateral'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('items'); parser.add_argument('trials'); parser.add_argument('runs'); parser.add_argument('out')
    parser.add_argument('--tolerance', type=int, default=1)
    parser.add_argument('--splits', default='dev,test,all')
    args = parser.parse_args()
    plan = json.loads(Path(args.items).read_text())
    trials = json.loads(Path(args.trials).read_text())['trials']
    by_id = {trial['id']: trial for trial in trials}
    runs = {(run['arm'], run['id']): run for run in map(json.loads, Path(args.runs).read_text().splitlines())}
    summary = {}
    for split in args.splits.split(','):
        items = [item for item in plan['items'] if split in ('all', item['split'])]
        resumes = [item for item in plan['resumes'] if split in ('all', item['split'])]
        missing = [key for key in [('S', i['id']) for i in items] + [('P', i['id']) for i in items] + [('R', i['id']) for i in resumes]
                   if key not in runs]
        if missing:
            raise SystemExit(f'{len(missing)} sessions of {split} have not run')
        table = {'P right': {'S right': 0, 'S wrong': 0}, 'P wrong': {'S right': 0, 'S wrong': 0}}
        lower = capital = open_end = closed = right = interior_same = 0
        wrong_anchor = wrong_interior = 0
        by_length = {}
        counts = {kind: {name: 0 for name in ('right', 'none', 'contained', 'collateral')} for kind in KINDS}
        for item in items:
            text = runs['S', item['id']]['text']
            heard, reference = words(text), words(item['reference'])
            s_right = heard == reference
            p_right = passage_right(item, runs['P', item['id']]['text'])
            table['P right' if p_right else 'P wrong']['S right' if s_right else 'S wrong'] += 1
            length = by_length.setdefault(len(item['reference'].split()), [0, 0])
            length[0] += s_right; length[1] += 1
            if item['reference'][0].islower():
                lower += 1; capital += starts_capital(text)
            if not ends_sentence(item['reference']):
                open_end += 1; closed += ends_sentence(text)
            if s_right:
                right += 1
                interior_same += text.split()[1:-1] == item['reference'].split()[1:-1]
            elif heard[:1] != reference[:1] or heard[-1:] != reference[-1:]:
                wrong_anchor += 1
            else:
                wrong_interior += 1
            for kind in KINDS:
                counts[kind][outcome(kind, by_id[item['id']], by_id, heard, args.tolerance)] += 1
        tails = sorted(runs['S', item['id']]['tailMs'] for item in items)
        changed = counts['far']['right'] + counts['near']['right']
        collateral = sum(counts[kind]['collateral'] for kind in KINDS)
        p_wrong, p_right = table['P wrong'], table['P right']
        summary[split] = dict(
            items=len(items),
            sRight=share(right, len(items)),
            passageBySelf=table,
            sRightAmongPWrong=share(p_wrong['S right'], sum(p_wrong.values())),
            sRightAmongPRight=share(p_right['S right'], sum(p_right.values())),
            sRightByWords={str(n): share(*by_length[n]) for n in sorted(by_length)},
            sWrong=dict(anchorWrong=wrong_anchor, onlyInteriorWrong=wrong_interior),
            capitalWhereReferenceIsLower=share(capital, lower),
            sentenceEndWhereReferenceHasNone=share(closed, open_end),
            interiorFormSameAmongSRight=share(interior_same, right),
            resumedStartsWithCapital=share(sum(starts_capital(runs['R', i['id']]['text']) for i in resumes), len(resumes)),
            tailMs=dict(median=round(statistics.median(tails), 1), p95=round(tails[int(len(tails) * .95)], 1)),
            rule=dict(tolerance=args.tolerance, outcomes=counts,
                      rightOfFarAndNear=share(changed, 2 * len(items)),
                      collateralOfAll=share(collateral, 4 * len(items))),
        )
    test = summary.get('test')
    if test and args.tolerance == 1:
        safe = test['rule']['collateralOfAll']['share'] <= .01
        rate = test['rule']['rightOfFarAndNear']['share']
        summary['bars'] = dict(safe=safe, useful=safe and rate >= .8, magic=safe and rate >= .95)
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    (out / 'summary.json').write_text(json.dumps(summary, indent=1) + '\n')
    lines = []
    pct = lambda s: 'n/a' if s['share'] is None else f"{100 * s['share']:.1f}% ({s['count']}/{s['of']})"
    for split, s in summary.items():
        if split == 'bars':
            lines += ['Bars on test: ' + ', '.join(f'{name} {"met" if met else "not met"}' for name, met in s.items()), '']
            continue
        t = s['passageBySelf']
        lines += [f'== {split}: {s["items"]} items ==',
                  f'Phrase on its own written right          {pct(s["sRight"])}',
                  f'  where the passage had it wrong         {pct(s["sRightAmongPWrong"])}',
                  f'  where the passage had it right         {pct(s["sRightAmongPRight"])}',
                  f'  passage right: on its own right {t["P right"]["S right"]}, wrong {t["P right"]["S wrong"]};'
                  f' passage wrong: right {t["P wrong"]["S right"]}, wrong {t["P wrong"]["S wrong"]}',
                  '  by words in the phrase                 ' + ', '.join(f'{n}: {pct(v)}' for n, v in s['sRightByWords'].items()),
                  f'  wrong on its own: first or last word wrong {s["sWrong"]["anchorWrong"]}, only words between them {s["sWrong"]["onlyInteriorWrong"]}',
                  f'Starts with a capital where the reference does not   {pct(s["capitalWhereReferenceIsLower"])}',
                  f'Ends a sentence where the reference does not         {pct(s["sentenceEndWhereReferenceHasNone"])}',
                  f'Interior words in the reference\'s form, among right  {pct(s["interiorFormSameAmongSRight"])}',
                  f'Resumed mid-sentence, starts with a capital          {pct(s["resumedStartsWithCapital"])}',
                  f'Last packet to final text, ms            median {s["tailMs"]["median"]}, p95 {s["tailMs"]["p95"]}',
                  f'Rule (tolerance {s["rule"]["tolerance"]}):       right   none   contained   collateral']
        lines += [f'  {kind:<10}                  {c["right"]:>5}  {c["none"]:>5}  {c["contained"]:>9}  {c["collateral"]:>10}'
                  for kind, c in s['rule']['outcomes'].items()]
        lines += [f'  right, of far and near        {pct(s["rule"]["rightOfFarAndNear"])}',
                  f'  collateral, of all trials     {pct(s["rule"]["collateralOfAll"])}', '']
    (out / 'tables.txt').write_text('\n'.join(lines))
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
