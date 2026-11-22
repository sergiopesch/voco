#!/usr/bin/env python3
"""Trials against text the recognizer itself typed, from the first study's
runs (research/voice-correction-2026-11): the typed text is its passage
hypothesis, with one word planted inside the phrase's place.

  own.py ITEMS.json RUNS.jsonl OUT.json

An item is left out when the passage hypothesis has no word aligned to the last
word before the phrase or the first word after it, or the phrase's place holds
fewer than three words. Seed 20261122; the planted words come from the
vocabulary of the items' references.
"""
import json, random, re, sys
from pathlib import Path
from text import align, distance, words

AFTER = (0, 4, 8)
SEED = 20261122


def surface(text):
    """A text's tokens without the punctuation around them, for words(token) non-empty."""
    return [re.sub(r"^[^\w']+|[^\w']+$", '', token) for token in text.split() if words(token)]


def main():
    plan = json.loads(Path(sys.argv[1]).read_text())
    runs = {(run['arm'], run['id']): run for run in map(json.loads, Path(sys.argv[2]).read_text().splitlines())}
    items = sorted(plan['items'], key=lambda item: item['id'])
    vocabulary = sorted({word for item in items for part in (item['previous'], item, item['next']) for word in words(part['reference'])})
    rng = random.Random(SEED)
    trials, left_out = [], 0
    for index, item in enumerate(items):
        before, phrase, after = (words(part['reference']) for part in (item['previous'], item, item['next']))
        text = runs['P', item['id']]['text']
        typed, shown = words(text), surface(text)
        assert len(typed) == len(shown)
        aligned = align(before + phrase + after, typed)
        left, right = aligned[len(before) - 1][0], aligned[len(before) + len(phrase)][0]
        if left is None or right is None or right - left - 1 < 3:
            left_out += 1
            continue
        first, last = left + 1, right - 1
        end = last + 1 + AFTER[index % 3]
        target = rng.randrange(first + 1, last)
        word = typed[target]
        far = rng.choice(vocabulary)
        while far == word or far in (typed[target - 1], typed[target + 1]):
            far = rng.choice(vocabulary)
        gaps = {other: distance(word, other) for other in vocabulary if other != word}
        near = rng.choice(sorted(other for other, gap in gaps.items() if gap == min(gaps.values())))
        trials.append(dict(id=item['id'], split=item['split'], subset=item['subset'], typed=typed[:end], shown=shown[:end],
                           first=first, last=last, target=target, far=far, near=near))
    Path(sys.argv[3]).write_text(json.dumps(dict(seed=SEED, leftOut=left_out, trials=trials), indent=1, ensure_ascii=False) + '\n')
    print(len(trials), 'trials items;', left_out, 'left out')


if __name__ == '__main__':
    main()
