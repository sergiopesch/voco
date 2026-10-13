"""Compare runs of other configurations with the R1 P0 baseline on the same non-excluded items."""
import json, sys
from score import score_item, excluded, summarize, boot, by_pause
items = {i['name']: i for i in json.load(open('items.json'))}
split = sys.argv[1]
p0 = {r['name']: r for r in map(json.loads, open(f'runs/{split}/P0.jsonl'))}
keep = [n for n in p0 if not excluded(items[n], p0[n])]
base = [score_item(items[n], p0[n]) for n in keep]
b = summarize(base)
print(split, 'items', len(keep), 'P0', {k: round(b[k], 4) for k in ('S_acc', 'M_acc', 'M_inserted_acc', 'M_natural_acc', 'PA', 'WER', 'term_P', 'term_R', 'cap_err_per_1000', 'rtf')})
for path in sys.argv[2:]:
    rx = {r['name']: r for r in map(json.loads, open(path))}
    sx = [score_item(items[n], rx[n]) for n in keep]; s = summarize(sx)
    print(path, {k: round(s[k], 4) for k in ('S_acc', 'M_acc', 'M_inserted_acc', 'M_natural_acc', 'PA', 'WER', 'term_P', 'term_R', 'cap_err_per_1000', 'rtf', 'junction_dels_per_100', 'violations')})
    print('   CI vs P0', {k: tuple(round(x, 4) for x in boot(base, sx, k)) for k in ('PA', 'S_acc', 'M_acc', 'WER')})
    print('   by pause', by_pause(sx))
