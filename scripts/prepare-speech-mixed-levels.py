#!/usr/bin/env python3
"""Freeze six sample-preserving mixed-level controls before any inference."""

if not __debug__:
    raise RuntimeError("Speech validation requires Python assertions; rerun without -O, -OO, or PYTHONOPTIMIZE.")

import argparse
import array
import hashlib
import json
from pathlib import Path
import wave

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--plan-dir', type=Path, required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
out = args.plan_dir.resolve()
out.mkdir(parents=True, exist_ok=False)
manifest_path = repo / 'tests/fixtures/speech/manifest.json'
manifest = json.loads(manifest_path.read_text())
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path, samples):
    with wave.open(str(path), 'wb') as wav:
        wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        wav.writeframes(samples.tobytes())
fixtures = []
for entry in manifest['fixtures']:
    path = manifest_path.parent / entry['file']
    assert sha(path) == entry['sha256']
    with wave.open(str(path)) as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16000)
        samples = array.array('h', wav.readframes(wav.getnframes()))
    fixtures.append((entry, samples))
combined = array.array('h')
cases = []
def add(name, parts, pause, impulse=False):
    audio = array.array('h', [0] * 16000) if impulse else array.array('h')
    if impulse:
        audio[8000] = 32767
    provenance = []
    for index, (fixture_index, gain) in enumerate(parts):
        if index:
            audio.extend([0] * round(pause * 16000))
        entry, original = fixtures[fixture_index]
        start = len(audio)
        scaled = array.array('h', (round(value * gain) for value in original))
        audio.extend(scaled)
        provenance.append({'fixtureId': entry['id'], 'sourceSha256': entry['sha256'],
                           'gain': gain, 'startSample': start, 'endSample': len(audio),
                           'sourceSamples': len(original), 'transformedPcmSha256': hashlib.sha256(scaled.tobytes()).hexdigest()})
        assert len(scaled) == len(original)
    assert 0 < len(audio) <= 480000
    path = out / (name + '.wav')
    write(path, audio)
    start = len(combined)
    combined.extend(audio)
    cases.append({'id': name, 'family': 'mixed-loudness', 'file': path.name,
                  'sha256': sha(path), 'pcmSha256': hashlib.sha256(audio.tobytes()).hexdigest(),
                  'startSample': start, 'endSample': len(combined),
                  'reference': ' '.join(fixtures[i][0]['reference'] for i, _ in parts),
                  'maxWer': 0.25, 'expectedSpeech': True,
                  'source': {'parts': provenance, 'interPartPauseSeconds': pause,
                             'impulse': {'sample': 8000, 'valuePcm16': 32767, 'leadingSilenceSamples': 16000} if impulse else None}})
# Indices 4/5 are explicitly zero-based: complete 174 and 251 utterances.
for pause in [0, 1]:
    add(f'quiet-brief-between-full-pause-{pause}', [(4, 1), (0, .01), (5, 1)], pause)
    add(f'quiet-long-between-brief-pause-{pause}', [(0, 1), (1, .01), (3, 1)], pause)
for gain in [1, .01]:
    add(f'impulse-before-complete-pair-gain-{gain}', [(0, gain), (3, gain)], .25, impulse=True)
write(out / 'combined.wav', combined)
plan = {'schemaVersion': 1, 'createdBeforeInference': True, 'runnerSha256': sha(Path(__file__)),
        'sourceManifestSha256': sha(manifest_path), 'modelSha256': manifest['modelSha256'],
        'aggregateMaxWer': 0.25, 'combinedSha256': sha(out / 'combined.wav'), 'cases': cases,
        'notes': ['Prospective six-case challenge; no case/reference selection after inference.',
                  'Complete utterances and every time-domain sample retained; quiet gain uses round(PCM16*0.01). No normalization or trimming.',
                  'One intentional full-scale sample is added in preceding silence for each impulse case; no source samples clipped.',
                  'Case and family WER <=0.25 are frozen diagnostic bounds, not measured baseline promises. Every speech case also requires nonempty lexical output.',
                  'Compare baseline and candidate on identical WAVs; report all failures, including baseline failures.']}
(out / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n')
print(json.dumps({'cases': len(cases), 'planSha256': sha(out / 'plan.json')}))
