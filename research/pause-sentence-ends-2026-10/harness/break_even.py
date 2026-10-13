#!/usr/bin/env python3
"""Accuracy where a policy acts (inserted pause at least T) and the mix of pauses at which it breaks even."""
import json, sys
from score import score_item, excluded
items = {i['name']: i for i in json.load(open('items.json'))}
split = sys.argv[1]
p0 = {r['name']: r for r in map(json.loads, open(f'runs/{split}/P0.jsonl'))}
keep = [n for n in p0 if not excluded(items[n], p0[n])]
def acc(spec, lab, lo):
    rx = {r['name']: r for r in map(json.loads, open(f'runs/{split}/{spec}.jsonl'))}
    js = [j for n in keep for j in score_item(items[n], rx[n])['junctions']
          if (j['label'] == 'S' if lab == 'S' else j['label'] in 'MN') and j['inserted_s'] >= lo]
    return sum(bool(j['correct']) for j in js) / len(js), len(js)
for arg in sys.argv[2:]:
    spec, lo = arg.split('@'); lo = float(lo)
    s0, ns = acc('P0', 'S', lo); s1, _ = acc(spec, 'S', lo); m0, nm = acc('P0', 'M', lo); m1, _ = acc(spec, 'M', lo)
    print(f'{spec}, inserted pause >= {lo} s: S {s0:.3f} -> {s1:.3f} (n={ns}), M {m0:.3f} -> {m1:.3f} (n={nm}), '
          f'break-even {(m0 - m1) / (s1 - s0):.2f} between-sentence pauses per mid-sentence pause')
