#!/usr/bin/env python3
"""Mid-sentence pauses that a policy got wrong and P0 right: which cue would have kept them open."""
import collections, json, re, sys
from score import score_item, tokens, excluded
items = {i['name']: i for i in json.load(open('items.json'))}
p0 = {r['name']: r for r in map(json.loads, open('runs/dev/P0.jsonl'))}
px = {r['name']: r for r in map(json.loads, open(f'runs/dev/{sys.argv[1]}.jsonl'))}
A = set('a an the and or but nor of to that which than my your his her its our their this these those'.split())
B = A | set('is are was were be been being am has have had do does did will would shall should can could may might must in on at by for with from into about as'.split())
caught = collections.Counter(); last = collections.Counter()
for n in p0:
    if excluded(items[n], p0[n]): continue
    s0 = score_item(items[n], p0[n]); sx = score_item(items[n], px[n]); ht = tokens(p0[n]['final'])
    for j0, jx in zip(s0['junctions'], sx['junctions']):
        if j0['label'] in ('M', 'N') and j0['correct'] and not jx['correct'] and j0['h'] is not None:
            w = re.sub(r"[^\w']", '', ht[j0['h']].lower()); last[w] += 1
            caught['comma' if ht[j0['h']][-1] in ',;:-' else 'set A' if w in A else 'set B' if w in B else 'no cue'] += 1
print(dict(caught)); print(last.most_common(20))
