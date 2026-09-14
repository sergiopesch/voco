#!/usr/bin/env python3
"""Freeze consented offline WAVs and references; never open a microphone or run inference."""
import argparse
import datetime as dt
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import wave

MODEL = 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002'
TEXTS = {
    'brief': 'Go. Do you hear?',
    'quiet': 'Please place the small blue cup beside the window.',
    'repetition': ' '.join(['Go. Do you hear?'] * 13),
    'long-pause': 'The first number is seven. The second number is nine.',
    'silence': '',
}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def require(condition, message):
    if not condition:
        raise ValueError(message)

MAX_FILE_BYTES = 256 * 1024 * 1024
MAX_SESSION_AUDIO_BYTES = 512 * 1024 * 1024

def regular(path):
    # Validate the opened object, not a path that can be swapped before reading.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode), f'Expected regular non-symlink file: {path}')
        require(info.st_size <= MAX_FILE_BYTES, f'File exceeds bounded import size: {path}')
        data = source.read(MAX_FILE_BYTES + 1)
        require(len(data) <= MAX_FILE_BYTES, f'File grew beyond bounded import size: {path}')
        return data

def number(value, name):
    require(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1, f'Invalid {name}')
    return value

def nonempty(value, name):
    require(isinstance(value, str) and 0 < len(value.strip()) <= 2000, f'Missing {name}')
    return value

def wav_pcm(data):
    with wave.open(io.BytesIO(data), 'rb') as wav:
        require((wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) == (1, 2, 16000, 'NONE'), 'Replay WAV must be mono 16kHz PCM16; provide explicitly documented derived WAV if conversion is needed')
        count = wav.getnframes()
        require(0 < count <= 600 * 16000, 'Take must contain 1..9,600,000 samples')
        pcm = wav.readframes(count)
        require(len(pcm) == count * 2, 'Truncated PCM data')
        return pcm

def write(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(data)

def canonical(pcm):
    out = io.BytesIO()
    with wave.open(out, 'wb') as wav:
        wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        wav.writeframes(pcm)
    return out.getvalue()

def template():
    return {'schemaVersion': 1, 'sessionId': 'participant-session-001',
        'consent': {'approved': False, 'participantAlias': None, 'scope': 'offline-import-and-local-evaluation', 'approvedAt': None, 'deleteAfter': None},
        'device': {'alias': None, 'connection': None, 'selectedInput': None, 'gainNotes': None},
        'environment': {'distribution': None, 'desktopSession': None, 'audioServer': None},
        'candidate': {'guiSha256': None, 'workerSha256': None, 'modelSha256': MODEL},
        'aggregateMaxWer': None,
        'cases': [{'id': name, 'status': 'not-run', 'originalWav': None, 'originalSha256': None,
                   'replayWav': None, 'replaySha256': None, 'conversion': None,
                   'reference': text, 'referenceProvenance': 'Original protocol text, frozen before recognition; participant must confirm actual spoken words',
                   'referenceVerifiedAgainstRecording': False, 'maxWer': None,
                   'captureNotes': None} for name, text in TEXTS.items()]}

def prepare(manifest, out):
    raw = regular(manifest)
    data = json.loads(raw)
    require(type(data.get('schemaVersion')) is int and data['schemaVersion'] == 1, 'Unsupported session schema')
    require(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}', data.get('sessionId', '')) is not None, 'Invalid sessionId')
    consent = data['consent']
    require(consent.get('approved') is True and consent.get('scope') == 'offline-import-and-local-evaluation', 'Explicit local import/evaluation consent required')
    nonempty(consent.get('participantAlias'), 'participant alias')
    approved = dt.datetime.fromisoformat(nonempty(consent.get('approvedAt'), 'consent time').replace('Z', '+00:00'))
    deletion = dt.datetime.fromisoformat(nonempty(consent.get('deleteAfter'), 'retention deadline').replace('Z', '+00:00'))
    now = dt.datetime.now(dt.timezone.utc)
    require(approved.tzinfo is not None and deletion.tzinfo is not None and approved <= now < deletion, 'Consent/retention dates invalid or expired')
    for group, keys in [('device', ['alias', 'connection', 'selectedInput', 'gainNotes']), ('environment', ['distribution', 'desktopSession', 'audioServer'])]:
        for key in keys:
            nonempty(data[group].get(key), group + '.' + key)
    candidate = data['candidate']
    require(candidate.get('modelSha256') == MODEL, 'Model must remain pinned')
    for key in ['guiSha256', 'workerSha256']:
        require(re.fullmatch('[0-9a-f]{64}', candidate.get(key) or '') is not None, 'Missing candidate ' + key)
    aggregate = number(data.get('aggregateMaxWer'), 'aggregateMaxWer')
    require(isinstance(data.get('cases'), list) and 1 <= len(data['cases']) <= 100, 'Expected 1..100 declared cases')
    seen, staged, ledger, combined, cases = set(), {}, [], bytearray(), []
    staged_bytes = 0
    for case in data['cases']:
        ident = case.get('id', '')
        require(isinstance(ident, str) and re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}', ident) is not None and ident not in seen, 'Invalid or duplicate case id')
        seen.add(ident)
        status = case.get('status')
        require(status in ['not-run', 'not-applicable', 'recorded'], 'Invalid case status')
        if status != 'recorded':
            if status == 'not-applicable':
                nonempty(case.get('captureNotes'), 'not-applicable reason')
            require(not case.get('originalWav') and not case.get('replayWav'), 'Unrun case must not claim imported audio')
            ledger.append({'id': ident, 'status': status, 'reason': case.get('captureNotes')})
            continue
        require(case.get('referenceVerifiedAgainstRecording') is True, 'Reference must be checked against actual take before recognition')
        require(isinstance(case.get('reference'), str) and len(case['reference']) <= 100000, 'Invalid reference')
        nonempty(case.get('referenceProvenance'), 'reference provenance')
        nonempty(case.get('captureNotes'), 'actual device/take notes')
        maximum = number(case.get('maxWer'), 'case maxWer')
        original = regular(manifest.parent / nonempty(case.get('originalWav'), 'originalWav'))
        require(sha(original) == case.get('originalSha256'), 'Original WAV hash mismatch')
        # Parse the untouched original as WAV; conversion of compressed formats is a human step.
        with wave.open(io.BytesIO(original), 'rb') as source:
            source_count, source_rate = source.getnframes(), source.getframerate()
            require(source_count > 0 and source_rate > 0, 'Empty original recording')
            require(len(source.readframes(source_count)) == source_count * source.getnchannels() * source.getsampwidth(), 'Truncated original recording')
        replay = original
        if case.get('replayWav'):
            nonempty(case.get('conversion'), 'full conversion command/parameters')
            replay = regular(manifest.parent / case['replayWav'])
            require(sha(replay) == case.get('replaySha256'), 'Derived WAV hash mismatch')
        else:
            require(case.get('conversion') is None and case.get('replaySha256') is None, 'Conversion metadata without derived file')
        pcm = wav_pcm(replay)
        require(abs(source_count / source_rate - len(pcm) / 32000) <= 1 / source_rate + 1 / 16000, 'Derived WAV changes original duration; no cropped or padded primary comparisons')
        emitted = canonical(pcm)  # Header normalization only; every PCM byte is identical.
        staged_bytes += len(original) + len(emitted) + (len(replay) if case.get('replayWav') else 0)
        require(staged_bytes <= MAX_SESSION_AUDIO_BYTES, 'Retained session audio exceeds 512MiB import limit')
        staged[f'{ident}.original.wav'] = original
        if case.get('replayWav'):
            staged[f'{ident}.derived-original.wav'] = replay
        staged[f'{ident}.wav'] = emitted
        start = len(combined) // 2
        combined.extend(pcm)
        require(len(combined) <= 512 * 1024 * 1024, 'Session exceeds 512MiB PCM limit')
        cases.append({'id': ident, 'family': 'consented-physical', 'file': f'{ident}.wav', 'sha256': sha(emitted), 'pcmSha256': sha(pcm),
                      'startSample': start, 'endSample': len(combined) // 2, 'reference': case['reference'],
                      'maxWer': maximum, 'expectedSpeech': bool(case['reference'].strip()),
                      'source': {'originalFile': f'{ident}.original.wav', 'originalSha256': sha(original), 'inputReplayFile': f'{ident}.derived-original.wav' if case.get('replayWav') else f'{ident}.original.wav', 'inputReplaySha256': sha(replay),
                                 'conversion': case.get('conversion'), 'referenceProvenance': case['referenceProvenance'],
                                 'referenceSha256': sha(case['reference'].encode()), 'captureNotes': case['captureNotes']}})
        ledger.append({'id': ident, 'status': 'imported-not-evaluated', 'physicalCaptureClaim': 'participant supplied; not independently verified'})
    require(cases, 'No recorded cases to import; template remains unrun')
    combined_wav = canonical(combined)
    plan = {'schemaVersion': 1, 'createdBeforeInference': True, 'runnerSha256': sha(Path(__file__).read_bytes()),
            'sessionManifestSha256': sha(raw), 'modelSha256': MODEL, 'candidate': candidate,
            'aggregateMaxWer': aggregate, 'combinedSha256': sha(combined_wav), 'combinedPcmSha256': sha(combined), 'cases': cases,
            'notes': ['Offline replay only. Imported audio does not prove app capture/device/session/shortcut behavior.', 'No upload, recording, resampling, filtering or inference performed. Original WAV bytes preserved.']}
    out.mkdir(mode=0o700, parents=False, exist_ok=False)
    for name, content in staged.items():
        write(out / name, content)
    write(out / 'combined.wav', combined_wav)
    write(out / 'session.json', raw)
    write(out / 'plan.json', (json.dumps(plan, indent=2) + '\n').encode())
    write(out / 'status.json', (json.dumps({'sessionId': data['sessionId'], 'status': 'imported-not-evaluated', 'cases': ledger,
                                         'deleteAfter': consent['deleteAfter'], 'automaticDeletionScheduled': False}, indent=2) + '\n').encode())
    print(json.dumps({'importedCases': len(cases), 'unrunCases': len(ledger) - len(cases), 'planSha256': sha((out / 'plan.json').read_bytes())}))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    init = sub.add_parser('template'); init.add_argument('--output', type=Path, required=True)
    imp = sub.add_parser('import'); imp.add_argument('--session', type=Path, required=True); imp.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'template':
        write(args.output, (json.dumps(template(), indent=2) + '\n').encode())
    else:
        prepare(args.session, args.output_dir)

if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, wave.Error) as error:
        raise SystemExit(str(error)) from error
