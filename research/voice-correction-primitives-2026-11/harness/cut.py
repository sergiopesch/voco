#!/usr/bin/env python3
"""Find where each clause starts and ends in its recording (PREREGISTRATION.md,
Study A): a cut in the middle of a pause between the clause and its neighbour.

  cut.py CHOSEN.json RUNS.jsonl OUT.json

Needs the recordings and the dictation pass's word times (arm U of RUNS.jsonl),
not the recognizer. A pause is a run of 20 ms frames, 10 ms apart, each at
least 12 dB below the recording's median frame, at least 60 ms long. The
recognizer writes a word some time after it is said: on clauses outside the
study, the pause before a word lay 150 to 800 ms before the word's start time.
So the cut before a word is the middle of the longest pause whose middle lies
in that span before the word's start time. An end of the recording needs no
cut. A clause without such a pause on a side that needs one, whose first word
or the word after it the dictation pass didn't write, or shorter than 0.3 s,
is left out, before any correction is recognized.
"""
import json, os, sys
from pathlib import Path
import numpy as np
from text import align, norm, words

RATE, FRAME, HOP = 16000, 320, 160
LONGEST, EARLIEST, LATEST = 6, 800, 150   # frames; ms before the next word's start time


def levels(audio, hop=HOP):
    count = (len(audio) - FRAME) // hop + 1
    index = np.arange(FRAME)[None, :] + hop * np.arange(count)[:, None]
    return 10 * np.log10(np.square(audio[index].astype(np.float64)).mean(1) + 1e-12)


def pauses(audio):
    """(first frame, frame after the last) of each run of quiet frames."""
    energy = levels(audio); floor = float(np.median(levels(audio, FRAME))) - 12
    found, start = [], None
    for frame, level in enumerate(energy):
        if level <= floor:
            start = frame if start is None else start
        elif start is not None:
            found.append((start, frame)); start = None
    if start is not None:
        found.append((start, len(energy)))
    return found


def before(word_start_ms, quiet):
    """The sample in the middle of the longest pause before a word, or None."""
    fits = [(b - a, a, b) for a, b in quiet if b - a >= LONGEST
            and word_start_ms - EARLIEST <= (a + b) * 5 <= word_start_ms - LATEST]
    if not fits:
        return None
    _, a, b = max(fits)
    return (a + b) * HOP // 2


def main():
    from lab import load
    plan = json.loads(Path(sys.argv[1]).read_text())
    timed_by = {r['id']: r['words'] for r in map(json.loads, Path(sys.argv[2]).read_text().splitlines()) if r['arm'] == 'U'}
    cuts, reasons = {}, {}
    for group in plan['groups']:
        for utterance in group['utterances']:
            audio = load(utterance['audio'])
            timed = [(norm(word), start) for word, start, _ in timed_by[utterance['id']] if norm(word)]
            reference = words(utterance['reference'])
            aligned = align(reference, [word for word, _ in timed])
            first, last = utterance['first'], utterance['last']
            quiet = pauses(audio)
            reason, start, end = None, 0, len(audio)
            if first > 0:
                place = aligned[first][0]
                point = None if place is None else before(timed[place][1], quiet)
                if place is None: reason = 'first word not written'
                elif point is None: reason = 'no pause before'
                else: start = point
            if not reason and last < len(reference) - 1:
                place = aligned[last + 1][0]
                point = None if place is None else before(timed[place][1], quiet)
                if place is None: reason = 'word after not written'
                elif point is None: reason = 'no pause after'
                else: end = point
            if not reason and end - start < RATE * 0.3:
                reason = 'shorter than 0.3 s'
            if reason:
                reasons[reason] = reasons.get(reason, 0) + 1
            cuts[f"{utterance['id']}:{first}"] = dict(id=utterance['id'], first=first, reason=reason, startSample=int(start),
                                                      endSample=int(end), seconds=round((end - start) / RATE, 3))
    Path(sys.argv[3]).write_text(json.dumps(dict(cuts=cuts, leftOut=reasons), indent=1) + '\n')
    print(len(cuts), 'clauses;', sum(c['reason'] is None for c in cuts.values()), 'cut;', reasons)


if __name__ == '__main__':
    main()
