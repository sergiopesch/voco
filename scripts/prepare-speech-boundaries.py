#!/usr/bin/env python3
"""Prepare twelve fixed, complete-utterance boundary controls; never runs inference."""

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
def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path, data):
    with wave.open(str(path), 'wb') as audio:
        audio.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        audio.writeframes(data.tobytes())
manifest_path = repo / 'tests/fixtures/speech/manifest.json'
manifest = json.loads(manifest_path.read_text())
clips = []
for entry in manifest['fixtures'][:2]:
    path = manifest_path.parent / entry['file']
    assert sha(path) == entry['sha256']
    with wave.open(str(path)) as audio:
        assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) == (1, 2, 16000)
        clips.append((entry, array.array('h', audio.readframes(audio.getnframes()))))
cases = []
combined = array.array('h')
def add(name, duration, start, gain, index=0, family='brief-boundary'):
    entry, clip = clips[index]
    length = round(duration * 16000)
    samples = array.array('h', [0] * length)
    scaled = array.array('h', (round(value * gain) for value in clip))
    assert 0 <= start and start + len(scaled) <= length <= 480000
    samples[start:start + len(scaled)] = scaled
    path = out / (name + '.wav')
    write(path, samples)
    offset = len(combined)
    combined.extend(samples)
    cases.append(dict(id=name, family=family, file=path.name, sha256=sha(path),
                      pcmSha256=hashlib.sha256(samples.tobytes()).hexdigest(), startSample=offset,
                      endSample=len(combined), reference=entry['reference'], maxWer=entry['maxWer'],
                      expectedSpeech=True, source=entry, placementStartSample=start, gain=gain))
for duration in [15.01, 15.5, 16, 29.99, 30]:
    length = round(duration * 16000)
    add(f'tail-full-{duration}', duration, length-len(clips[0][1]), 1)
    add(f'center-quiet-{duration}', duration, (length-len(clips[0][1]))//2, 0.01, family='brief-quiet')
add('cross15-short', 30, 14 * 16000, 1, family='cross-boundary')
add('cross15-natural', 30, 8 * 16000, 1, index=1, family='cross-boundary')
write(out / 'combined.wav', combined)
plan = dict(schemaVersion=1, createdBeforeInference=True, runnerSha256=sha(__file__),
            sourceManifestSha256=sha(manifest_path), modelSha256=manifest['modelSha256'],
            aggregateMaxWer=manifest['maxAggregateWer'], combinedSha256=sha(out/'combined.wav'), cases=cases,
            notes=['Twelve prospectively fixed addon cases; original 58-case plan unchanged.',
                   'All utterances are complete, untruncated source PCM with exact public references.',
                   'Five fixed durations: 15.01,15.5,16,29.99,30 seconds. Each has full-gain speech ending at the tail and gain0.01 speech centered amid silence.',
                   'Two 30s clips cross15s: short phrase begins14s, independent longer phrase begins8s.',
                   'Retain baseline per-utterance maxWER and aggregate0.25 independently per family.'])
(out/'plan.json').write_text(json.dumps(plan, indent=2)+'\n')
print(json.dumps({'preparedCases':len(cases),'planSha256':sha(out/'plan.json')}))
