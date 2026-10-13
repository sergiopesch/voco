#!/usr/bin/env python3
"""Score policy runs per PREREGISTRATION.md (Metrics, Statistics)."""
import json, re, sys
from pathlib import Path
import numpy as np
from build_items import align, norm
TERM = re.compile(r'[.?!]["”’)\]]*$')
COMMA = re.compile(r'[,;:\-–—]["”’)\]]*$')
def tokens(text):
    out = []
    for t in text.split():
        if out and not re.search(r'\w', t): out[-1] += t   # a lone mark joins its word
        else: out.append(t)
    return out
def cap(t):
    m = re.search(r'[^\W\d_]', t); return bool(m) and m.group(0).isupper()
def hyp_index(al, i):
    while i >= 0:
        if al[i] and al[i][0] is not None: return al[i][0]
        i -= 1
    return None
def score_item(item, row):
    rt = tokens(item['ref']); ht = tokens(row['final'])
    rn = [norm(t) for t in rt]; hn = [norm(t) for t in ht]
    al = align(rn, hn)
    ref_term = [bool(TERM.search(t)) for t in rt]
    # hyp index -> aligned ref index, for "unless the reference has one there"
    back = {}
    for i, a in enumerate(al):
        if a and a[0] is not None: back[a[0]] = i
    errs = sum(1 for a in al if a[1] != 'ok') + (len(hn) - sum(1 for a in al if a[0] is not None))
    junctions = []
    for j in item['junctions']:
        b = j['words_before']; h = hyp_index(al, b - 1)
        if h is None: junctions.append({**j, 'h': None, 'correct': False}); continue
        term_h = bool(TERM.search(ht[h])); comma_h = bool(COMMA.search(ht[h]))
        nxt_cap = h + 1 < len(ht) and cap(ht[h + 1]); ref_next_cap = b < len(rt) and cap(rt[b])
        def stray(lo, hi):
            for k in range(max(0, lo), min(len(ht), hi + 1)):
                if k == h: continue
                if TERM.search(ht[k]) and not (k in back and ref_term[back[k]]): return True
            return False
        dels = sum(1 for k in range(max(0, b - 2), min(len(al), b + 2)) if al[k][1] == 'del')
        if j['label'] == 'S':
            ok = term_h and nxt_cap and not stray(h + 1, h + 2)
        elif j['label'] in ('M', 'N'):
            ok = not term_h and (not nxt_cap or ref_next_cap) and not stray(h - 1, h + 2)
        else:
            ok = None
        # delay: first push whose h-th token is final and carries the terminator
        delay = None
        if term_h:
            # the first push where word h has its final form, terminator included
            for at, text in row['pushes']:
                tt = tokens(text)
                if len(tt) > h and tt[h] == ht[h]:
                    delay = at - j['speech_end_s']; break
            else:
                delay = row['audio_s'] - j['speech_end_s']
        junctions.append({**j, 'h': h, 'term': term_h, 'comma': comma_h, 'next_cap': nxt_cap, 'correct': ok, 'dels': dels, 'delay': delay,
                          'forced': any(j['pause_start_s'] - .3 <= f <= j['pause_end_s'] + .5 for f in row['forces'])})
    # global terminator precision/recall over aligned words, capital errors on matched words
    tp = fp = fn = caperr = matched = 0
    for i, a in enumerate(al):
        if a and a[1] == 'ok':
            matched += 1; ht_term = bool(TERM.search(ht[a[0]]))
            tp += ref_term[i] and ht_term; fp += (not ref_term[i]) and ht_term; fn += ref_term[i] and not ht_term
            if i > 0 and cap(rt[i]) != cap(ht[a[0]]): caperr += 1
    return {'words': len(rn), 'errors': errs, 'junctions': junctions, 'tp': tp, 'fp': fp, 'fn': fn, 'caperr': caperr, 'matched': matched,
            'violations': row['violations'], 'wall_s': row['wall_s'], 'audio_s': row['audio_s']}
def excluded(item, p0row):
    """Within items whose cut changed the no-policy words within one word of it."""
    if item['type'] != 'within' or 'uncut_final' not in p0row: return False
    rn = [norm(t) for t in tokens(item['ref'])]
    a1 = align(rn, [norm(t) for t in tokens(p0row['final'])]); a2 = align(rn, [norm(t) for t in tokens(p0row['uncut_final'])])
    h1 = [norm(t) for t in tokens(p0row['final'])]; h2 = [norm(t) for t in tokens(p0row['uncut_final'])]
    b = item['junctions'][0]['words_before']
    for k in range(max(0, b - 2), min(len(rn), b + 2)):
        w1 = h1[a1[k][0]] if a1[k][0] is not None else None; w2 = h2[a2[k][0]] if a2[k][0] is not None else None
        if w1 != w2: return True
    return False
def summarize(scores):
    S = [j for s in scores for j in s['junctions'] if j['label'] == 'S']
    M = [j for s in scores for j in s['junctions'] if j['label'] in ('M', 'N')]
    C = [j for s in scores for j in s['junctions'] if j['label'] == 'C']
    acc = lambda js: float(np.mean([bool(j['correct']) for j in js])) if js else float('nan')
    words = sum(s['words'] for s in scores); errs = sum(s['errors'] for s in scores)
    tp = sum(s['tp'] for s in scores); fp = sum(s['fp'] for s in scores); fn = sum(s['fn'] for s in scores)
    fd = [j['delay'] for j in S if j.get('forced') and j.get('term') and j['delay'] is not None]
    return {'S_acc': acc(S), 'M_acc': acc(M), 'M_inserted_acc': acc([j for j in M if j['label'] == 'M']), 'M_natural_acc': acc([j for j in M if j['label'] == 'N']),
            'PA': (acc(S) + acc(M)) / 2, 'PA_1to2': (acc(S) + 2 * acc(M)) / 3, 'PA_2to1': (2 * acc(S) + acc(M)) / 3,
            'C_comma': float(np.mean([j['comma'] for j in C if j['h'] is not None])) if C else float('nan'),
            'C_term': float(np.mean([j['term'] for j in C if j['h'] is not None])) if C else float('nan'),
            'WER': errs / words, 'term_P': tp / max(1, tp + fp), 'term_R': tp / max(1, tp + fn), 'cap_err_per_1000': 1000 * sum(s['caperr'] for s in scores) / max(1, sum(s['matched'] for s in scores)),
            'junction_dels_per_100': 100 * sum(j.get('dels', 0) for s in scores for j in s['junctions']) / max(1, sum(len(s['junctions']) for s in scores)),
            'violations': sum(s['violations'] for s in scores), 'rtf': sum(s['wall_s'] for s in scores) / sum(s['audio_s'] for s in scores),
            'forced_S_delay_p50': float(np.percentile(fd, 50)) if fd else None, 'forced_S_delay_p90': float(np.percentile(fd, 90)) if fd else None,
            'n_S': len(S), 'n_M': len([j for j in M if j['label'] == 'M']), 'n_N': len([j for j in M if j['label'] == 'N']), 'n_C': len(C), 'n_items': len(scores)}
def by_pause(scores):
    out = {}
    for lab in ('S', 'MN'):
        for p in sorted({j['inserted_s'] for s in scores for j in s['junctions']}):
            js = [j for s in scores for j in s['junctions'] if j['inserted_s'] == p and (j['label'] == 'S' if lab == 'S' else j['label'] in ('M', 'N'))]
            if js: out[f'{lab}@{p}'] = (round(float(np.mean([bool(j['correct']) for j in js])), 3), len(js))
    return out
def per_item(scores):
    """Per-item counts, for a vectorised paired bootstrap."""
    f = lambda pred: np.array([sum(1 for j in s['junctions'] if pred(j)) for s in scores], float)
    return {'sc': f(lambda j: j['label'] == 'S' and j['correct']), 'sn': f(lambda j: j['label'] == 'S'),
            'mc': f(lambda j: j['label'] in ('M', 'N') and j['correct']), 'mn': f(lambda j: j['label'] in ('M', 'N')),
            'err': np.array([s['errors'] for s in scores], float), 'words': np.array([s['words'] for s in scores], float)}
def metric(c, idx, key):
    S = c['sc'][idx].sum(1) / c['sn'][idx].sum(1); M = c['mc'][idx].sum(1) / c['mn'][idx].sum(1)
    return {'S_acc': S, 'M_acc': M, 'PA': (S + M) / 2, 'WER': c['err'][idx].sum(1) / c['words'][idx].sum(1)}[key]
def boot(p0, px, key, n=10000, seed=20261013):
    rng = np.random.default_rng(seed); k = len(p0); idx = rng.integers(0, k, (n, k))
    d = metric(per_item(px), idx, key) - metric(per_item(p0), idx, key)
    return float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))
def main():
    items = {i['name']: i for i in json.loads(Path(sys.argv[1]).read_text())}
    runs = Path(sys.argv[2]); specs = sys.argv[3:]
    load = lambda spec: {r['name']: r for r in map(json.loads, (runs / f'{spec}.jsonl').read_text().splitlines())}
    p0 = load('P0'); keep = [n for n in p0 if not excluded(items[n], p0[n])]
    print(f'items {len(p0)}, excluded {len(p0) - len(keep)}')
    s0 = [score_item(items[n], p0[n]) for n in keep]; base = summarize(s0)
    table = {'P0': base}
    for spec in specs:
        if spec == 'P0': continue
        rx = load(spec); sx = [score_item(items[n], rx[n]) for n in keep]; table[spec] = summarize(sx)
        for key in ('PA', 'M_acc', 'S_acc', 'WER'): table[spec][f'{key}_ci'] = boot(s0, sx, key)
        table[spec]['by_pause'] = by_pause(sx)
    table['P0']['by_pause'] = by_pause(s0)
    print(json.dumps(table, indent=1))
if __name__ == '__main__': main()
