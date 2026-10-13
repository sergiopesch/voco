#!/usr/bin/env python3
"""Exploratory (dev only): the worker's own StreamingSession, gate included, on items whose
inserted pause is digital silence instead of room tone. No forced ends."""
import json, sys, time
from pathlib import Path
import numpy as np
import os
sys.path.insert(0, os.environ['VOCO_LAB_RUNTIME'])
from streaming import StreamingSession
AUDIO = Path(os.environ['VOCO_PAUSE_AUDIO'])
import random
items = [i for i in json.load(open(sys.argv[1])) if i['split'] == 'dev' and any(j['inserted_s'] >= 1.2 for j in i['junctions'])]
items = sorted(random.Random(7).sample(items, 60), key=lambda i: i['name'])
mode = sys.argv[3]  # 'zero' or 'tone'
session = StreamingSession('zero')
rows = []
for it in items:
    a = np.fromfile(AUDIO / it['audio'], np.float32)
    if mode == 'zero':
        a = a.copy()
        for j in it['junctions']:
            a[int(j['pause_start_s'] * 16000):int(j['pause_end_s'] * 16000)] = 0
    session.start(); pushes = []; prev = ''; t0 = time.monotonic()
    for off in range(0, len(a), 1600):
        t = session.push(a[off:off + 1600], 16000)
        if t is not None and t != prev: pushes.append([(off + 1600) / 16000, t]); prev = t
    final = session.finish()
    rows.append({'name': it['name'], 'policy': mode, 'final': final, 'pushes': pushes, 'forces': [], 'violations': 0, 'wall_s': time.monotonic() - t0, 'audio_s': len(a) / 16000})
Path(sys.argv[2]).write_text(''.join(json.dumps(r) + '\n' for r in rows))
print(mode, len(rows))
