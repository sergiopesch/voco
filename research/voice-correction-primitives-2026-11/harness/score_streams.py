#!/usr/bin/env python3
"""Score Study B: score_streams.py ITEMS.json OWN.json RUNS1.jsonl STREAMS.jsonl OUT_DIR

RUNS1 is the first study's runs, for the uninterrupted passage (arm P), the
phrase in a session of its own (arm S) and the resume item in a session of its
own (arm R). Needs neither recognizer nor audio.
"""
import json, sys
from pathlib import Path
from text import align, words

QUIET = ('0', '0.4', '0.8', '1.2')


def capital(text, reference_words_before, reference):
    """Whether the hypothesis token aligned to the reference's word at that
    index starts with a capital; None when no token aligns to it."""
    tokens = [t for t in text.split() if words(t)]
    place = align(words(reference), [words(t)[0] if len(words(t)) == 1 else ''.join(words(t)) for t in tokens])[reference_words_before][0]
    if place is None:
        return None
    letter = next((c for c in tokens[place] if c.isalpha()), '')
    return letter.isupper()


def main():
    plan = json.loads(Path(sys.argv[1]).read_text())
    own = {t['id']: t for t in json.loads(Path(sys.argv[2]).read_text())['trials']}
    first = {(r['arm'], r['id']): r['text'] for r in map(json.loads, Path(sys.argv[3]).read_text().splitlines())}
    records = [json.loads(line) for line in Path(sys.argv[4]).read_text().splitlines()]
    out = Path(sys.argv[5]); out.mkdir(parents=True, exist_ok=True)
    passages = [r for r in records if r['kind'] == 'passage']
    complete = {z: 0 for z in QUIET}
    same_text = same_words = same_correction = 0
    for record in passages:
        trial = own[record['id']]
        wanted = trial['typed'][:trial['last'] + 1]
        for z in QUIET:
            complete[z] += words(record['atTap'][z])[:len(wanted)] == wanted
        whole = first['P', record['id']]
        same_text += record['final'] == whole
        same_words += words(record['final']) == words(whole)
        same_correction += record['correction'] == first['S', record['id']]
    by_id = {item['id']: item for item in plan['resumes']}
    resumes = [r for r in records if r['kind'] == 'resume' and 'skipped' not in r]
    skipped = sum(r['kind'] == 'resume' and 'skipped' in r for r in records)
    counts = dict(together=[0, 0], streams=[0, 0], fresh=[0, 0])
    for record in resumes:
        item = by_id[record['id']]
        before = words(record['atTap'])
        fresh = first['R', record['id']]
        letter = next((c for c in fresh if c.isalpha()), '')
        counts['fresh'][0] += letter.isupper(); counts['fresh'][1] += 1
        # The resume item's first word: the token after the words typed at the tap.
        for name, text in (('streams', record['final']), ('together', record['together'])):
            tokens = [t for t in text.split() if words(t)]
            if name == 'streams' and len(tokens) > len(before) and [w for t in tokens[:len(before)] for w in words(t)] == before:
                token = tokens[len(before)]
            else:
                # In one go there is no tap: take the token that the two-stream text has at that place, if the words agree.
                other = [t for t in record['final'].split() if words(t)]
                if len(tokens) <= len(before) or words(tokens[len(before)]) != words(other[len(before)] if len(other) > len(before) else ''):
                    continue
                token = tokens[len(before)]
            counts[name][0] += next((c for c in token if c.isalpha()), '').isupper(); counts[name][1] += 1
    pct = lambda a, b: f'{100 * a / b:.1f}% ({a}/{b})' if b else 'n/a'
    n = len(passages)
    lines = [f'== passages: {n} items ==',
             'Typed text complete up to the phrase after this much silence at the tap: ' + ', '.join(f'{z} s {pct(complete[z], n)}' for z in QUIET),
             f'Dictation resumed on the first stream, same text as in one go   {pct(same_text, n)}',
             f'  same words                                                    {pct(same_words, n)}',
             f'Correction on the second stream, same text as on its own        {pct(same_correction, n)}',
             '', f'== resume items: {len(resumes)} run, {skipped} skipped for no previous utterance ==',
             f'Starts with a capital, in a session of its own (first study)    {pct(*counts["fresh"])}',
             f'Starts with a capital, after its previous utterance in one go   {pct(*counts["together"])}',
             f'Starts with a capital, on two streams after a tap               {pct(*counts["streams"])}']
    summary = dict(passages=n, completeAtTap={z: complete[z] for z in QUIET}, sameText=same_text, sameWords=same_words,
                   sameCorrection=same_correction, resumes=len(resumes), skipped=skipped, capital=counts)
    if n and counts['streams'][1] and counts['together'][1]:
        summary['bars'] = dict(windowComplete=complete['0.8'] / n >= .95, sameWords=same_words / n >= .95,
                               capital=counts['streams'][0] / counts['streams'][1] <= counts['together'][0] / counts['together'][1] + .10)
        lines += ['', 'Bars: ' + ', '.join(f'{k} {"met" if v else "not met"}' for k, v in summary['bars'].items())]
    (out / 'streams-summary.json').write_text(json.dumps(summary, indent=1) + '\n')
    (out / 'streams-tables.txt').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
