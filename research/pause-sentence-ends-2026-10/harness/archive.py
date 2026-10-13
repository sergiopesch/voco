#!/usr/bin/env python3
"""Archive runs for results/: each row keeps what score.py reads, with final_at
(final_times) in place of every push, xz-compressed; policy colons become dashes.

  archive.py RUNS_DIR OUT_DIR
"""
import json, lzma, sys
from pathlib import Path
from score import final_times
KEEP = ('name', 'final', 'forces', 'violations', 'wall_s', 'audio_s', 'uncut_final')
runs, out = Path(sys.argv[1]), Path(sys.argv[2])
for path in sorted(runs.rglob('*.jsonl')):
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    kept = [{**{k: r[k] for k in KEEP if k in r}, 'final_at': final_times(r)} for r in rows]
    dest = out / path.relative_to(runs).parent / (path.stem.replace(':', '-') + '.jsonl.xz')
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(lzma.compress(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in kept).encode(), preset=9))
