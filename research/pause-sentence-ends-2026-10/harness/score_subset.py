import json, sys
import numpy as np
from score import score_item, excluded, summarize
items = {i['name']: i for i in json.load(open('items.json'))}
p0 = {r['name']: r for r in map(json.loads, open('runs/dev/P0.jsonl'))}
for path in sys.argv[1:]:
    rx = {r['name']: r for r in map(json.loads, open(path))}
    keep = [n for n in rx if not excluded(items[n], p0[n])]
    a = summarize([score_item(items[n], p0[n]) for n in keep]); b = summarize([score_item(items[n], rx[n]) for n in keep])
    print(path, len(keep), 'P0:', {k: round(a[k], 3) for k in ('S_acc', 'M_acc', 'PA', 'WER', 'term_P', 'term_R')})
    print(' ' * len(path), len(keep), 'X :', {k: round(b[k], 3) for k in ('S_acc', 'M_acc', 'PA', 'WER', 'term_P', 'term_R')})
