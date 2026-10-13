#!/usr/bin/env python3
"""Run pre-registered pause policies over one split; one JSONL per policy."""
import json, os, re, sys, time
from pathlib import Path
import numpy as np
from asr import Stream
from pauses import PauseTracker, sentence_open, OPEN_PUNCTUATION
CUE_A = frozenset('a an the and or but nor of to that which than my your his her its our their this these those'.split())
CUE_B = CUE_A | frozenset('is are was were be been being am has have had do does did will would shall should can could may might must in on at by for with from into about as'.split())
TERM = re.compile(r'[.?!]["”’)\]]*$')
AUDIO = Path(os.environ['VOCO_PAUSE_AUDIO'])
def policy(spec):
    parts = spec.split(':'); family = parts[0]; T = float(parts[1]) if len(parts) > 1 else None
    D = float(parts[2][1:]) if len(parts) > 2 else 9.
    def due(text):
        if family == 'E': return True
        if family == 'EC': return not sentence_open(text, frozenset())
        if family == 'EWA': return not sentence_open(text, CUE_A)
        if family == 'EWB': return not sentence_open(text, CUE_B)
        if family == 'EWAT': return not sentence_open(text, CUE_A) and not TERM.search(text.rstrip())
        raise ValueError(spec)
    return family, T, D, due
def run(audio, spec):
    family, T, D, due = policy(spec)
    s = Stream(); tracker = PauseTracker(D); pushes = []; forces = []; prev = ''; violations = 0; points = []
    started = time.monotonic()
    for off in range(0, len(audio), 1600):
        pkt = audio[off:off + 1600]; s.push(pkt); s.drain()
        quiet = tracker.push(pkt, 16000); at = (off + len(pkt)) / 16000
        if family != 'P0' and quiet >= T and s.last != s.done and s.last:
            # A decision point: another policy with this T and D that decides the
            # same at every point of this run has this run's output exactly.
            forced = due(s.last); points.append([at, s.last, forced])
            if forced:
                s.force(); s.drain(); tracker.utterance_ended(); forces.append(at)
        if s.last != prev:
            if not s.last.startswith(prev): violations += 1
            pushes.append([at, s.last]); prev = s.last
    final = s.finish()
    if not final.startswith(prev): violations += 1
    return {'final': final, 'pushes': pushes, 'forces': forces, 'points': points, 'violations': violations, 'wall_s': time.monotonic() - started, 'audio_s': len(audio) / 16000}
def first_force(audio, spec, p0):
    """Replay the policy's decision on P0's own text: the run is identical to P0's
    until its first forced end, so with no force at all P0's output is exact."""
    family, T, D, due = policy(spec)
    tracker = PauseTracker(D); pushes = p0['pushes']; k = 0; text = ''
    for off in range(0, len(audio), 1600):
        pkt = audio[off:off + 1600]; at = (off + len(pkt)) / 16000
        while k < len(pushes) and pushes[k][0] <= at + 1e-9: text = pushes[k][1]; k += 1
        if tracker.push(pkt, 16000) >= T and text and due(text): return at
    return None
def same_decisions(spec, row):
    """Whether spec decides as row's policy did at each of row's decision points."""
    _, _, _, due = policy(spec)
    return 'points' in row and all(due(text) == forced for _, text, forced in row['points'])
def main():
    items = [i for i in json.loads(Path(sys.argv[1]).read_text()) if i['split'] == sys.argv[2]]
    out = Path(sys.argv[3]); out.mkdir(parents=True, exist_ok=True)
    for spec in sys.argv[4:]:
        path = out / f'{spec}.jsonl'
        if path.exists(): continue
        load = lambda p: {r['name']: r for r in map(json.loads, p.read_text().splitlines())}
        p0rows = load(out / 'P0.jsonl') if spec != 'P0' else None
        family, T, D, _ = policy(spec)
        donors = []
        if spec != 'P0':
            for other in sorted(out.glob('*.jsonl')):
                o = other.stem
                if o != 'P0' and o != spec:
                    of, oT, oD, _ = policy(o)
                    if oT == T and oD == D: donors.append((o, load(other)))
        rows = []; reused = 0
        for it in items:
            audio = np.fromfile(AUDIO / it['audio'], np.float32)
            if spec != 'P0':
                if first_force(audio, spec, p0rows[it['name']]) is None:
                    p = p0rows[it['name']]; rows.append({'name': it['name'], 'policy': spec, 'final': p['final'], 'pushes': p['pushes'], 'forces': [],
                                                         'violations': p['violations'], 'wall_s': p['wall_s'], 'audio_s': p['audio_s'], 'reused': 'P0'}); reused += 1
                    continue
                donor = next((o for o, rs in donors if same_decisions(spec, rs[it['name']])), None)
                if donor:
                    d = dict(next(rs for o, rs in donors if o == donor)[it['name']]); d.update(policy=spec, reused=donor); rows.append(d); reused += 1
                    continue
            row = {'name': it['name'], 'policy': spec, **run(audio, spec)}
            if spec == 'P0' and it.get('uncut') and os.environ.get('VOCO_LAB_NO_UNCUT') != '1':
                row['uncut_final'] = run(np.fromfile(AUDIO / it['uncut'], np.float32), 'P0')['final']
            rows.append(row)
        tmp = path.with_suffix('.tmp'); tmp.write_text(''.join(json.dumps(r) + '\n' for r in rows)); tmp.rename(path)
        print(spec, 'done', round(sum(r['wall_s'] for r in rows), 1), 's', 'reused', reused, flush=True)
if __name__ == '__main__':
    main()
