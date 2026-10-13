import json, sys
import numpy as np
from run_policies import run, AUDIO
items = [i for i in json.load(open(sys.argv[1])) if i['split'] == 'dev'][:6]
for it in items:
    a = np.fromfile(AUDIO / it['audio'], np.float32)
    r1 = run(a, 'P0'); r2 = run(a, 'P0'); r3 = run(a, 'E:1.0'); r4 = run(a, 'E:1.0')
    print(it['name'], r1['final'] == r2['final'] and r1['pushes'] == r2['pushes'], r3['final'] == r4['final'] and r3['forces'] == r4['forces'])
