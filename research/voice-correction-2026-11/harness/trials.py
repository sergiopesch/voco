#!/usr/bin/env python3
"""Build arm M's trials from the references alone (PREREGISTRATION.md, The
correction rule and its trials).

  trials.py ITEMS.json OUT.json    with VOCO_CORRECTION_LAB naming the folder
                                   that holds libri-pc/{test-clean,test-other}.json
"""
import json, os, random, sys
from pathlib import Path
from text import distance, words

LAB = Path(os.environ['VOCO_CORRECTION_LAB'])
SEED = 20261121
AFTER = (0, 4, 8)


def main():
    rng = random.Random(SEED)
    vocabulary = sorted({word for subset in ('test-clean', 'test-other')
                         for line in open(LAB / 'libri-pc' / f'{subset}.json')
                         for word in words(json.loads(line)['text'])})
    items = sorted(json.loads(Path(sys.argv[1]).read_text())['items'], key=lambda item: item['id'])
    trials = []
    for index, item in enumerate(items):
        before, phrase = words(item['previous']['reference']), words(item['reference'])
        typed = before + phrase + words(item['next']['reference'])[:AFTER[index % 3]]
        trial = dict(id=item['id'], split=item['split'], typed=typed, first=len(before), last=len(before) + len(phrase) - 1)
        if len(phrase) >= 3:
            target = rng.randrange(1, len(phrase) - 1)
            word, neighbours = phrase[target], (phrase[target - 1], phrase[target + 1])
            far = rng.choice(vocabulary)
            while far == word or far in neighbours:
                far = rng.choice(vocabulary)
            gaps = {other: distance(word, other) for other in vocabulary if other != word}
            closest = min(gaps.values())
            near = rng.choice(sorted(other for other, gap in gaps.items() if gap == closest))
            trial.update(target=len(before) + target, far=far, near=near)
        trials.append(trial)
    chapter = lambda trial: trial['id'].rsplit('-', 1)[0]
    for index, trial in enumerate(trials):
        other = next(trials[(index + step) % len(trials)] for step in range(1, len(trials))
                     if chapter(trials[(index + step) % len(trials)]) != chapter(trial))
        trial['elsewhere'] = other['id']
    Path(sys.argv[2]).write_text(json.dumps(dict(seed=SEED, vocabularyWords=len(vocabulary), trials=trials),
                                            indent=1, ensure_ascii=False) + '\n')
    print(len(trials), 'items;', sum('target' in t for t in trials), 'with an interior word;', len(vocabulary), 'vocabulary words')


if __name__ == '__main__':
    main()
