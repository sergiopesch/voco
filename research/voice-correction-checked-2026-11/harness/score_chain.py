#!/usr/bin/env python3
"""Score the chain end to end (PREREGISTRATION.md, Experiment 3).

  score_chain.py CHAIN.json FIELD_RUNS_DIR OUT_DIR

For each field the chain ran in: what the ladder reported, what the field held
when read back without the accessibility interface, and whether the field's
words at the end are the passage as recognized. Needs no session: it reads the
field harness's result files. Writes chain-summary.json and chain-tables.txt.
"""
import json, sys
from pathlib import Path
from text import words

CASES = ('gedit', 'chromium-textarea', 'gnome-terminal')


def norm(text):
    """The field harness's comparison: a no-break space is a space, and line
    ends after the text don't count."""
    return None if text is None else text.replace(' ', ' ').rstrip('\n')


def main():
    plan = json.loads(Path(sys.argv[1]).read_text())
    drawn = plan['drawn']
    by_hash = {entry['sha256']: entry for entry in drawn if entry['change']}
    runs = {}
    for path in sorted(Path(sys.argv[2]).glob('*.trial-*.json')):
        run = json.loads(path.read_text())
        entry = by_hash.get(run.get('trial', {}).get('sha256'))
        if entry is not None and 'ladder' in run and 'independent_after' in run:
            runs.setdefault(run['case'], {})[entry['id'], entry['kind']] = run
    out = Path(sys.argv[3]); out.mkdir(parents=True, exist_ok=True)
    made = [entry for entry in drawn if entry['change']]
    summary = dict(drawn=len(drawn), ruleMadeAChange=len(made), ruleRightInWords=sum(e['right'] for e in made),
                   ruleExact=sum(e.get('exact', False) for e in made), cases={})
    lines = [f"{len(drawn)} trials drawn; the rule made a change in {len(made)}, the right one in {summary['ruleRightInWords']}, "
             f"and with the passage's exact text in {summary['ruleExact']}", '']
    for case in CASES:
        got = runs.get(case, {})
        counts = dict(runs=len(got), missing=len(made) - len(got), reports={}, classes=dict(correct=0, untouched=0, damaged=0, unverified=0),
                      dishonest=0, unfaithful=0, right=0, exact=0)
        for entry in made:
            run = got.get((entry['id'], entry['kind']))
            if run is None:
                continue
            full = norm(run['independent_after'].get('full'))
            request, expected = run['request'], norm(run['trial']['expected'])
            report = run['ladder'].get('outcome')
            label = report + (f", rung {run['ladder']['rung']}" if run['ladder'].get('rung') else '')
            counts['reports'][label] = counts['reports'].get(label, 0) + 1
            kind = ('unverified' if full is None else 'correct' if full == expected
                    else 'untouched' if full == norm(request['pasted'] + request['rest']) else 'damaged')
            counts['classes'][kind] += 1
            if report == 'CHANGED-VERIFIED' and kind != 'correct':
                counts['dishonest'] += 1; counts['unfaithful'] += 1
            if full is not None:
                counts['right'] += words(full) == words(entry['wanted'])
                counts['exact'] += full == norm(entry['wanted'])
        counts['of'] = len(drawn)
        summary['cases'][case] = counts
        lines += [f'== {case}: {counts["runs"]} runs' + (f', {counts["missing"]} missing' if counts['missing'] else '') + ' ==',
                  '  the ladder reported: ' + ', '.join(f'{label} {n}' for label, n in sorted(counts['reports'].items())),
                  '  the field read back: ' + ', '.join(f'{label} {n}' for label, n in counts['classes'].items()),
                  f"  reported changed and verified on a field that was not the text asked for: {counts['unfaithful']}",
                  f"  right end to end, the field's words the passage as recognized: {100 * counts['right'] / len(drawn):.1f}% ({counts['right']}/{len(drawn)})",
                  f"  the passage's exact text: {100 * counts['exact'] / len(drawn):.1f}% ({counts['exact']}/{len(drawn)})", '']
    cases = summary['cases'].values()
    summary['bars'] = dict(safe=all(c['classes']['damaged'] == 0 and c['classes']['unverified'] == 0 for c in cases),
                           honest=all(c['dishonest'] == 0 for c in cases), faithful=all(c['unfaithful'] == 0 for c in cases),
                           rightEndToEnd=all(c['missing'] == 0 and c['right'] / len(drawn) >= .8 for c in cases))
    lines.append('Bars on the chain: ' + ', '.join(f'{name} {"met" if met else "not met"}' for name, met in summary['bars'].items()))
    (out / 'chain-summary.json').write_text(json.dumps(summary, indent=1) + '\n')
    (out / 'chain-tables.txt').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
