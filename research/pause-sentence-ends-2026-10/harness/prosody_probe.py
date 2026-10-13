"""Dev-only feasibility: does pitch before a pause separate sentence ends from mid-sentence pauses?"""
import json, os, sys
import numpy as np
AUDIO = os.environ['VOCO_PAUSE_AUDIO'] + '/'
def f0_track(x, rate=16000, frame=640, hop=160, lo=60, hi=400):
    out = []
    for s in range(0, len(x) - frame, hop):
        w = x[s:s + frame] - x[s:s + frame].mean()
        e = np.dot(w, w)
        if e < 1e-7: out.append((0, 0)); continue
        r = np.correlate(w, w, 'full')[frame - 1:]
        lmin, lmax = rate // hi, rate // lo
        seg = r[lmin:lmax] / e
        k = int(np.argmax(seg)); out.append((rate / (lmin + k), float(seg[k])))
    return out
items = json.load(open(sys.argv[1]))
rows = []
for it in items:
    if it['split'] != 'dev': continue
    a = np.fromfile(AUDIO + it['audio'], np.float32)
    for j in it['junctions']:
        end = int(j['speech_end_s'] * 16000); start = max(0, end - 16000 * 3)
        tr = f0_track(a[start:end])
        voiced = [(i, f) for i, (f, c) in enumerate(tr) if c > .6]
        if len(voiced) < 20: continue
        f = np.array([v[1] for v in voiced]); st = 12 * np.log2(f / np.median(f))
        tail = [12 * np.log2(fv / np.median(f)) for i, fv in voiced if i >= len(tr) - 30]  # last 300 ms
        if len(tail) < 5: continue
        slope = np.polyfit(np.arange(len(tail)), tail, 1)[0] * 100  # semitones/s
        rows.append((j['label'], float(np.median(tail)), float(slope)))
for lab in 'SMN':
    v = [r for r in rows if r[0] == lab]
    if v: print(lab, len(v), 'final-vs-median semitones p25/p50/p75', np.percentile([r[1] for r in v], [25, 50, 75]).round(2), 'slope st/s p50', round(float(np.median([r[2] for r in v])), 1))
# AUC of "lower final pitch" for S vs M+N
s = [r[1] for r in rows if r[0] == 'S']; m = [r[1] for r in rows if r[0] in 'MN']
auc = np.mean([[1. if a < b else .5 if a == b else 0. for b in m] for a in s])
print('AUC final pitch (S lower than M/N):', round(float(auc), 3))
s2 = [r[2] for r in rows if r[0] == 'S']; m2 = [r[2] for r in rows if r[0] in 'MN']
print('AUC slope (S falls more):', round(float(np.mean([[1. if a < b else .5 if a == b else 0. for b in m2] for a in s2])), 3))
