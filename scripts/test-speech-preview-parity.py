#!/usr/bin/env python3
"""Compare complete unflagged preview objects on all supported fixed-plan controls."""

if not __debug__:
    raise RuntimeError("Speech validation requires Python assertions; rerun without -O, -OO, or PYTHONOPTIMIZE.")

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import traceback
from speech_worker import WorkerResponses

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--plan-dir', type=Path, action='append', required=True)
parser.add_argument('--baseline-worker', type=Path, required=True)
parser.add_argument('--candidate-worker', type=Path, required=True)
parser.add_argument('--baseline-source', type=Path, required=True)
parser.add_argument('--candidate-source', type=Path, required=True)
parser.add_argument('--output-dir', type=Path, required=True)
args = parser.parse_args()
def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
out = args.output_dir.resolve()
out.mkdir(parents=True, exist_ok=False)
plans = []
for directory in args.plan_dir:
    directory = directory.resolve()
    plan = json.loads((directory/'plan.json').read_text())
    assert sha(directory/'combined.wav') == plan['combinedSha256']
    cases = [case for case in plan['cases'] if 0.7*16000 <= case['endSample']-case['startSample'] <= 20*16000]
    for case in cases:
        assert sha(directory/case['file']) == case['sha256']
    plans.append((directory,plan,cases))
if not any(cases for _, _, cases in plans):
    (out/'report.json').write_text(json.dumps({'passed':False,'failure':'No eligible preview cases; parity cannot pass vacuously'})+'\n')
    raise SystemExit('No eligible preview cases; no workers started')
model = Path(os.environ['VOCO_MODEL_PATH'])
assert all(sha(model) == plan['modelSha256'] for _,plan,_ in plans)
metadata = dict(runnerSha256=sha(__file__),responseReaderSha256=sha(Path(__file__).with_name('speech_worker.py')),
                baselineWorkerSha256=sha(args.baseline_worker),candidateWorkerSha256=sha(args.candidate_worker),
                baselineSourceSha256=sha(args.baseline_source),candidateSourceSha256=sha(args.candidate_source),
                modelSha256=sha(model),planSha256s=[sha(directory/'plan.json') for directory,_,_ in plans],
                selectedCaseIds=[case['id'] for _,_,cases in plans for case in cases])
(out/'plan.json').write_text(json.dumps(metadata,indent=2)+'\n')
observations = {'baseline':{},'candidate':{}}
worker_status = []
failure = None
try:
    for label,worker in [('baseline',args.baseline_worker),('candidate',args.candidate_worker)]:
        for index,(directory,_,cases) in enumerate(plans):
            with (out/f'{label}-{index}.stderr').open('w') as log:
                process = subprocess.Popen([str(worker.resolve()),str(directory/'combined.wav')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log)
                responses = WorkerResponses(process.stdout)
                try:
                    for case in cases:
                        began = time.monotonic()
                        request = {'startSample':case['startSample'],'endSample':case['endSample']}
                        process.stdin.write((json.dumps(request)+'\n').encode());process.stdin.flush()
                        response = responses.read()
                        assert isinstance(response['text'],str) and isinstance(response['segments'],list)
                        observations[label][case['id']] = dict(response=response,elapsedSeconds=time.monotonic()-began)
                        (out/'responses.json').write_text(json.dumps(observations,indent=2))
                finally:
                    try:
                        process.stdin.close()
                    except OSError:
                        pass
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill();process.wait()
                    worker_status.append(dict(label=label,planIndex=index,exitCode=process.returncode))
except Exception as error:
    failure = dict(type=type(error).__name__,message=str(error))
    (out/'failure.traceback').write_text(traceback.format_exc())
comparisons = []
for identifier in metadata['selectedCaseIds']:
    old = observations['baseline'].get(identifier)
    new = observations['candidate'].get(identifier)
    same = False
    unflagged = False
    if old is not None and new is not None:
        old_value = {key:old['response'][key] for key in ['text','segments']}
        new_value = {key:new['response'][key] for key in ['text','segments']}
        same = old_value == new_value
        decisions = new['response'].get('decodeDecisions',[])
        unflagged = bool(decisions) and all(not decision['nativeLowConfidenceRejection'] and not decision['retried'] for decision in decisions)
    comparisons.append(dict(id=identifier,completePreviewIdentical=same,candidateUnflagged=unflagged))
passed = failure is None and all(status['exitCode']==0 for status in worker_status) and all(case['completePreviewIdentical'] and case['candidateUnflagged'] for case in comparisons)
report = dict(**metadata,passed=passed,failure=failure,workerStatus=worker_status,comparisons=comparisons,observations=observations)
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':passed,'cases':len(comparisons),'mismatches':[case['id'] for case in comparisons if not case['completePreviewIdentical']],'flagged':[case['id'] for case in comparisons if not case['candidateUnflagged']]}))
raise SystemExit(0 if passed else 1)
