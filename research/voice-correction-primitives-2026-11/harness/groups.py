#!/usr/bin/env python3
"""Find, in the references alone, short clauses one speaker says in two or
more different utterances (PREREGISTRATION.md, Said again).

  groups.py OUT.json    with VOCO_CORRECTION_LAB naming the folder that holds libri-pc/

A clause is the words between two punctuation marks of the LibriSpeech-PC
reference (, . ; : ? ! or a dash) or an end of the utterance, 3 to 6 words
after normalization. Speakers of tests/fixtures/speech are left out.
"""
import json, os, re, sys
from pathlib import Path
from text import words

LAB = Path(os.environ['VOCO_CORRECTION_LAB'])
ROOT = Path(__file__).resolve().parents[3]
SUBSETS = ('test-clean', 'test-other', 'dev-clean', 'dev-other', 'train-clean-100')
MARK = re.compile(r'[,.;:?!—–]+|--+')


def clauses(text):
    """(first word index, words) of each clause, counted in normalized words."""
    at, found = 0, []
    for part in MARK.split(text):
        spoken = words(part)
        found.append((at, spoken)); at += len(spoken)
    return found


def main():
    fixtures = {item['speakerId'] for folder in ('tests/fixtures/speech', 'tests/fixtures/speech/adversarial')
                for item in json.loads((ROOT / folder / 'manifest.json').read_text())['fixtures']}
    groups = []
    for subset in SUBSETS:
        found = {}
        for line in open(LAB / 'libri-pc' / f'{subset}.json'):
            row = json.loads(line)
            key = Path(row['audio_filepath']).stem
            speaker = key.split('-')[0]
            if speaker in fixtures:
                continue
            for at, spoken in clauses(row['text']):
                if 3 <= len(spoken) <= 6:
                    said = found.setdefault((speaker, ' '.join(spoken)), {})
                    said.setdefault(key, dict(id=key, audio=row['audio_filepath'], reference=row['text'], seconds=row['duration'],
                                              first=at, last=at + len(spoken) - 1))
        for (speaker, clause), said in sorted(found.items()):
            if len(said) >= 2:
                groups.append(dict(subset=subset, speaker=speaker, clause=clause, utterances=[said[key] for key in sorted(said)][:3]))
    Path(sys.argv[1]).write_text(json.dumps(dict(fixtureSpeakers=sorted(fixtures), groups=groups), indent=1, ensure_ascii=False) + '\n')
    for subset in SUBSETS:
        chosen = [g for g in groups if g['subset'] == subset]
        print(subset, len(chosen), 'groups;', sum(len(g['utterances']) >= 3 for g in chosen), 'said three times;',
              len({g['speaker'] for g in chosen}), 'speakers;', round(sum(u['seconds'] for g in chosen for u in g['utterances']) / 60, 1), 'minutes')


if __name__ == '__main__':
    main()
