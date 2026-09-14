#!/usr/bin/env python3
"""Prepare a fixed speech/hallucination plan, then evaluate an explicitly chosen worker."""

if not __debug__:
    raise RuntimeError("Speech validation requires Python assertions; rerun without -O, -OO, or PYTHONOPTIMIZE.")

import argparse
import array
import hashlib
import json
import math
import os
from pathlib import Path
import random
from speech_worker import WorkerResponses
import subprocess
import tarfile
import time
import traceback
import wave

REPO = Path(__file__).resolve().parent.parent
RATE = 16000

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def pcm(path):
    with wave.open(str(path)) as audio:
        assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, RATE)
        return array.array('h', audio.readframes(audio.getnframes()))

def write_pcm(path, samples):
    with wave.open(str(path), 'wb') as audio:
        audio.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        audio.writeframes(samples.tobytes())

def prepare(args):
    out = args.plan_dir.resolve()
    out.mkdir(parents=True, exist_ok=False)
    manifest_path = REPO / 'tests/fixtures/speech/manifest.json'
    manifest = json.loads(manifest_path.read_text())
    cases = []
    combined = array.array('h')
    def add(name, family, samples, reference, max_wer=0.25, source=None):
        assert 0 < len(samples) <= 30 * RATE
        path = out / (name + '.wav')
        write_pcm(path, samples)
        start = len(combined)
        combined.extend(samples)
        cases.append(dict(id=name, family=family, file=path.name, sha256=sha(path),
                          pcmSha256=hashlib.sha256(samples.tobytes()).hexdigest(),
                          startSample=start, endSample=len(combined), reference=reference,
                          maxWer=max_wer, expectedSpeech=bool(reference), source=source))
    originals = []
    for entry in manifest['fixtures']:
        path = REPO / 'tests/fixtures/speech' / entry['file']
        assert sha(path) == entry['sha256']
        originals.append((entry, pcm(path)))
    phrase = originals[0][1]
    repeated = (phrase + array.array('h', [0] * 4000)) * 16
    for family in ['leading-silence', 'onset-crop']:
        for ms in [0, 50, 100, 250, 500]:
            offset = ms * 16
            samples = ((array.array('h', [0] * offset) + repeated) if family == 'leading-silence' else repeated[offset:])[:480000]
            add(f'phase-{family}-{ms}', 'phase-original', samples, ' '.join(['GO DO YOU HEAR'] * 13))
    for family in ['leading-silence', 'onset-crop']:
        for ms in [25, 175, 375, 750]:
            offset = ms * 16
            samples = ((array.array('h', [0] * offset) + repeated) if family == 'leading-silence' else repeated[offset:])[:480000]
            add(f'heldout-{family}-{ms}', 'phase-heldout', samples, ' '.join(['GO DO YOU HEAR'] * 13))
    for entry, samples in originals:
        for gain in [1, 0.1, 0.01]:
            scaled = array.array('h', (round(x * gain) for x in samples))
            add(f"natural-{entry['id']}-gain-{gain}", 'natural' if gain == 1 else 'quiet', scaled,
                entry['reference'], entry['maxWer'], entry)
    for pause_seconds in [1, 5]:
        selected = [originals[i] for i in [0, 4, 5]]
        samples = array.array('h')
        for index, (_, segment) in enumerate(selected):
            if index:
                samples.extend([0] * (pause_seconds * RATE))
            samples.extend(segment)
        add(f'pause-{pause_seconds}', 'pauses', samples, ' '.join(e['reference'] for e, _ in selected))
    # The previously selected public fixtures are checked in; archive decoding is optional.
    unseen_path = REPO / 'tests/fixtures/speech/adversarial/manifest.json'
    unseen = json.loads(unseen_path.read_text())
    assert unseen['schemaVersion'] == 1 and len(unseen['fixtures']) == 4
    assert unseen['excludedSpeakerIds'] == [entry['speakerId'] for entry, _ in originals]
    assert unseen['archiveMd5'] == manifest['archiveMd5']
    archive = args.archive.resolve() if args.archive else None
    decoded_by_id = {}
    if archive:
        assert hashlib.md5(archive.read_bytes()).hexdigest() == unseen['archiveMd5']
        assert sha(archive) == unseen['archiveSha256']
        with tarfile.open(archive) as tar:
            members = [m for m in tar.getmembers() if m.name.endswith('.flac') and '/dev-clean/' in m.name]
            excluded = set(unseen['excludedSpeakerIds'])
            speakers = sorted({m.name.split('/')[2] for m in members} - excluded, key=int)[:4]
            selected = [min((m.name for m in members if m.name.split('/')[2] == speaker)) for speaker in speakers]
            assert selected == [entry['sourceMember'] for entry in unseen['fixtures']]
            for entry in unseen['fixtures']:
                raw = tar.extractfile(entry['sourceMember']).read()
                assert hashlib.sha256(raw).hexdigest() == entry['sourceFlacSha256']
                flac = out / (entry['id'] + '.flac')
                flac.write_bytes(raw)
                decoded = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(flac), '-f', 's16le', '-ac', '1', '-ar', str(RATE), '-'])
                decoded_by_id[entry['id']] = array.array('h', decoded)
                transcript_member = str(Path(entry['sourceMember']).parent / ('-'.join(entry['id'].split('-')[:2]) + '.trans.txt'))
                lines = tar.extractfile(transcript_member).read().decode().splitlines()
                assert next(line.split(' ', 1)[1] for line in lines if line.startswith(entry['id'] + ' ')) == entry['reference']
    for entry in unseen['fixtures']:
        assert Path(entry['file']).name == entry['file'] and entry['file'].endswith('.wav')
        cached = unseen_path.parent / entry['file']
        assert sha(cached) == entry['sha256'] and entry['maxWer'] == 0.5
        samples = decoded_by_id[entry['id']] if archive else pcm(cached)
        assert hashlib.sha256(samples.tobytes()).hexdigest() == entry['pcmSha256']
        assert len(samples) == round(entry['seconds'] * RATE)
        add('unseen-' + entry['id'], 'unseen-natural', samples, entry['reference'], entry['maxWer'],
            dict(member=entry['sourceMember'], sourceFlacSha256=entry['sourceFlacSha256']))
    for seconds in [3, 30]:
        length = seconds * RATE
        add(f'silence-{seconds}', 'nonspeech', array.array('h', [0] * length), '')
        for amplitude in [3, 300, 3000]:
            rng = random.Random(5042026)
            samples = array.array('h', (rng.randint(-amplitude, amplitude) for _ in range(length)))
            add(f'noise-{seconds}-{amplitude}', 'nonspeech', samples, '')
        tone = array.array('h', (round(3000 * math.sin(2 * math.pi * 440 * i / RATE)) for i in range(length)))
        add(f'tone-{seconds}', 'nonspeech', tone, '')
    write_pcm(out / 'combined.wav', combined)
    plan = dict(schemaVersion=1, createdBeforeInference=True, runnerSha256=sha(__file__),
                sourceManifestSha256=sha(manifest_path), modelSha256=manifest['modelSha256'],
                archiveSha256=unseen['archiveSha256'], unseenManifestSha256=sha(unseen_path),
                unseenInput='verified-archive' if archive else 'verified-repository-wavs', aggregateMaxWer=manifest['maxAggregateWer'],
                combinedSha256=sha(out / 'combined.wav'), cases=cases,
                notes=['Original phase10 PCM is unchanged. Thirteen phrase references include truncated boundary words; WER exposes boundary errors without choosing a reference after inference.',
                       'Every speech case requires nonempty lexical output and its fixed maxWer; each speech family also requires aggregate WER <= 0.25.',
                       'Every non-speech case requires zero lexical output. Scores never discard failures.'])
    (out / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    print(json.dumps({'preparedCases': len(cases), 'planSha256': sha(out / 'plan.json')}))

def evaluate_run(args):
    directory = args.plan_dir.resolve()
    plan = json.loads((directory / 'plan.json').read_text())
    assert sha(directory / 'combined.wav') == plan['combinedSha256']
    for case in plan['cases']:
        assert sha(directory / case['file']) == case['sha256']
    model = Path(os.environ['VOCO_MODEL_PATH']).resolve()
    assert sha(model) == plan['modelSha256']
    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=False)
    metadata = dict(planSha256=sha(directory / 'plan.json'), workerSha256=sha(args.worker),
                    modelSha256=sha(model), currentWorktreeGitHead=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip(),
                    currentWorktreeTranscribeSourceSha256=sha(REPO / 'apps/desktop/src-tauri/src/transcribe.rs'),
                    workerSourceSha256=sha(args.worker_source) if args.worker_source else None, runnerSha256=sha(__file__), responseReaderSha256=sha(Path(__file__).with_name("speech_worker.py")))
    (out / 'provenance.json').write_text(json.dumps(metadata, indent=2))
    results = []
    with (out / 'worker.stderr').open('w') as log:
        process = subprocess.Popen([str(args.worker.resolve()), str(directory / 'combined.wav')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log)
        responses = WorkerResponses(process.stdout)
        try:
            for case in plan['cases']:
                (out / 'active-case.json').write_text(json.dumps(case, indent=2))
                (out / 'active-response.json').write_text('null\n')
                began = time.monotonic()
                request = {key: case[key] for key in ['startSample', 'endSample']}
                request.update(canonical=True, previousCanonicalText='')
                process.stdin.write((json.dumps(request) + '\n').encode())
                process.stdin.flush()
                response = responses.read()
                (out / 'active-response.json').write_text(json.dumps(response, indent=2))
                # Reuse the established repository scoring implementation, including S/D/I tie order.
                scoring = "import {scoreTranscript} from './scripts/speech-score.mjs'; let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify(scoreTranscript(x.reference,x.text)));"
                score = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', scoring], input=json.dumps({'reference':case['reference'], 'text':response['chunkText']}), text=True, cwd=REPO, timeout=10))
                item = dict(id=case['id'], family=case['family'], response=response, score=score, elapsedSeconds=time.monotonic()-began)
                results.append(item)
                (out / 'responses.json').write_text(json.dumps(results, indent=2))
                print(json.dumps(item), flush=True)
        finally:
            try:
                process.stdin.close()
            except OSError:
                pass
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            (out / 'worker-status.json').write_text(json.dumps({'workerExitCode':process.returncode}))
    families = {}
    for case, result in zip(plan['cases'], results):
        score = result['score']
        result['passed'] = (score['hypothesisWords'] > 0 and score['wer'] <= case['maxWer']) if case['expectedSpeech'] else score['hypothesisWords'] == 0
        if case['expectedSpeech']:
            totals = families.setdefault(case['family'], {'edits': 0, 'words': 0})
            totals['edits'] += score['edits']
            totals['words'] += score['referenceWords']
    for totals in families.values():
        totals['wer'] = totals['edits'] / totals['words']
        totals['passed'] = totals['wer'] <= plan['aggregateMaxWer']
    passed = process.returncode == 0 and len(results) == len(plan['cases']) and all(r['passed'] for r in results) and all(f['passed'] for f in families.values())
    report = dict(**metadata, workerExitCode=process.returncode, passed=passed, completedCases=len(results), families=families, results=results)
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    raise SystemExit(0 if passed else 1)

def evaluate(args):
    # Never overwrite previous evidence, including when setup fails before inference.
    out = args.output_dir.resolve()
    existed = out.exists()
    try:
        evaluate_run(args)
    except Exception as error:
        if not existed:
            out.mkdir(parents=True, exist_ok=True)
            def saved(name, default):
                path = out / name
                return json.loads(path.read_text()) if path.exists() else default
            results = saved('responses.json', [])
            report = dict(**saved('provenance.json', {}), **saved('worker-status.json', {}),
                          passed=False, completedCases=len(results), results=results,
                          failure={'type':type(error).__name__, 'message':str(error)},
                          failureCase=saved('active-case.json', None), failureResponse=saved('active-response.json', None))
            (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
            (out / 'failure.traceback').write_text(traceback.format_exc())
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('prepare')
    p.add_argument('--plan-dir', type=Path, required=True)
    p.add_argument('--archive', type=Path, help='Optional original corpus archive to verify and re-decode the same cached selection')
    e = commands.add_parser('evaluate')
    e.add_argument('--plan-dir', type=Path, required=True)
    e.add_argument('--output-dir', type=Path, required=True)
    e.add_argument('--worker', type=Path, required=True)
    e.add_argument('--worker-source', type=Path, help='Frozen source snapshot associated with this worker; worktree provenance is recorded separately')
    args = parser.parse_args()
    (prepare if args.command == 'prepare' else evaluate)(args)


if __name__ == '__main__':
    main()
