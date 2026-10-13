#!/usr/bin/env python3
"""The quiet each kind of pause gets, as the policies' tracker hears it, by inserted pause."""
import json
import numpy as np
items = json.load(open('items.json'))
print('split kind  inserted  target  quiet mean  quiet p10  quiet p90  junctions')
for split in ('dev', 'test'):
    for kind, labels in (('S', ('S',)), ('M', ('M', 'N'))):
        js = [j for i in items if i['split'] == split for j in i['junctions'] if j['label'] in labels]
        for g in sorted({j['inserted_s'] for j in js}):
            q = [j['quiet_s'] for j in js if j['inserted_s'] == g]
            print(f"{split:5} {kind:4} {g:8.1f} {g + .3:7.1f} {np.mean(q):11.2f} {np.percentile(q, 10):10.2f} {np.percentile(q, 90):10.2f} {len(q):10d}")
d = np.array([j['quiet_s'] - j['quiet_target_s'] for i in items for j in i['junctions']])
print(f'all {len(d)} junctions: quiet minus target p5 {np.percentile(d, 5):+.3f} s, median {np.median(d):+.3f} s, p95 {np.percentile(d, 95):+.3f} s; '
      f'{int((d < -.06).sum())} more than 0.06 s short, {int((d > .1).sum())} more than 0.1 s long (their own gap was longer)')
