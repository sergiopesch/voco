#!/usr/bin/env python3
"""Build the pre-registered dev and test items (PREREGISTRATION.md, Data)."""
import json, os, random, re, sys
from pathlib import Path
import numpy as np
from asr import Stream, load_flac
SEED = 20261013
# libri-pc/{test-clean,test-other}.json and LibriSpeech/{test-clean,test-other}.
BASE = Path(os.environ['VOCO_PAUSE_DOWNLOADS'])
AUDIO = Path(os.environ['VOCO_PAUSE_AUDIO']); AUDIO.mkdir(parents=True, exist_ok=True)
GRID = [0, .4, .8, 1.2, 1.6, 2.0, 2.5]
RATE, FR = 16000, 320
CLOSE = re.compile(r'["”’)\]]+$')
def label(text):
    t = CLOSE.sub('', text.strip())
    return 'S' if t[-1] in '.?!' else 'C' if t[-1] in ',;:-–—' else 'N'
def norm(w): return re.sub(r"[^\w']", '', w.lower()).strip("'")
def db(a, hop=FR):
    n = (len(a) - FR) // hop + 1
    if n <= 0: return np.array([-120.])
    idx = np.arange(FR)[None, :] + hop * np.arange(n)[:, None]
    return 10 * np.log10(np.square(a[idx].astype(np.float64)).mean(1) + 1e-12)
def trim(a):
    """Edges trimmed to 150 ms; also the speech threshold (5th percentile + 15 dB)."""
    e = db(a); p5 = np.percentile(e, 5); sp = np.flatnonzero(e > p5 + 15)
    s = max(0, sp[0] * FR - 2400); t = min(len(a), (sp[-1] + 1) * FR + 2400)
    return a[s:t], float(p5 + 15)
def speech_end(a, level):
    sp = np.flatnonzero(db(a) > level)
    return (sp[-1] + 1) * FR if len(sp) else len(a)
def tone(a):
    e = db(a); p5 = np.percentile(e, 5)
    w = np.convolve(10 ** (e / 10), np.ones(15) / 15, 'valid'); k = int(np.argmin(w))
    level = 10 * np.log10(w[k] + 1e-12)
    return (a[k * FR:k * FR + 4800].copy() if level <= p5 + 6 else None), float(p5)
def pink(n, level, rng):
    x = rng.standard_normal(n); f = np.fft.rfftfreq(n); s = np.fft.rfft(x); s[1:] /= np.sqrt(f[1:]); s[0] = 0
    y = np.fft.irfft(s, n); return (y / np.sqrt(np.mean(y ** 2)) * 10 ** (level / 20)).astype(np.float32)
def pause(seconds, src, rng):
    n = int(round(seconds * RATE))
    if n == 0: return np.zeros(0, np.float32), 'none'
    seg, p5 = src
    if seg is None: return pink(n, min(-45, max(-65, p5)), rng), 'pink'
    out = np.zeros(0, np.float32); fade = np.linspace(0, 1, 320, dtype=np.float32)
    while len(out) < n + 320:
        off = int(rng.integers(0, len(seg) - 1600 + 1)); piece = seg[off:off + 1600].copy()
        if len(out) >= 320:
            out[-320:] = out[-320:] * fade[::-1] + piece[:320] * fade; out = np.concatenate([out, piece[320:]])
        else: out = np.concatenate([out, piece])
    return out[:n], 'tone'
def align(ref, hyp):
    """Edit-distance alignment; returns for each ref index the hyp index (or None) and op."""
    n, m = len(ref), len(hyp); d = np.zeros((n + 1, m + 1), np.int32); d[:, 0] = range(n + 1); d[0, :] = range(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i, j] = min(d[i-1, j] + 1, d[i, j-1] + 1, d[i-1, j-1] + (ref[i-1] != hyp[j-1]))
    i, j, out = n, m, [None] * n
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i, j] == d[i-1, j-1] + (ref[i-1] != hyp[j-1]):
            out[i-1] = (j-1, 'ok' if ref[i-1] == hyp[j-1] else 'sub'); i -= 1; j -= 1
        elif i > 0 and d[i, j] == d[i-1, j] + 1: out[i-1] = (None, 'del'); i -= 1
        else: j -= 1
    return out
def main():
    rng = random.Random(SEED); nrng = np.random.default_rng(SEED)
    rows = []
    for subset in ('test-clean', 'test-other'):
        for line in open(BASE / 'libri-pc' / f'{subset}.json'):
            r = json.loads(line); spk, ch, num = Path(r['audio_filepath']).stem.split('-')
            rows.append({**r, 'subset': subset, 'speaker': int(spk), 'chapter': int(ch), 'num': int(num), 'id': Path(r['audio_filepath']).stem})
    split = {}
    for subset in ('test-clean', 'test-other'):
        for k, spk in enumerate(sorted({r['speaker'] for r in rows if r['subset'] == subset})):
            split[spk] = 'dev' if k % 2 == 0 else 'test'
    by = {}
    for r in rows: by.setdefault((r['speaker'], r['chapter']), {})[r['num']] = r
    items = []
    for spk in sorted(split):
        chapters = sorted(c for s, c in by if s == spk)
        windows = []
        for ch in chapters:
            nums = by[(spk, ch)]
            for n0 in sorted(nums):
                w = [nums.get(n0 + k) for k in range(3)]
                if all(w) and all(1.5 <= x['duration'] <= 20 for x in w) and sum(x['duration'] for x in w) <= 45:
                    windows.append(w)
        rng.shuffle(windows); used = set(); chosen = []
        for w in windows:
            if len(chosen) == 3: break
            if not used & {x['id'] for x in w}: chosen.append(w); used |= {x['id'] for x in w}
        for w in chosen: items.append({'type': 'between', 'split': split[spk], 'speaker': spk, 'utts': w})
        singles = [r for ch in chapters for r in by[(spk, ch)].values()
                   if 5 <= r['duration'] <= 25 and len(r['text'].split()) >= 10 and r['id'] not in used]
        singles.sort(key=lambda r: r['id']); rng.shuffle(singles)
        for r in singles[:3]: items.append({'type': 'within', 'split': split[spk], 'speaker': spk, 'utts': [r]})
    # Pause lengths, round-robin over a seeded order of each split's junctions.
    for sp in ('dev', 'test'):
        slots = [(i, k) for i, it in enumerate(items) if it['split'] == sp for k in range(2 if it['type'] == 'between' else 1)]
        rng.shuffle(slots)
        for n, (i, k) in enumerate(slots): items[i].setdefault('pauses', {})[k] = GRID[n % len(GRID)]
    out = []
    for n, it in enumerate(items):
        name = f"{it['split']}-{n:04d}"
        trimmed = [trim(load_flac(BASE / 'LibriSpeech' / u['audio_filepath'])) for u in it['utts']]; audios = [t[0] for t in trimmed]; levels = [t[1] for t in trimmed]
        refs = [u['text'] for u in it['utts']]
        rec = {'name': name, 'type': it['type'], 'split': it['split'], 'speaker': it['speaker'], 'ids': [u['id'] for u in it['utts']],
               'subset': it['utts'][0]['subset'], 'ref': ' '.join(refs), 'junctions': []}
        if it['type'] == 'between':
            parts, pos, words = [], 0, 0
            for k, (a, ref) in enumerate(zip(audios, refs)):
                parts.append(a); pos += len(a); words += len(ref.split())
                if k < 2:
                    p, kind = pause(it['pauses'][k], tone(a), nrng)
                    rec['junctions'].append({'words_before': words, 'label': label(ref), 'inserted_s': it['pauses'][k], 'filler': kind,
                                             'speech_end_s': (pos - len(a) + speech_end(a, levels[k])) / RATE, 'pause_start_s': pos / RATE, 'pause_end_s': (pos + len(p)) / RATE})
                    parts.append(p); pos += len(p)
            audio = np.concatenate(parts)
        else:
            a, ref = audios[0], refs[0]
            s = Stream(word_times=True)
            for off in range(0, len(a), 1600): s.push(a[off:off+1600]); s.drain()
            uncut_text = s.finish(); hw = s.words
            rw = ref.split(); al = align([norm(w) for w in rw], [norm(w[0]) for w in hw])
            e10 = db(a, 160); med = np.median(db(a))
            cands = []
            for i in range(2, len(rw) - 3):
                if re.search(r'[^\w]$', CLOSE.sub('', rw[i])) or not (al[i] and al[i+1]) or al[i][1] != 'ok' or al[i+1][1] != 'ok': continue
                j, j2 = al[i][0], al[i+1][0]
                if j2 != j + 1: continue
                lo, hi = (hw[j][2] - 160) * 16, (hw[j2][1] - 160) * 16
                if hi - lo < 640: continue
                f0, f1 = max(0, lo // 160), min(len(e10) - 1, hi // 160)
                if f1 <= f0: continue
                k = f0 + int(np.argmin(e10[f0:f1])); 
                if e10[k] <= med - 12: cands.append((i, k * 160 + 160))
            if not cands: continue
            i, cut = rng.choice(cands)
            p, kind = pause(it['pauses'][0], tone(a), nrng)
            audio = np.concatenate([a[:cut], p, a[cut:]])
            rec['junctions'].append({'words_before': i + 1, 'label': 'M', 'inserted_s': it['pauses'][0], 'filler': kind,
                                     'speech_end_s': speech_end(a[:cut], levels[0]) / RATE, 'pause_start_s': cut / RATE, 'pause_end_s': (cut + len(p)) / RATE})
            rec['uncut'] = name + '-uncut.f32'; rec['uncut_text_wordtimes'] = uncut_text
            a.astype(np.float32).tofile(AUDIO / rec['uncut'])
        rec['audio'] = name + '.f32'; rec['seconds'] = len(audio) / RATE
        audio.astype(np.float32).tofile(AUDIO / rec['audio'])
        out.append(rec)
        print(name, rec['type'], len(rec['junctions']), round(rec['seconds'], 1), flush=True)
    Path(sys.argv[1]).write_text(json.dumps(out, indent=1))
if __name__ == '__main__':
    main()
