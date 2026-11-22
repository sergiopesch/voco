#!/usr/bin/env python3
"""Post hoc, not pre-registered: the rule against text the recognizer itself
typed. Arm M builds the typed text from the references; here it is arm P's
hypothesis, so the phrase said on its own only has to come out as it did in
the passage, right or wrong.

  consistency.py ITEMS.json RUNS.jsonl OUT.txt

An item is excluded when the passage hypothesis has no word aligned to the last
word before the phrase or the first word after it, so the phrase's place in it
is unknown, or when the phrase's place holds fewer than three words.
"""
import json, random, sys
from pathlib import Path
from rule import WINDOW, correct
from text import align, distance, words

AFTER = (0, 4, 8)


def main():
    plan = json.loads(Path(sys.argv[1]).read_text())
    runs = {(run['arm'], run['id']): run for run in map(json.loads, Path(sys.argv[2]).read_text().splitlines())}
    rng = random.Random(20261121)
    items = sorted(plan['items'], key=lambda item: item['id'])
    vocabulary = sorted({word for item in items for part in (item['previous'], item, item['next']) for word in words(part['reference'])})
    lines = ['Post hoc, not pre-registered. The typed text is the passage as the recognizer wrote it.', '']
    rows = {}
    for index, item in enumerate(items):
        before, phrase, after = (words(part['reference']) for part in (item['previous'], item, item['next']))
        typed = words(runs['P', item['id']]['text'])
        aligned = align(before + phrase + after, typed)
        left, right = aligned[len(before) - 1][0], aligned[len(before) + len(phrase)][0]
        heard = words(runs['S', item['id']]['text'])
        for group in (item['split'], 'all', item['split'] + ' ' + item['subset'], 'all ' + item['subset']):
            row = rows.setdefault(group, dict(items=0, excluded=0, same=0, far=dict(right=0, none=0, contained=0, collateral=0),
                                              near=dict(right=0, none=0, contained=0, collateral=0),
                                              sRight=0, pRight=0))
            row['items'] += 1
            row['sRight'] += heard == phrase
            if left is None or right is None or right - left - 1 < 3:
                row['excluded'] += 1
                continue
            first, last = left + 1, right - 1
            row['pRight'] += typed[first:last + 1] == phrase
            row['same'] += typed[first:last + 1] == heard
        if left is None or right is None or right - left - 1 < 3:
            continue
        first, last = left + 1, right - 1
        wanted = typed[:last + 1 + AFTER[index % 3]]
        target = rng.randrange(first + 1, last)
        word = wanted[target]
        far = rng.choice(vocabulary)
        while far == word or far in (wanted[target - 1], wanted[target + 1]):
            far = rng.choice(vocabulary)
        gaps = {other: distance(word, other) for other in vocabulary if other != word}
        near = rng.choice(sorted(other for other, gap in gaps.items() if gap == min(gaps.values())))
        for kind, planted in (('far', far), ('near', near)):
            changed = list(wanted); changed[target] = planted
            offset = max(0, len(changed) - WINDOW)
            result = correct(changed[offset:], heard)
            goal = wanted[offset:]
            a, b = first - offset, last - offset
            if result is None: outcome = 'none'
            elif result == goal: outcome = 'right'
            elif result[:a + 1] == goal[:a + 1] and result[len(result) - (len(goal) - b):] == goal[b:]: outcome = 'contained'
            else: outcome = 'collateral'
            for group in (item['split'], 'all', item['split'] + ' ' + item['subset'], 'all ' + item['subset']):
                rows[group][kind][outcome] += 1
    for group in ('dev', 'test', 'all', 'all test-clean', 'all test-other'):
        row = rows[group]; kept = row['items'] - row['excluded']
        trials = 2 * kept
        made = row['far']['right'] + row['near']['right']
        collateral = row['far']['collateral'] + row['near']['collateral']
        lines += [f'== {group}: {row["items"]} items, {row["excluded"]} excluded, {kept} kept ==',
                  f'Phrase on its own right against the reference (all items)   {100 * row["sRight"] / row["items"]:.1f}% ({row["sRight"]}/{row["items"]})',
                  f'Phrase in the passage right against the reference (kept)    {100 * row["pRight"] / kept:.1f}% ({row["pRight"]}/{kept})',
                  f'Phrase on its own written as in the passage (kept)          {100 * row["same"] / kept:.1f}% ({row["same"]}/{kept})',
                  '                 right   none   contained   collateral']
        lines += [f'  {kind:<10}     {row[kind]["right"]:>5}  {row[kind]["none"]:>5}  {row[kind]["contained"]:>9}  {row[kind]["collateral"]:>10}' for kind in ('far', 'near')]
        lines += [f'  right, of far and near    {100 * made / trials:.1f}% ({made}/{trials})',
                  f'  collateral                {100 * collateral / trials:.1f}% ({collateral}/{trials})', '']
    Path(sys.argv[3]).write_text('\n'.join(lines))
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
