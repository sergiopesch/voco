#!/usr/bin/env python3
"""Build the items from the references alone (PREREGISTRATION.md, Data).

  items.py OUT.json    with VOCO_CORRECTION_LAB naming the folder that holds
                       libri-pc/{dev-clean,dev-other}.json

An item is the first study's: an utterance of 3 to 6 words whose previous and
next utterances exist. Speakers of tests/fixtures/speech and utterances the
second study's said-again groups used are left out.
"""
import json, os, sys
from pathlib import Path

LAB = Path(os.environ['VOCO_CORRECTION_LAB'])
ROOT = Path(__file__).resolve().parents[3]
SUBSETS = ('dev-clean', 'dev-other')


def main():
    fixtures = {path.name.split('-')[0] for path in (ROOT / 'tests/fixtures/speech').glob('*-*-*.wav')}
    said = json.loads((ROOT / 'research/voice-correction-primitives-2026-11/results/said-groups.json').read_text())['groups']
    used = {utterance['id'] for group in said for utterance in group['utterances']}
    items, left = [], dict(fixtureSpeaker=0, saidAgain=0)
    for subset in SUBSETS:
        rows = {}
        for line in open(LAB / 'libri-pc' / f'{subset}.json'):
            row = json.loads(line)
            rows[Path(row['audio_filepath']).stem] = row
        for key in sorted(rows):
            speaker, chapter, number = key.split('-')
            row = rows[key]
            before, after = (f'{speaker}-{chapter}-{int(number) + step:04d}' for step in (-1, 1))
            if not (3 <= len(row['text'].split()) <= 6 and before in rows and after in rows):
                continue
            if speaker in fixtures:
                left['fixtureSpeaker'] += 1
            elif {before, key, after} & used:
                left['saidAgain'] += 1
            else:
                items.append(dict(id=key, subset=subset, audio=row['audio_filepath'], reference=row['text'], seconds=row['duration'],
                                  previous=dict(id=before, audio=rows[before]['audio_filepath'], reference=rows[before]['text'], seconds=rows[before]['duration']),
                                  next=dict(id=after, audio=rows[after]['audio_filepath'], reference=rows[after]['text'], seconds=rows[after]['duration'])))
    Path(sys.argv[1]).write_text(json.dumps(dict(leftOut=left, items=items), indent=1, ensure_ascii=False) + '\n')
    print(len(items), 'items;', {s: sum(i['subset'] == s for i in items) for s in SUBSETS}, 'left out:', left,
          'passage minutes:', round(sum(i['seconds'] + i['previous']['seconds'] + i['next']['seconds'] for i in items) / 60, 1))


if __name__ == '__main__':
    main()
