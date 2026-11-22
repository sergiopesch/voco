#!/usr/bin/python3.12
"""One line per result file:  show.py [glob]"""
import glob, json, sys
for f in sorted(glob.glob(sys.argv[1] if len(sys.argv) > 1 else "results/*.json")):
    r = json.load(open(f))
    l, c = r.get("ladder") or {}, r.get("classification") or {}
    err = r.get("harness_error") or (r.get("launch") or {}).get("error") or (r.get("window_error") or {}).get("error") or r.get("setup_error") or ""
    print(f"{r.get('case'):26} {r.get('scenario'):12} {r.get('config'):22} r{r.get('rep')} {r.get('client_type') or '-':8}"
          f"{l.get('outcome') or '-':17} rung={l.get('rung')} {c.get('class') or '-':10} agree={c.get('ladder_agrees')} "
          f"by={(l.get('find') or {}).get('found_by')} {(l.get('reason') or '')[:60]} {err[:80]}")
