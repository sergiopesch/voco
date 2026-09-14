#!/usr/bin/env python3
"""Verify prospective combined-recovery preview differences without excluding controls."""

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
parser.add_argument('--expectations', type=Path, required=True)
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
expectations=json.loads(args.expectations.read_text())
assert expectations['selectedCases']==metadata['selectedCaseIds']
assert expectations['sourcePlanSha256s']==metadata['planSha256s']
metadata['expectationsSha256']=sha(args.expectations)
(out/'plan.json').write_text(json.dumps(metadata,indent=2)+'\n')
observations = {'baseline':{},'candidate':{}}
worker_status = []
failure = None
active_case = None
try:
    for label,worker in [('baseline',args.baseline_worker),('candidate',args.candidate_worker)]:
        for index,(directory,_,cases) in enumerate(plans):
            with (out/f'{label}-{index}.stderr').open('w') as log:
                process = subprocess.Popen([str(worker.resolve()),str(directory/'combined.wav')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log)
                responses = WorkerResponses(process.stdout)
                try:
                    for case in cases:
                        active_case = dict(label=label,id=case['id'])
                        began = time.monotonic()
                        request = {'startSample':case['startSample'],'endSample':case['endSample']}
                        process.stdin.write((json.dumps(request)+'\n').encode());process.stdin.flush()
                        response = responses.read()
                        observations[label][case['id']] = dict(response=response,elapsedSeconds=time.monotonic()-began)
                        (out/'responses.json').write_text(json.dumps(observations,indent=2))
                        assert isinstance(response['text'],str) and isinstance(response['segments'],list)
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
    failure = dict(type=type(error).__name__,message=str(error),activeCase=active_case)
    (out/'failure.traceback').write_text(traceback.format_exc())

comparisons = []
case_by_id={case['id']:case for _,_,cases in plans for case in cases}
scoring="import {scoreTranscript} from './scripts/speech-score.mjs'; let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify(scoreTranscript(x.reference,x.text)));"
def score(reference,text):
    return json.loads(subprocess.check_output(['node','--input-type=module','-e',scoring],input=json.dumps(dict(reference=reference,text=text)),text=True,cwd=Path(__file__).resolve().parents[1],timeout=10))
try:
    for identifier in metadata['selectedCaseIds']:
        old=observations['baseline'].get(identifier);new=observations['candidate'].get(identifier)
        record=dict(id=identifier,passed=False)
        comparisons.append(record)
        if old is None or new is None:continue
        before={k:old['response'][k] for k in ['text','segments']};after={k:new['response'][k] for k in ['text','segments']}
        record['completePreviewIdentical']=before==after
        decisions=new['response'].get('decodeDecisions',[])
        record['decisions']=decisions
        record['baselinePreview']=before;record['candidatePreview']=after
        if not decisions:continue
        retried=[d for d in decisions if d['retried']]
        if identifier=='noise-3-3':
            record['reason']='approved-lexical-confidence-guard'
            record['score']=score('',after['text'])
            record['passed']=record['score']['hypothesisWords']==0 and all(score('',seg['text'])['hypothesisWords']==0 for seg in after['segments']) and not retried
        elif identifier in expectations['permittedDifferenceCases'] and retried:
            record['reason']='near-end-single-region'
            case=case_by_id[identifier]
            record['baselineScore']=score(case['reference'],before['text']);record['score']=score(case['reference'],after['text'])
            valid=len(decisions)==1 and len(retried)==1
            d=retried[0]
            valid=valid and d.get('retryReason')=='near-end-single-region' and len(d['retryRanges'])==1 and d['retryAudioContexts']==[0] and not d['retryFailed']
            if valid:
                start,end=d['retryRanges'][0];offset=d.get('nearEndCompletionOffsetFrames')
                valid=isinstance(offset,int) and 0<=offset*160<d['inputSamples'] and 0<=start<end<=d['inputSamples']
                previous=start*1000//16000
                for segment in after['segments']:
                    valid=valid and previous<=segment['startMs']<=segment['endMs']<=end*1000//16000
                    previous=segment['endMs']
            record['timestampAndDecisionInvariants']=valid
            record['passed']=valid and record['score']['hypothesisWords']>0 and record['score']['wer']<=case['maxWer'] and record['score']['edits']<=record['baselineScore']['edits']
        else:
            record['reason']='unchanged-normal-preview'
            record['passed']=before==after and not retried and all(not d['nativeLowConfidenceRejection'] for d in decisions)
except Exception as error:
    failure=dict(type=type(error).__name__,message=str(error))
    (out/'failure.traceback').write_text(traceback.format_exc())
passed=failure is None and len(comparisons)==len(metadata['selectedCaseIds']) and all(x['passed'] for x in comparisons) and all(x['exitCode']==0 for x in worker_status)
report=dict(**metadata,passed=passed,failure=failure,workerStatus=worker_status,comparisons=comparisons,observations=observations)
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(passed=passed,cases=len(comparisons),failed=[x['id'] for x in comparisons if not x['passed']],changed=[x['id'] for x in comparisons if not x.get('completePreviewIdentical',False)])))
raise SystemExit(0 if passed else 1)
