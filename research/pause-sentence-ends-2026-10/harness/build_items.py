#!/usr/bin/env python3
"""Build the pre-registered dev and test items (PREREGISTRATION.md, Data).

As corrected on 13 October (README, Correction): every junction's quiet, as the
policies' own PauseTracker measures it, is its inserted pause plus 0.3 s, the
two 150 ms edges a between-sentence junction keeps. A junction's fill tops up
whatever quiet it already has, so a cut between two words gets the same quiet
as a join between two utterances, and the fill is the recording's own quietest
frames, so the tracker hears all of it as quiet.
"""
import json, os, random, re, sys
from pathlib import Path
import numpy as np
from asr import Stream, load_flac
from pauses import PauseTracker
from text import align, norm
SEED = 20261013
# libri-pc/{test-clean,test-other}.json and LibriSpeech/{test-clean,test-other}.
BASE = Path(os.environ['VOCO_PAUSE_DOWNLOADS'])
AUDIO = Path(os.environ['VOCO_PAUSE_AUDIO']); AUDIO.mkdir(parents=True, exist_ok=True)
GRID = [0, .4, .8, 1.2, 1.6, 2.0, 2.5]
# The quiet of two trimmed 150 ms edges, which every junction gets on top of its pause.
EDGES_S = .3
RATE, FR = 16000, 320
CLOSE = re.compile(r'["”’)\]]+$')
def label(text):
    t = CLOSE.sub('', text.strip())
    return 'S' if t[-1] in '.?!' else 'C' if t[-1] in ',;:-–—' else 'N'
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
def quiet_at(audio, start_s, end_s):
    """The quiet run the policies' tracker hears across [start_s, end_s], in seconds."""
    tracker = PauseTracker(); best = 0.; lo, hi = start_s - .4, end_s + .6
    for f in range(0, len(audio) - FR + 1, FR):
        quiet = tracker.push(audio[f:f + FR], RATE); at = (f + FR) / RATE
        if at > hi: break
        if at >= lo: best = max(best, quiet)
    return round(best, 3)
def floor_frames(a):
    """The recording's own 20 ms frames within 3 dB of its quietest 60 ms (the
    dB mean of three frames, as PauseTracker's floor), which the tracker hears as
    quiet. A recording that falls near silence between phrases gets near-silence;
    one with a room under it gets the room."""
    n = len(a) // FR; frames = a[:n * FR].reshape(n, FR)
    e = 10 * np.log10(np.square(frames.astype(np.float64)).mean(1) + 1e-12)
    floor = np.convolve(e, np.ones(3) / 3, 'valid').min()
    return frames[e <= floor + 3]
def pause(seconds, pool, rng):
    """Floor frames in a random order, joined with 4 ms raised-cosine crossfades."""
    n = int(round(seconds * RATE))
    # Less than 10 ms of fill changes no frame the tracker hears.
    if n < 160: return np.zeros(0, np.float32), 'none'
    fade = (.5 - .5 * np.cos(np.linspace(0, np.pi, 64))).astype(np.float32)
    out = pool[rng.integers(len(pool))].astype(np.float32)
    while len(out) < n:
        piece = pool[rng.integers(len(pool))].astype(np.float32)
        out[-64:] = out[-64:] * fade[::-1] + piece[:64] * fade
        out = np.concatenate([out, piece[64:]])
    return out[:n], 'floor'
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
            # The quiet each join already has, from the utterances' own edges.
            joined = np.concatenate(audios); natural = [quiet_at(joined, b / RATE, b / RATE) for b in np.cumsum([len(a) for a in audios])[:2]]
            parts, pos, words = [], 0, 0
            for k, (a, ref) in enumerate(zip(audios, refs)):
                parts.append(a); pos += len(a); words += len(ref.split())
                if k < 2:
                    target = it['pauses'][k] + EDGES_S; fill = max(0., target - natural[k])
                    p, kind = pause(fill, floor_frames(a), nrng)
                    rec['junctions'].append({'words_before': words, 'label': label(ref), 'inserted_s': it['pauses'][k], 'filler': kind,
                                             'quiet_target_s': target, 'quiet_natural_s': natural[k], 'fill_s': round(len(p) / RATE, 3),
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
            # The cut's own gap between the two words, topped up to the same quiet.
            natural = quiet_at(a, cut / RATE, cut / RATE); target = it['pauses'][0] + EDGES_S; fill = max(0., target - natural)
            p, kind = pause(fill, floor_frames(a), nrng)
            audio = np.concatenate([a[:cut], p, a[cut:]])
            rec['junctions'].append({'words_before': i + 1, 'label': 'M', 'inserted_s': it['pauses'][0], 'filler': kind,
                                     'quiet_target_s': target, 'quiet_natural_s': natural, 'fill_s': round(len(p) / RATE, 3),
                                     'speech_end_s': speech_end(a[:cut], levels[0]) / RATE, 'pause_start_s': cut / RATE, 'pause_end_s': (cut + len(p)) / RATE})
            rec['uncut'] = name + '-uncut.f32'; rec['uncut_text_wordtimes'] = uncut_text
            a.astype(np.float32).tofile(AUDIO / rec['uncut'])
        # What the tracker hears at each junction of the finished item.
        for j in rec['junctions']: j['quiet_s'] = quiet_at(audio, j['pause_start_s'], j['pause_end_s'])
        rec['audio'] = name + '.f32'; rec['seconds'] = len(audio) / RATE
        audio.astype(np.float32).tofile(AUDIO / rec['audio'])
        out.append(rec)
        print(name, rec['type'], len(rec['junctions']), round(rec['seconds'], 1), flush=True)
    Path(sys.argv[1]).write_text(json.dumps(out, indent=1))
if __name__ == '__main__':
    main()
