#!/usr/bin/env python3
"""Rebuild the results tables from the archive alone, and say whether each matches.

  regenerate.py RESULTS_DIR [OUT_DIR]

Unpacks results/items.json.xz and results/runs into a scratch folder in the
layout the scripts read, reruns each table's command there, and compares its
output with the committed table. prosody-dev.txt needs the audio, which isn't
archived, so it isn't rebuilt.
"""
import lzma, subprocess, sys, tempfile
from pathlib import Path
HERE = Path(__file__).resolve().parent
TABLES = {
    'dev-table.txt': ['summarize.py', 'runs/dev', 'P0', 'E:0.6', 'E:0.8', 'E:1.0', 'E:1.2', 'E:1.5', 'E:2.0', 'EC:0.8', 'EC:1.0', 'EC:1.2', 'EC:1.5',
                      'EWA:0.8', 'EWA:1.0', 'EWA:1.2', 'EWA:1.5', 'EWB:0.8', 'EWB:1.0', 'EWB:1.2', 'EWB:1.5', 'EWAT:1.0', 'EWAT:1.2'],
    'test-table.txt': ['summarize.py', 'runs/test', 'P0', 'EWB:1.0'],
    'break-even-dev.txt': ['break_even.py', 'dev', 'EWB:0.8@0.8', 'EWB:1.0@1.0', 'EWB:1.2@1.2', 'EWB:1.5@1.6', 'E:1.2@1.2'],
    'break-even-test.txt': ['break_even.py', 'test', 'EWB:1.0@1.0'],
    'cue-analysis-E0.8.txt': ['cue_analysis.py', 'E:0.8'],
    'lookahead-dev.txt': ['compare.py', 'dev', 'runs/dev-R6/P0.jsonl', 'runs/dev-R13/P0.jsonl'],
    'lookahead-test.txt': ['compare.py', 'test', 'runs/test-R6/P0.jsonl'],
    'zero60.txt': ['score_subset.py', 'runs/dev-zero60.jsonl'],
}
def unpack(results, work):
    (work / 'items.json').write_bytes(lzma.decompress((results / 'items.json.xz').read_bytes()))
    for path in (results / 'runs').rglob('*.jsonl.xz'):
        name = path.name[:-len('.jsonl.xz')]
        if path.parent != results / 'runs': name = name.replace('-', ':', 1)
        dest = work / 'runs' / path.parent.relative_to(results / 'runs') / (name + '.jsonl')
        dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(lzma.decompress(path.read_bytes()))
def main():
    results = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
    with tempfile.TemporaryDirectory() as scratch:
        work = Path(scratch); unpack(results, work); ok = True
        for table, (script, *args) in TABLES.items():
            run = subprocess.run([sys.executable, str(HERE / script), *args], cwd=work, capture_output=True, text=True)
            if run.returncode:
                ok = False; print('FAILED  ' + table + ': ' + run.stderr.strip().splitlines()[-1]); continue
            if out: out.mkdir(parents=True, exist_ok=True); (out / table).write_text(run.stdout)
            same = (results / table).exists() and (results / table).read_text() == run.stdout
            ok &= same; print(('same    ' if same else 'DIFFERS ') + table)
        sys.exit(0 if ok else 1)
if __name__ == '__main__':
    main()
