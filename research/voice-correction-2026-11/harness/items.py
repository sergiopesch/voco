#!/usr/bin/env python3
"""Build the pre-registered items from the references alone (PREREGISTRATION.md, Data).

  items.py OUT.json    with VOCO_CORRECTION_LAB naming the folder that holds
                       libri-pc/{test-clean,test-other}.json
"""
import json, os, sys
from pathlib import Path

LAB = Path(os.environ['VOCO_CORRECTION_LAB'])


def main():
    items, resumes = [], []
    for subset in ('test-clean', 'test-other'):
        rows = {}
        for line in open(LAB / 'libri-pc' / f'{subset}.json'):
            row = json.loads(line)
            rows[Path(row['audio_filepath']).stem] = row
        speakers = sorted({int(key.split('-')[0]) for key in rows})
        split = {speaker: ('dev', 'test')[index % 2] for index, speaker in enumerate(speakers)}
        for key in sorted(rows):
            speaker, chapter, number = key.split('-')
            row = rows[key]
            base = dict(id=key, subset=subset, split=split[int(speaker)], audio=row['audio_filepath'],
                        reference=row['text'], seconds=row['duration'])
            if row['text'][0].islower():
                resumes.append(base)
            before, after = (f'{speaker}-{chapter}-{int(number) + step:04d}' for step in (-1, 1))
            if 3 <= len(row['text'].split()) <= 6 and before in rows and after in rows:
                items.append(dict(base, previous=dict(id=before, audio=rows[before]['audio_filepath'], reference=rows[before]['text']),
                                  next=dict(id=after, audio=rows[after]['audio_filepath'], reference=rows[after]['text'])))
    Path(sys.argv[1]).write_text(json.dumps(dict(items=items, resumes=resumes), indent=1, ensure_ascii=False) + '\n')
    print(len(items), 'items;', len(resumes), 'resume items;',
          {s: sum(i['split'] == s for i in items) for s in ('dev', 'test')})


if __name__ == '__main__':
    main()
