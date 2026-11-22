#!/usr/bin/env python3
"""Two streams (PREREGISTRATION.md): the dictation's stream stays open while a
second stream hears the correction, and the dictation then goes on in the first.

  streams.py ITEMS.json OWN.json OUT.jsonl [--splits test] [--limit N]

Lab access to the pinned recognizer, opened as the worker opens it, with VOCO's
look-ahead. Appends one line per item and skips what OUT.jsonl holds.
"""
import argparse, json
from pathlib import Path
import numpy as np
from lab import LAB, PACKET, RATE, asr, feed, load

QUIET = (0, 0.4, 0.8, 1.2)   # seconds of digital silence after the tap


def quiet(stream, seconds):
    """The text after each step of silence up to `seconds`, by seconds fed."""
    texts, fed = {0: stream.last}, 0
    silence = np.zeros(PACKET, np.float32)
    while fed < round(seconds * 10):
        stream.push(silence); fed += 1
        text = stream.drain()
        if fed / 10 in QUIET:
            texts[fed / 10] = text
    return texts


def passage(item):
    previous, phrase, following = (load(part['audio']) for part in (item['previous'], item, item['next']))
    first = asr.Stream()
    feed(first, np.concatenate([previous, phrase]))
    at_tap = quiet(first, QUIET[-1])
    second = asr.Stream(); feed(second, phrase); correction = second.finish()
    feed(first, following)
    return dict(kind='passage', id=item['id'], atTap={str(k): v for k, v in at_tap.items()}, correction=correction, final=first.finish())


def resume(item, clip):
    """A resume item after its previous utterance: in one go, and with a tap,
    0.8 s of silence and a correction on the second stream between them."""
    speaker, chapter, number = item['id'].split('-')
    before = Path(item['audio']).with_name(f'{speaker}-{chapter}-{int(number) - 1:04d}.flac')
    if not (LAB / 'LibriSpeech' / before).exists():
        return dict(kind='resume', id=item['id'], skipped='no previous utterance')
    previous, own = load(before), load(item['audio'])
    whole = asr.Stream(); feed(whole, np.concatenate([previous, own])); together = whole.finish()
    first = asr.Stream(); feed(first, previous)
    at_tap = quiet(first, 0.8)[0.8]
    second = asr.Stream(); feed(second, clip); second.finish()
    feed(first, own)
    return dict(kind='resume', id=item['id'], previous=str(before), together=together, atTap=at_tap, final=first.finish())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('items'); parser.add_argument('own'); parser.add_argument('out')
    parser.add_argument('--splits', default='test'); parser.add_argument('--limit', type=int)
    parser.add_argument('--only', choices=['passage', 'resume'])
    args = parser.parse_args()
    plan = json.loads(Path(args.items).read_text())
    kept = {trial['id'] for trial in json.loads(Path(args.own).read_text())['trials']}
    splits = args.splits.split(',')
    items = [item for item in sorted(plan['items'], key=lambda i: i['id']) if item['split'] in splits and item['id'] in kept]
    resumes = [item for item in sorted(plan['resumes'], key=lambda i: i['id']) if item['split'] in splits]
    if args.limit:
        items, resumes = items[:args.limit], resumes[:args.limit]
    out = Path(args.out)
    done = {(r['kind'], r['id']) for r in map(json.loads, out.read_text().splitlines())} if out.exists() else set()
    clip = load(plan['items'][0]['audio'])
    work = ([] if args.only == 'resume' else [('passage', item) for item in items]) + \
           ([] if args.only == 'passage' else [('resume', item) for item in resumes])
    with out.open('a') as log:
        for index, (kind, item) in enumerate(work):
            if (kind, item['id']) in done:
                continue
            record = passage(item) if kind == 'passage' else resume(item, clip)
            log.write(json.dumps(record, ensure_ascii=False) + '\n'); log.flush()
            if index % 25 == 0:
                print(index, len(work), kind, flush=True)
    print('done', flush=True)


if __name__ == '__main__':
    main()
