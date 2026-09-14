#!/usr/bin/python3
"""Strict repeated-speech regression: retain every case and require nonempty, accurate text."""

if not __debug__:
    raise RuntimeError("Speech validation requires Python assertions; rerun without -O, -OO, or PYTHONOPTIMIZE.")

import array
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from speech_worker import WorkerResponses
import sys
import time
import wave

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir', type=Path, required=True, help='New directory for the full matrix evidence')
parser.add_argument('--worker', type=Path, help='Explicit replay worker; otherwise use the current Cargo target')
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
out = args.output_dir.resolve()
if out.exists():
    raise SystemExit('Output directory already exists; preserve prior evidence and choose a new directory')
manifest_path = repo / 'tests/fixtures/speech/manifest.json'
manifest = json.loads(manifest_path.read_text())
entry = next(item for item in manifest['fixtures'] if item['id'] == '84-121123-0000')
fixture = repo / 'tests/fixtures/speech' / entry['file']
if hashlib.sha256(fixture.read_bytes()).hexdigest() != entry['sha256']:
    raise SystemExit('Speech fixture checksum mismatch')
model_setting = os.environ.get('VOCO_MODEL_PATH')
if not model_setting:
    raise SystemExit('Set VOCO_MODEL_PATH to the existing pinned model; this diagnostic never downloads a model')
model = Path(model_setting).resolve()
if hashlib.sha256(model.read_bytes()).hexdigest() != manifest['modelSha256']:
    raise SystemExit('Pinned model checksum mismatch')
target = Path(os.environ.get('CARGO_TARGET_DIR', 'apps/desktop/src-tauri/target'))
if not target.is_absolute():
    target = repo / target
worker = (args.worker or target / 'debug/examples/preview_replay_worker').resolve()
if not worker.is_file():
    raise SystemExit('Build preview_replay_worker before running this diagnostic')
out.mkdir(parents=True)
with wave.open(str(fixture)) as w:
    assert (w.getframerate(), w.getsampwidth(), w.getnchannels()) == (16000, 2, 1)
    clip = array.array('h', w.readframes(w.getnframes()))
reference = (clip + array.array('h', [0] * 4000)) * 16
windows = []
plan = []
for family in ['leading-silence', 'onset-crop']:
    for milliseconds in [0, 50, 100, 250, 500]:
        offset = milliseconds * 16
        audio = ((array.array('h', [0] * offset) + reference) if family == 'leading-silence' else reference[offset:])[:480000]
        assert len(audio) == 480000
        plan.append(dict(family=family, offsetMs=milliseconds, samples=len(audio), pcmSha256=hashlib.sha256(audio.tobytes()).hexdigest(), reference=' '.join(['GO DO YOU HEAR'] * 13), maxWer=0.25))
        windows.append(audio)
audio_path = out / 'phase-matrix.wav'
with wave.open(str(audio_path), 'wb') as w:
    w.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
    for audio in windows:
        w.writeframes(audio.tobytes())
metadata = dict(schemaVersion=2, gitHead=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(), worktreeTranscribeSourceSha256=hashlib.sha256((repo / 'apps/desktop/src-tauri/src/transcribe.rs').read_bytes()).hexdigest(), manifestSha256=hashlib.sha256(manifest_path.read_bytes()).hexdigest(), runnerSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), responseReaderSha256=hashlib.sha256(Path(__file__).with_name('speech_worker.py').read_bytes()).hexdigest(), workerSha256=hashlib.sha256(worker.read_bytes()).hexdigest(), modelSha256=hashlib.sha256(model.read_bytes()).hexdigest(), fixtureSha256=hashlib.sha256(fixture.read_bytes()).hexdigest(), plan=plan)
assert metadata['modelSha256'] == manifest['modelSha256']
(out / 'phase-matrix-plan.json').write_text(json.dumps(metadata, indent=2))
results = []
failure = None
with (out / 'phase-matrix.stderr').open('w') as error_log:
    process = subprocess.Popen([str(worker), str(audio_path)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=error_log, env={**os.environ, 'VOCO_MODEL_PATH':str(model)})
    responses = WorkerResponses(process.stdout)
    try:
        for index, case in enumerate(plan):
            request = dict(startSample=index*480000, endSample=(index+1)*480000, canonical=True, previousCanonicalText='')
            began = time.monotonic()
            process.stdin.write((json.dumps(request) + '\n').encode()); process.stdin.flush()
            result = responses.read()
            if not isinstance(result.get('chunkText'), str):
                raise RuntimeError(f'Worker did not return chunkText: {result!r}')
            scoring = "import {scoreTranscript} from './scripts/speech-score.mjs'; let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify(scoreTranscript(x.reference,x.text)));"
            score = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', scoring], input=json.dumps({'reference':case['reference'], 'text':result['chunkText']}), text=True, cwd=repo, timeout=10))
            observed = {**case, 'result':result, 'empty':score['hypothesisWords'] == 0, 'score':score, 'passed':score['hypothesisWords'] > 0 and score['wer'] <= case['maxWer'], 'elapsedSeconds':time.monotonic()-began}
            results.append(observed)
            (out / 'phase-matrix-results.json').write_text(json.dumps({**metadata, 'completedCases':len(results), 'results':results},indent=2))
            print(json.dumps({k:observed[k] for k in ['family','offsetMs','empty','score','passed','elapsedSeconds']}), flush=True)
    except Exception as error:
        failure = f'{type(error).__name__}: {error}'
    finally:
        try:
            process.stdin.close()
        except BrokenPipeError:
            pass
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

passed = failure is None and process.returncode == 0 and len(results) == len(plan) and all(result['passed'] for result in results)
(out / 'phase-matrix-results.json').write_text(json.dumps({**metadata, 'completedCases':len(results), 'passed':passed, 'workerExitCode':process.returncode, 'error':failure, 'results':results}, indent=2))
print(json.dumps({'completedCases':len(results), 'emptyCases':sum(result['empty'] for result in results), 'passed':passed, 'workerExitCode':process.returncode, 'error':failure}))
raise SystemExit(0 if passed else 1)
