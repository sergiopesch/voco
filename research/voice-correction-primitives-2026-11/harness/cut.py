#!/usr/bin/env python3
"""Find where each clause starts and ends in its recording (PREREGISTRATION.md,
Said again): a cut at a quiet point between the clause and its neighbours.

  VOCO_LAB_CONTEXT=1 cut.py GROUPS.json OUT.json

As the pause study cut between two words: the quietest 20 ms frame between the
recognizer's times for the two words, moved 160 ms earlier and widened by 80 ms
either way, which must be at least 12 dB below the recording's median frame.
An end of the recording needs no cut. A clause without such a quiet point on a
side that needs one, or whose neighbours the timing pass didn't recognize, is
left out, before any correction is recognized.
"""
import json, os, sys
from pathlib import Path
os.environ['VOCO_LAB_CONTEXT'] = '1'
import numpy as np
from lab import RATE, asr, feed, load
from text import align, norm, words

FRAME = 320


def levels(audio, hop=160):
    count = (len(audio) - FRAME) // hop + 1
    index = np.arange(FRAME)[None, :] + hop * np.arange(count)[:, None]
    return 10 * np.log10(np.square(audio[index].astype(np.float64)).mean(1) + 1e-12)


def quiet_point(energy, median, after_ms, before_ms):
    """The sample of the quietest frame between two word times, or None."""
    low, high = (after_ms - 160 - 80) * 16, (before_ms - 160 + 80) * 16
    first, last = max(0, low // 160), min(len(energy) - 1, high // 160)
    if last <= first:
        return None
    frame = first + int(np.argmin(energy[first:last]))
    return int(frame * 160 + 160) if energy[frame] <= median - 12 else None


def main():
    plan = json.loads(Path(sys.argv[1]).read_text())
    cuts, reasons = {}, {}
    for number, group in enumerate(plan['groups']):
        for utterance in group['utterances']:
            audio = load(utterance['audio'])
            stream = asr.Stream(word_times=True); feed(stream, audio); stream.finish()
            timed = [(norm(word), start, end) for word, start, end in stream.words if norm(word)]
            reference = words(utterance['reference'])
            aligned = align(reference, [word for word, _, _ in timed])
            first, last = utterance['first'], utterance['last']
            energy = levels(audio); median = float(np.median(levels(audio, FRAME)))
            key = f"{utterance['id']}:{first}"
            reason = None
            start, end = 0, len(audio)
            inside = [aligned[i] for i in (first, last)]
            if any(place[0] is None for place in inside):
                reason = 'clause edge not recognized'
            if not reason and first > 0:
                before = aligned[first - 1]
                point = None if before[0] is None else quiet_point(energy, median, timed[before[0]][2], timed[inside[0][0]][1])
                if point is None: reason = 'no quiet point before'
                else: start = point
            if not reason and last < len(reference) - 1:
                after = aligned[last + 1]
                point = None if after[0] is None else quiet_point(energy, median, timed[inside[1][0]][2], timed[after[0]][1])
                if point is None: reason = 'no quiet point after'
                else: end = point
            if not reason and end - start < RATE * 0.3:
                reason = 'shorter than 0.3 s'
            if reason:
                reasons[reason] = reasons.get(reason, 0) + 1
            cuts[key] = dict(id=utterance['id'], first=first, reason=reason, startSample=start, endSample=end,
                             seconds=round((end - start) / RATE, 3))
        if number % 40 == 0:
            print(number, len(plan['groups']), flush=True)
    Path(sys.argv[2]).write_text(json.dumps(dict(cuts=cuts, leftOut=reasons), indent=1) + '\n')
    print(len(cuts), 'clauses;', sum(c['reason'] is None for c in cuts.values()), 'cut;', reasons)


if __name__ == '__main__':
    main()
