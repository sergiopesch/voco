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


def run(output, fixtures=ROOT.parents[1]/'tests/fixtures/speech'):
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
                check('active cancel','error' not in exchange('cancel','three',2))
                check('spelling start',exchange('start','four',0,spelling='british')['text'] is None)
                check('spelling session final',exchange('finish','four',1)['text']=='')
                check('unknown spelling rejected','error' in exchange('start','five',0,spelling='klingon'))
                # A public LibriSpeech clip in which the model writes "etcetera":
                # the list's spelling comes back, and the pinned model carries
                # the tokenizer the recognizer needs to boost listed phrases.
                fixture=fixtures/'1462-170138-0000.wav'
                audio=np.frombuffer(fixture.read_bytes()[44:],dtype='<i2').astype(np.float32)/32768
                def dictate(session,**start):
                    exchange('start',session,0,**start)
                    for seq,offset in enumerate(range(0,len(audio),1600),start=1):
                        response=exchange('push',session,seq,audio=audio[offset:offset+1600].tolist(),rate=16000)
                        assert 'error' not in response,response
                    return exchange('finish',session,seq+1)['text']
                plain=dictate('six')
                listed=dictate('seven',words=['Dowson','et cetera'])
                check('listed words written as listed','et cetera' in listed and 'etcetera' not in listed and 'Dowson' in listed)
                check('an empty list changes nothing',dictate('eight',words=[])==plain)
                child.stdin.close();child.wait(timeout=10)
                check('EOF exits and reaps',child.returncode==0)
                logs=[json.loads(x) for x in (Path(state)/'voco/stream-performance/worker.jsonl').read_text().splitlines()]
                check('warmup logged',any(row.get('event')=='worker_ready' and row['warmup_ms']>0 for row in logs))
                identity=json.loads((ROOT/'MODEL-IDENTITY.json').read_text())
                check('ready logs the verified model and thread count',any(row.get('event')=='worker_ready'
                      and row['model_sha256']==identity['model_sha256'] and type(row['cpu_threads']) is int
                      and 1<=row['cpu_threads']<=16 for row in logs))
                check('content-free logs',all(not ({'audio','text','transcript','app_name','words','phrases'} & x.keys()) for x in logs))
                check('logs never name listed words','Dowson' not in json.dumps(logs))
                errors.flush()
                check('the model carries the tokenizer for boosting','no phrases could be tokenized' not in (output/'worker-protocol.stderr').read_text())
                # The adapter hands phrases to the decoder: at the runtime's
                # strongest boost, a listed phrase overrides what the model hears
                # ("lotable") in another public clip.
                from adapters import Nemotron
                clip=np.frombuffer((fixtures/'1673-143396-0000.wav').read_bytes()[44:],dtype='<i2').astype(np.float32)/32768
                model=Nemotron(1)
                def recognise(*start):
                    model.start(*start)
                    for offset in range(0,len(clip),1600):model.push(clip[offset:offset+1600],16000)
                    return model.finish().lower()
                try:
                    check('a phrase reaches the decoder','laudable' not in recognise() and 'laudable' in recognise(['a laudable'],5.0))
                finally:
                    model.close()
                (output/'worker-protocol-metrics.json').write_text(json.dumps(logs,indent=2)+'\n')
            finally:
                if child.poll() is None:child.kill();child.wait()
    (output/'worker-protocol-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps({'checks':len(results),'passed':all(r['passed'] for r in results)}))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT)
    # A packaged worker has no fixtures beside it; release assembly names the checkout's.
    parser.add_argument("--fixtures", type=Path, default=ROOT.parents[1]/"tests/fixtures/speech")
    arguments = parser.parse_args()
    run(arguments.output_dir, arguments.fixtures)
