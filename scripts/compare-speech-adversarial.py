#!/usr/bin/env python3
"""Compare complete fixed-plan runs without hiding individually worsened cases."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('baseline', type=Path)
parser.add_argument('candidate', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
if args.output.exists():
    raise SystemExit('Output exists; preserve earlier comparisons')
baseline = json.loads(args.baseline.read_text())
candidate = json.loads(args.candidate.read_text())
if baseline['planSha256'] != candidate['planSha256'] or baseline['modelSha256'] != candidate['modelSha256']:
    raise SystemExit('Runs do not share the exact plan and model')
if [r['id'] for r in baseline['results']] != [r['id'] for r in candidate['results']]:
    raise SystemExit('Runs have different or incomplete case lists')
changes = []
for old, new in zip(baseline['results'], candidate['results']):
    changes.append(dict(id=old['id'], family=old['family'],
                        baselineScore=old['score'], candidateScore=new['score'],
                        editDelta=new['score']['edits']-old['score']['edits'],
                        baselineText=old['response']['chunkText'], candidateText=new['response']['chunkText'],
                        baselinePassed=old['passed'], candidatePassed=new['passed']))
report = dict(baselineReportSha256=hashlib.sha256(args.baseline.read_bytes()).hexdigest(),
              candidateReportSha256=hashlib.sha256(args.candidate.read_bytes()).hexdigest(),
              planSha256=baseline['planSha256'], modelSha256=baseline['modelSha256'],
              baselinePassed=baseline['passed'], candidatePassed=candidate['passed'],
              improved=[c['id'] for c in changes if c['editDelta'] < 0],
              worsened=[c['id'] for c in changes if c['editDelta'] > 0],
              candidateFailures=[c['id'] for c in changes if not c['candidatePassed']],
              baselineFamilies=baseline['families'], candidateFamilies=candidate['families'], cases=changes)
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k:report[k] for k in ['baselinePassed','candidatePassed','improved','worsened','candidateFailures']}))
raise SystemExit(0 if report['candidatePassed'] and not report['worsened'] else 1)
