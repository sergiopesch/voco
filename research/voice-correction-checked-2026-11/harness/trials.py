#!/usr/bin/env python3
"""Trials against text the recognizer itself typed (PREREGISTRATION.md, Trials):
the typed text is the passage as the worker wrote it, with one word planted
inside the phrase's place.

  trials.py ITEMS.json RUNS.jsonl OUT.json

An item is left out when the passage as recognized has no word aligned to the
last word before the phrase or the first word after it, or the phrase's place
holds fewer than three words. Seed 20261123; the planted words come from the
vocabulary of the items' references.
"""
import json, random, sys
from pathlib import Path
from core import AFTER, surface
from text import align, distance, words

SEED = 20261123


def main():
    items = sorted(json.loads(Path(sys.argv[1]).read_text())['items'], key=lambda item: item['id'])
    runs = {(run['arm'], run['id']): run for run in map(json.loads, Path(sys.argv[2]).read_text().splitlines())}
    vocabulary = sorted({word for item in items for part in (item['previous'], item, item['next']) for word in words(part['reference'])})
    rng = random.Random(SEED)
    trials, left_out = [], 0
    for index, item in enumerate(items):
        before, phrase, after = (words(part['reference']) for part in (item['previous'], item, item['next']))
        text = runs['P', item['id']]['text']
        typed = words(text)
        assert len(typed) == len(surface(text))
        aligned = align(before + phrase + after, typed)
        left, right = aligned[len(before) - 1][0], aligned[len(before) + len(phrase)][0]
        if left is None or right is None or right - left - 1 < 3:
            left_out += 1
            continue
        first, last = left + 1, right - 1
        target = rng.randrange(first + 1, last)
        word = typed[target]
        far = rng.choice(vocabulary)
        while far == word or far in (typed[target - 1], typed[target + 1]):
            far = rng.choice(vocabulary)
        gaps = {other: distance(word, other) for other in vocabulary if other != word}
        near = rng.choice(sorted(other for other, gap in gaps.items() if gap == min(gaps.values())))
        trials.append(dict(id=item['id'], subset=item['subset'], first=first, last=last, target=target, far=far, near=near,
                           after=AFTER[index % 3]))
    Path(sys.argv[3]).write_text(json.dumps(dict(seed=SEED, leftOut=left_out, trials=trials), indent=1, ensure_ascii=False) + '\n')
    print(len(trials), 'trials items;', left_out, 'left out')


if __name__ == '__main__':
    main()
