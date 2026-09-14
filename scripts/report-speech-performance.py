#!/usr/bin/env python3
"""Summarize local speech logs; missing measurements remain unavailable."""
import argparse,collections,json,statistics,math
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('state',type=Path,help='VOCO state directory containing performance and stream-performance');args=p.parse_args()
def load(directory,pattern):
    rows=[];invalid=0
    for path in sorted(directory.glob(pattern)):
        for line in path.read_text().splitlines():
            try:
                row=json.loads(line)
                if not isinstance(row,dict) or not isinstance(row.get('event'),str):
                    invalid+=1
                else:
                    rows.append(row)
            except json.JSONDecodeError:invalid+=1
    return rows,invalid
worker,invalid=load(args.state/'stream-performance','worker.jsonl*')
backend,bad=load(args.state/'performance','*.jsonl*')
def dist(values):
    xs=sorted(x for x in values if type(x) in (int,float) and math.isfinite(x) and x>=0)
    return {'count':len(xs),'p50':statistics.median(xs) if xs else None,'p95':xs[min(len(xs)-1,round(.95*(len(xs)-1)))] if xs else None,'max':max(xs) if xs else None}
def cpu_delta(starts, ends):
    if not starts or not ends:
        return None
    values=[row.get(key) for row in (starts[0],ends[-1]) for key in ('cpu_user_s','cpu_system_s')]
    if not all(type(value) in (int,float) and math.isfinite(value) and value>=0 for value in values):
        return None
    delta=values[2]+values[3]-values[0]-values[1]
    return delta if delta>=0 else None
sessions=[]
for run in sorted({r.get('run_id') for r in worker if isinstance(r.get('run_id'),str) and r['run_id']}):
    records=sorted([r for r in worker if r.get('run_id')==run],key=lambda r:r.get('event_seq',0) if type(r.get('event_seq')) is int else 0)
    ready=next((r for r in records if r['event']=='worker_ready'),None)
    for session in dict.fromkeys(r.get('stream_session_hash') for r in records if isinstance(r.get('stream_session_hash'),str) and r['stream_session_hash']):
        rows=[r for r in records if r.get('stream_session_hash')==session]
        requests=[r for r in rows if r['event']=='request_completed'];starts=[r for r in requests if r.get('op')=='start'];ends=[r for r in requests if r.get('op')=='finish']
        first=next((r for r in rows if r['event']=='first_hypothesis'),None)
        matching=[r for r in backend if r.get('stream_session_hash')==session]
        sessions.append({'worker_run_id':run,'stream_session_hash':session,'dictation_session_id':rows[0].get('dictation_session_id'),
            'model':ready.get('model') if ready else None,'requests':len(requests),'completed':bool(ends),
            'first_hypothesis_ms':first.get('elapsed_ms') if first else None,
            'worker_cpu_s':cpu_delta(starts,ends),
            'recognizer_push_ms':dist(r.get('recognizer_push_ms') for r in requests if r.get('op')=='push'),
            'result_drain_ms':dist(r.get('result_drain_ms') for r in requests if r.get('op')=='push'),
            'gate_released_frames_per_request':dist(r.get('gate_released_frames') for r in requests if r.get('op')=='push'),
            'recognizer_push_calls_per_request':dist(r.get('recognizer_push_calls') for r in requests if r.get('op')=='push'),
            'first_nonzero_audio_s':next((r['first_nonzero_audio_s'] for r in requests if r.get('first_nonzero_audio_s') is not None),None),
            'request_ms':dist(r.get('total_ms') for r in requests),'queue_age_ms':dist(r.get('queue_age_ms') for r in requests),
            'errors':dict(collections.Counter(r.get('error_code','unknown') for r in rows if r['event']=='request_failed')),
            'app_failures':dict(collections.Counter(r.get('reason',r.get('outcome')) for r in matching if r.get('reason') or r.get('outcome')!='ok'))})
print(json.dumps({'scope':'Worker recognition and app IPC only; first hypothesis is not verified cursor appearance or acoustic onset. CPU/RSS exclude other app processes. First nonzero sample is not speech onset. Missing timing fields remain unavailable.',
    'coverage':{'worker_records':len(worker),'backend_records':len(backend),'invalid_lines':invalid+bad,
        'worker_dropped_events':sum(max((r.get('dropped_events',0) for r in worker if r.get('run_id')==run),default=0) for run in {r.get('run_id') for r in worker if isinstance(r.get('run_id'),str)})},
    'startup_failures':[{'run_id':r.get('run_id'),'stage':r.get('stage'),'error_code':r.get('error_code')} for r in worker if r['event']=='worker_startup_failed'],
    'worker_process_failures':[{key:r.get(key) for key in ('stage','reason','exit_observed','exit_code','exit_signal')} for r in backend if r['event']=='speech_worker_failed'],
    'sessions':sessions},indent=2))
