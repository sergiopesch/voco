"""Real model, local subprocess, bounded protocol/lifecycle checks."""
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile
import time
import sys
import numpy as np
ROOT=Path(__file__).resolve().parent


def run(output):
    output.mkdir(parents=True, exist_ok=True)
    results=[]
    with tempfile.TemporaryDirectory() as state:
        with (output/'worker-protocol.stderr').open('w') as errors:
            child=subprocess.Popen([sys.executable,str(ROOT/'stream_worker.py')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=errors,text=True,env={**os.environ,'XDG_STATE_HOME':state,'VOCO_PERFORMANCE_LOG':'1'})
            def read():
                assert select.select([child.stdout],[],[],30)[0], 'worker timeout'
                return json.loads(child.stdout.readline())
            def exchange(op,session,seq,**fields):
                child.stdin.write(json.dumps({'op':op,'session':session,'seq':seq,**fields})+'\n');child.stdin.flush();response=read()
                assert response.get('session')==session and response.get('seq')==seq
                return response
            def check(name,condition):
                results.append({'name':name,'passed':bool(condition)});assert condition,name
            try:
                check('inference warmed before ready',read()['ready'])
                check('start',exchange('start','one',0)['text'] is None)
                check('reject stale push', 'error' in exchange('push','old',1,audio=[0.]*800,rate=16000))
                check('start replacement',exchange('start','two',0)['text'] is None)
                check('old cancellation cannot close replacement','error' not in exchange('cancel','one',3))
                check('replacement still accepts audio','error' not in exchange('push','two',1,audio=[0.]*800,rate=16000))
                check('silence final empty',exchange('finish','two',2)['text']=='')
                check('cannot push after finish','error' in exchange('push','two',3,audio=[0.]*800,rate=16000))
                exchange('start','three',0)
                check('duplicate sequence rejected','error' in exchange('push','three',0,audio=[0.]*800,rate=16000))
                check('invalid rate rejected','error' in exchange('push','three',1,audio=[0.]*800,rate=0))
                exchange('cancel','three',2)
                child.stdin.close();child.wait(timeout=10)
                check('EOF exits and reaps',child.returncode==0)
                logs=[json.loads(x) for x in (Path(state)/'voco/stream-performance/worker.jsonl').read_text().splitlines()]
                check('warmup logged',any(row.get('event')=='worker_ready' and row['warmup_ms']>0 for row in logs))
                check('content-free logs',all(not ({'audio','text','transcript','app_name'} & x.keys()) for x in logs))
                (output/'worker-protocol-metrics.json').write_text(json.dumps(logs,indent=2)+'\n')
            finally:
                if child.poll() is None:child.kill();child.wait()
    (output/'worker-protocol-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps({'checks':len(results),'passed':all(r['passed'] for r in results)}))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT)
    run(parser.parse_args().output_dir)
