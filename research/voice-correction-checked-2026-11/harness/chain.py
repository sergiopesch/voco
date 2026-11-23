#!/usr/bin/env python3
"""Build the chain's trial files for the field (PREREGISTRATION.md, The chain).

  chain.py TRIALS.json RUNS.jsonl LEAN.jsonl OUT_DIR

Draws 60 far and near trials by seed. For each, the text typed 0.8 s into the
next utterance, with the planted word, is what VOCO pasted; rule 3 decides on
its words with the correction leaned toward the window typed at the key press;
and its change is written into the text by the pre-registered form. Writes
OUT_DIR/chain.json, one entry for each drawn trial, and for each trial where
the rule made a change, OUT_DIR/trials/<id>.<kind>.json for the field harness.
Needs neither the recognizer nor the audio.
"""
import hashlib, json, random, sys
from pathlib import Path
from core import EDGE, change, length_at, listed, surface, tokens, typed_at
from rules import WINDOW, apply, checked
from text import words

SEED, DRAWN, DELAY, PARTS = 20261123, 60, 0.8, 3


def begins_sentence(text, spans, index):
    return index == 0 or text[spans[index - 1][0]:spans[index - 1][1]].rstrip('"\')]”’')[-1:] in ('.', '?', '!', '…')


def written(text, spans, index, word):
    """`word` in the place of the text's token `index`: that token's punctuation,
    and a capital when the token had one and began a sentence."""
    lead, core, trail = EDGE.match(text[spans[index][0]:spans[index][1]]).groups()
    if core[:1].isupper() and begins_sentence(text, spans, index):
        word = word[:1].upper() + word[1:]
    return lead + word + trail


def plant(final, trial, kind, length):
    """The passage's text with the planted word, and how much of it was typed
    when `length` characters of the passage as recognized were."""
    spans = tokens(final)
    start, end = spans[trial['target']]
    new = written(final, spans, trial['target'], trial[kind])
    text = final[:start] + new + final[end:]
    if length >= end:
        return text, length + len(new) - (end - start)
    # A push that ended inside the word had typed its first letters.
    return text, length if length <= start else start + min(length - start, len(new))


def form(text, a, b, new):
    """Where and what to write so that the text's words a to b become `new`:
    (start, end, replacement), characters of `text`."""
    spans = tokens(text)
    if a == b:                       # nothing replaced: after the left end word
        at = spans[a - 1][1]
        return at, at, ' ' + ' '.join(new)
    if not new:                      # nothing new: the run goes, with the space before it
        return spans[a - 1][1], spans[b - 1][1], ''
    if b - a == len(new):            # word for word, each keeping its place's punctuation
        start, end = spans[a][0], spans[b - 1][1]
        pieces, at = [], start
        for index, word in zip(range(a, b), new):
            pieces += [text[at:spans[index][0]], written(text, spans, index, word)]
            at = spans[index][1]
        return start, end, ''.join(pieces)
    lead = EDGE.match(text[spans[a][0]:spans[a][1]]).group(1)
    trail = EDGE.match(text[spans[b - 1][0]:spans[b - 1][1]]).group(3)
    return spans[a][0] + len(lead), spans[b - 1][1] - len(trail), ' '.join(new)


def build(trial, kind, run, heard_text):
    final = run['text']
    text, typed_length = plant(final, trial, kind, length_at(run, run['tap'] + DELAY))
    pasted, rest = text[:typed_length], text[typed_length:]
    typed, heard = words(pasted), words(heard_text)
    offset = max(0, len(typed) - WINDOW)
    decision = checked(typed[offset:], heard)
    entry = dict(id=trial['id'], kind=kind, heard=heard_text, typedWords=len(typed), wanted=final)
    if decision is None:
        return dict(entry, change=None, right=False), None
    p, q, i, j, step = decision
    result = apply(typed[offset:], heard, decision)
    a, b, new = change(typed[offset:], result)
    interior = surface(heard_text)[i + 1:len(heard) - j - 1]
    new_shown = interior[a - (p + 1):len(interior) - (q - b)]
    assert [w for token in new_shown for w in words(token)] == new
    start, end, replacement = form(pasted, offset + a, offset + b, new_shown)
    corrected = pasted[:start] + replacement + pasted[end:]
    expected = corrected + rest
    # Three parts, cut where pushes ended, nearest to thirds of the pasted text.
    ends = sorted({plant(final, trial, kind, length)[1] for _, length in run['timeline']} - {0, typed_length})
    ends = [e for e in ends if e < typed_length]
    cuts = sorted({min(ends, key=lambda e: abs(e - typed_length * part / PARTS)) for part in range(1, PARTS)} if ends else set())
    parts = [pasted[x:y] for x, y in zip([0] + cuts, cuts + [typed_length])]
    assert ''.join(parts) == pasted and all(parts)
    entry.update(change=dict(words=[offset + a, offset + b], new=new, step=step), right=words(expected) == words(final), exact=expected == final)
    return entry, dict(id=f"{trial['id']}.{kind}", parts=parts, start=start, end=end, replacement=replacement, rest=rest, expected=expected)


def main():
    trials = {trial['id']: trial for trial in json.loads(Path(sys.argv[1]).read_text())['trials']}
    runs = {(run['arm'], run['id']): run for run in map(json.loads, Path(sys.argv[2]).read_text().splitlines())}
    leaned = {(run['id'], tuple(run['words'])): run['text'] for run in map(json.loads, Path(sys.argv[3]).read_text().splitlines())}
    out = Path(sys.argv[4]); (out / 'trials').mkdir(parents=True, exist_ok=True)
    drawn = random.Random(SEED).sample([(key, kind) for key in sorted(trials) for kind in ('far', 'near')], DRAWN)
    entries = []
    for key, kind in sorted(drawn):
        trial, run = trials[key], runs['P', key]
        at_tap = surface(typed_at(run, 0))
        if trial['target'] < len(at_tap):
            at_tap[trial['target']] = trial[kind]
        entry, field = build(trial, kind, run, leaned[key, tuple(listed(at_tap))])
        if field:
            data = (json.dumps(field, indent=1, ensure_ascii=False) + '\n').encode()
            (out / 'trials' / f"{field['id']}.json").write_bytes(data)
            entry.update(file=f"trials/{field['id']}.json", sha256=hashlib.sha256(data).hexdigest())
        entries.append(entry)
    (out / 'chain.json').write_text(json.dumps(dict(seed=SEED, delay=DELAY, drawn=entries), indent=1, ensure_ascii=False) + '\n')
    made = [e for e in entries if e['change']]
    print(len(entries), 'drawn;', len(made), 'with a change;', sum(e['right'] for e in made), 'right in words;', sum(e.get('exact', False) for e in made), 'exact')


if __name__ == '__main__':
    main()
