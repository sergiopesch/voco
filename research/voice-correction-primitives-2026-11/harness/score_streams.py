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
    windows = [r for r in records if r['kind'] == 'window']
    passages = [r for r in records if r['kind'] == 'passage']
    complete = {z: 0 for z in QUIET}
    for record in windows:
        trial = own[record['id']]
        wanted = trial['typed'][:trial['last'] + 1]
        for z in QUIET:
            complete[z] += words(record['atTap'][z])[:len(wanted)] == wanted
    same_text = same_words = same_correction = 0
    for record in passages:
        whole = first['P', record['id']]
        same_text += record['final'] == whole
        same_words += words(record['final']) == words(whole)
        same_correction += record['correction'] == first['S', record['id']]
    resumes = [r for r in records if r['kind'] == 'resume' and 'skipped' not in r]
    skipped = sum(r['kind'] == 'resume' and 'skipped' in r for r in records)
    counts = {name: [0, 0] for name in ('fresh', 'together', 'nothing', 'silence')}
    agree = {name: 0 for name in ('nothing', 'silence')}
    starts = lambda token: next((c for c in token if c.isalpha()), '').isupper()
    for record in resumes:
        fresh = first['R', record['id']]
        counts['fresh'][0] += starts(fresh); counts['fresh'][1] += 1
        together = [t for t in record['together'].split() if words(t)]
        for name in ('nothing', 'silence'):
            before = words(record[name]['atTap'])
            tokens = [t for t in record[name]['final'].split() if words(t)]
            agree[name] += words(record[name]['final']) == words(record['together'])
            # The item's first word is the token after the words written at the tap.
            if len(tokens) <= len(before) or [w for t in tokens[:len(before)] for w in words(t)] != before:
                continue
            counts[name][0] += starts(tokens[len(before)]); counts[name][1] += 1
            # In one go there is no tap: the token at that place, where it is the same word.
            if name == 'nothing' and len(together) > len(before) and words(together[len(before)]) == words(tokens[len(before)]):
                counts['together'][0] += starts(together[len(before)]); counts['together'][1] += 1
    pct = lambda a, b: f'{100 * a / b:.1f}% ({a}/{b})' if b else 'n/a'
    n, m, k = len(windows), len(passages), len(resumes)
    lines = [f'== typed text at the tap: {n} items ==',
             'Complete up to the phrase after this much silence: ' + ', '.join(f'{z} s {pct(complete[z], n)}' for z in QUIET),
             '', f'== dictation resumed on the first stream, nothing fed at the tap: {m} items ==',
             f'Same text as in one go                                {pct(same_text, m)}',
             f'Same words                                            {pct(same_words, m)}',
             f'Correction on the second stream, as on its own        {pct(same_correction, m)}',
             '', f'== resume items: {k} run, {skipped} skipped for no previous utterance ==',
             f'Starts with a capital: in a session of its own (first study)   {pct(*counts["fresh"])}',
             f'  after its previous utterance in one go                       {pct(*counts["together"])}',
             f'  on two streams, nothing fed at the tap                       {pct(*counts["nothing"])}',
             f'  on two streams, 0.4 s of silence fed at the tap              {pct(*counts["silence"])}',
             f'Same words as in one go: nothing fed {pct(agree["nothing"], k)}, 0.4 s of silence {pct(agree["silence"], k)}']
    summary = dict(windows=n, completeAtTap={z: complete[z] for z in QUIET}, passages=m, sameText=same_text, sameWords=same_words,
                   sameCorrection=same_correction, resumes=k, skipped=skipped, capital=counts, sameWordsResumed=agree)
    if n and m and counts['nothing'][1] and counts['together'][1]:
        summary['bars'] = dict(windowComplete=complete['0.4'] / n >= .95, sameWords=same_words / m >= .95,
                               capital=counts['nothing'][0] / counts['nothing'][1] <= counts['together'][0] / counts['together'][1] + .10)
        lines += ['', 'Bars: ' + ', '.join(f'{name} {"met" if met else "not met"}' for name, met in summary['bars'].items())]
    (out / 'streams-summary.json').write_text(json.dumps(summary, indent=1) + '\n')
    (out / 'streams-tables.txt').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
