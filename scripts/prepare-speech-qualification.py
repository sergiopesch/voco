#!/usr/bin/env python3
"""Freeze twenty unseen-speaker qualification cases without running recognition."""

if not __debug__:
    raise RuntimeError("Speech validation requires Python assertions; rerun without -O, -OO, or PYTHONOPTIMIZE.")

import argparse
import array
import hashlib
import json
import math
from pathlib import Path
import random
import subprocess
import tarfile
import wave

RATE = 16000
SEED = 504202604
repo = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--archive', type=Path, required=True)
parser.add_argument('--plan-dir', type=Path, required=True)
args = parser.parse_args()
out = args.plan_dir.resolve()
out.mkdir(parents=True, exist_ok=False)
def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path, samples):
    with wave.open(str(path), 'wb') as audio:
        audio.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        audio.writeframes(samples.tobytes())
def rms(samples):
    return math.sqrt(sum(x*x for x in samples)/len(samples))
base_path = repo / 'tests/fixtures/speech/manifest.json'
extra_path = repo / 'tests/fixtures/speech/adversarial/manifest.json'
base = json.loads(base_path.read_text())
extra = json.loads(extra_path.read_text())
excluded = {e['speakerId'] for m in [base, extra] for e in m['fixtures']}
archive = args.archive.resolve()
assert hashlib.md5(archive.read_bytes()).hexdigest() == base['archiveMd5']
assert sha(archive) == extra['archiveSha256']
selected = []
with tarfile.open(archive) as tar:
    members = [m for m in tar.getmembers() if m.name.endswith('.flac') and '/dev-clean/' in m.name]
    speakers = sorted({m.name.split('/')[2] for m in members}-excluded, key=int)[:8]
    speaker_rows = {}
    for line in tar.extractfile('LibriSpeech/SPEAKERS.TXT').read().decode().splitlines():
        if line.strip() and not line.startswith(';'):
            row = [part.strip() for part in line.split('|')]
            speaker_rows[row[0]] = dict(name=row[4], corpusSex=row[1])
    for speaker in speakers:
        skipped = []
        for member in sorted((m for m in members if m.name.split('/')[2] == speaker), key=lambda m:m.name):
            raw = tar.extractfile(member).read()
            flac = out / Path(member.name).name
            flac.write_bytes(raw)
            decoded = subprocess.check_output(['ffmpeg','-v','error','-i',str(flac),'-f','s16le','-ac','1','-ar',str(RATE),'-'])
            samples = array.array('h', decoded)
            if not 0 < len(samples) <= 30 * RATE:
                skipped.append(dict(member=member.name,samples=len(samples)))
                continue
            identifier = flac.stem
            transcript_member = str(Path(member.name).parent / ('-'.join(identifier.split('-')[:2])+'.trans.txt'))
            lines = tar.extractfile(transcript_member).read().decode().splitlines()
            reference = next(line.split(' ',1)[1] for line in lines if line.startswith(identifier+' '))
            source = dict(id=identifier,speakerId=speaker,**speaker_rows[speaker],member=member.name,
                          sourceFlacSha256=hashlib.sha256(raw).hexdigest(),reference=reference,
                          samples=len(samples),skippedOverlong=skipped)
            selected.append((source,samples))
            break
        else:
            raise RuntimeError('No complete utterance <=30s for speaker '+speaker)
assert len(selected) == 8
combined = array.array('h')
cases = []
def add(name,family,samples,source,noise=None,placement=0):
    path = out/(name+'.wav')
    write(path,samples)
    start = len(combined)
    combined.extend(samples)
    cases.append(dict(id=name,family=family,file=path.name,sha256=sha(path),
                      pcmSha256=hashlib.sha256(samples.tobytes()).hexdigest(),startSample=start,
                      endSample=len(combined),reference=source['reference'],maxWer=0.5,expectedSpeech=True,
                      source=source,noise=noise,placementStartSample=placement))
def noisy(samples,length,start,seed):
    # Whole-utterance RMS defines SNR; background continues unchanged through padding.
    speech_rms = rms(samples)
    target = speech_rms / 100
    rng = random.Random(seed)
    raw = [rng.uniform(-1,1) for _ in range(length)]
    raw_rms = rms(raw)
    noise = array.array('h',(round(value * target/raw_rms) for value in raw))
    output = array.array('h',noise)
    for index,value in enumerate(samples):
        mixed = output[start+index]+value
        assert -32768 <= mixed <= 32767, 'Fixture would clip; do not silently normalize'
        output[start+index] = mixed
    observed = rms(noise)
    snr = 20*math.log10(speech_rms/observed)
    assert abs(snr-40) <= 0.25
    return output,dict(kind='seeded-uniform-white',seed=seed,targetSnrDb=40,actualSnrDb=snr,
                       speechRmsPcm16=speech_rms,noiseRmsPcm16=observed,
                       noisePcmSha256=hashlib.sha256(noise.tobytes()).hexdigest(),continuousAcrossPadding=True)
for index,(source,samples) in enumerate(selected):
    add('qualification-natural-'+source['id'],'qualification-natural',samples,source)
    output,noise = noisy(samples,len(samples),0,SEED+index)
    add('qualification-noisy-'+source['id'],'qualification-noisy',output,source,noise)
used = set()
for index,position in enumerate([0,5,10,'tail']):
    # First unused selected utterance that fits the fixed placement, never selected by ASR.
    source,samples = next((source,samples) for source,samples in selected
                         if source['id'] not in used and (position=='tail' or len(samples) <= (30-position)*RATE))
    used.add(source['id'])
    start = 30*RATE-len(samples) if position=='tail' else position*RATE
    output,noise = noisy(samples,30*RATE,start,SEED+100+index)
    add(f'qualification-pause-{position}-'+source['id'],'qualification-pauses',output,source,noise,start)
assert len(cases) == 20
write(out/'combined.wav',combined)
plan = dict(schemaVersion=1,createdBeforeInference=True,qualificationOnly=True,
            selection='Next eight numeric dev-clean speaker IDs excluding all twelve existing fixtures; first lexicographic complete utterance <=30s per speaker.',
            excludedSpeakerIds=sorted(excluded,key=int),selectedSources=[s for s,_ in selected],
            runnerSha256=sha(__file__),sourceManifestSha256=sha(base_path),additionalManifestSha256=sha(extra_path),
            archiveSha256=extra['archiveSha256'],archiveMd5=base['archiveMd5'],corpus=base['corpus'],
            source=base['source'],license='CC BY 4.0',copyright='2014 Vassil Panayotov',
            modelSha256=base['modelSha256'],aggregateMaxWer=0.25,
            combinedSha256=sha(out/'combined.wav'),cases=cases,
            notes=['Freeze without inference until production candidate passes development58 and boundary12.',
                   'All references are complete corpus utterances. No source words or timing edited.',
                   'Eight clean and same-eight 40dB SNR mixtures; four padded30s mixtures at0/5/10/tail use first unused selected utterance fitting placement.',
                   'Noise RMS measured across complete output; speech RMS measured across complete source utterance. Quantization allowed <=0.25dB deviation, no clipping.',
                   'Continuous seeded white noise spans silence padding; per-case WER<=0.5 and each family aggregate<=0.25 unchanged.'])
(out/'plan.json').write_text(json.dumps(plan,indent=2)+'\n')
print(json.dumps({'preparedCases':len(cases),'selectedSpeakers':speakers,'planSha256':sha(out/'plan.json')}))
