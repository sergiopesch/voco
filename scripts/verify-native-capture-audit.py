#!/usr/bin/env python3
"""Verify a committed development capture journal without capture or transcription."""
import argparse
import hashlib
import json
import os
import stat
from pathlib import Path
import struct

MAX_FRAMES = 26460000
MAX_PACKETS = 144 * 1024 * 1024
MAX_EVENTS = 131072
IDENTITY = {'captureId', 'sessionId', 'generation'}
RECEIPT = {'state', 'producedFrames', 'lastSequence', 'corkAcknowledged',
           'barrierAcknowledged', 'health', 'limitReached', 'acknowledgedSequence'}
FILES = {'descriptor.json', 'journal.json', 'packets.bin', 'raw.s16le'}


def need(condition, message):
    if not condition:
        raise ValueError(message)


def keys(value, expected):
    need(type(value) is dict and set(value) == set(expected), 'Unexpected object schema')


def integer(value, maximum=9007199254740991):
    need(type(value) is int and 0 <= value <= maximum, 'Invalid integer')
    return value


def decode_json(data):
    def pairs(rows):
        result = {}
        for key, value in rows:
            need(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_bounded(path, cap):
    # Open once: a replaced path cannot turn a checked file into a FIFO or symlink.
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as error:
        raise ValueError('Cannot open artifact without following links') from error
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, 'Artifact must be a single-link regular file')
        need(before.st_size <= cap, 'Artifact exceeds bound')
        data = stream.read(cap + 1)
        after = os.fstat(stream.fileno())
    need(len(data) <= cap and len(data) == before.st_size, 'Artifact extent changed')
    need((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
         (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'Artifact mutated during read')
    return data


def descriptor(value):
    keys(value, {'schemaVersion', 'guiPid', 'optIn', 'descriptor'})
    need(type(value['schemaVersion']) is int and value['schemaVersion'] == 1, 'Descriptor version')
    need(integer(value['guiPid']) > 0, 'Invalid GUI PID')
    keys(value['optIn'], {'nativeCaptureDev', 'debugCaptureAudio', 'debugNativeCapture'})
    need(all(v is True for v in value['optIn'].values()), 'Disabled audit provenance')
    d = value['descriptor']
    keys(d, IDENTITY | {'source', 'format', 'sampleRate', 'channels', 'channelMap', 'frameBytes', 'maxFrames'})
    need(isinstance(d['captureId'], str) and 0 < len(d['captureId']) <= 4096, 'Capture identity')
    need(integer(d['sessionId']) > 0, 'Session identity'); integer(d['generation'])
    need(d['format'] == 's16le' and type(d['sampleRate']) is int and d['sampleRate'] == 44100
         and type(d['channels']) is int and d['channels'] == 2 and d['channelMap'] == ['front-left', 'front-right']
         and type(d['frameBytes']) is int and d['frameBytes'] == 4
         and type(d['maxFrames']) is int and d['maxFrames'] == MAX_FRAMES, 'Capture format')
    s = d['source']; keys(s, {'selectionToken', 'name', 'label', 'index', 'objectSerial', 'isMonitor'})
    for k in ('selectionToken', 'name', 'label', 'objectSerial'):
        need(type(s[k]) is str and 0 < len(s[k]) <= 4096, 'Source identity text')
    integer(s['index'], 4294967294); need(type(s['isMonitor']) is bool, 'Monitor flag')
    return {k: d[k] for k in IDENTITY}


def receipt(r):
    keys(r, RECEIPT)
    need(r['state'] in ('stopping', 'stopped'), 'Receipt state')
    integer(r['producedFrames'], MAX_FRAMES); integer(r['lastSequence'], MAX_FRAMES)
    integer(r['acknowledgedSequence'], r['lastSequence'])
    for k in ('corkAcknowledged', 'barrierAcknowledged', 'limitReached'):
        need(type(r[k]) is bool, 'Receipt flag')
    keys(r['health'], {'healthy', 'reason'})
    need(r['health']['healthy'] is True and r['health']['reason'] is None, 'Unhealthy receipt')
    need(r['limitReached'] is False, 'Capture limit reached')
    need(not r['barrierAcknowledged'] or r['corkAcknowledged'], 'Barrier without cork')
    return r


def check_identity(value, identity):
    need(type(value['captureId']) is str and value['captureId'] == identity['captureId'], 'Stale capture identity')
    for key in ('sessionId', 'generation'):
        need(type(value[key]) is int and value[key] == identity[key], 'Stale numeric identity')


def packet(data, identity):
    need(len(data) >= 4, 'Truncated packet')
    size = struct.unpack_from('<I', data)[0]
    need(0 < size <= 65536 and 4 + size <= len(data), 'Packet header extent')
    h = decode_json(data[4:4 + size]); keys(h, IDENTITY | {'version', 'blocks', 'receipt'})
    need(type(h['version']) is int and h['version'] == 1, 'Packet version')
    check_identity(h, identity)
    receipt(h['receipt']); blocks = h['blocks']
    need(type(blocks) is list and len(blocks) <= 8, 'Batch bound')
    payload = data[4 + size:]; offset = 0
    for b in blocks:
        keys(b, {'sequence', 'frameStart', 'frames', 'byteOffset', 'byteLength'})
        need(integer(b['sequence'], MAX_FRAMES) > 0, 'Block sequence')
        integer(b['frameStart'], MAX_FRAMES)
        need(0 < integer(b['frames'], 8820), 'Empty block')
        need(type(b['byteOffset']) is int and b['byteOffset'] == offset, 'Block byte gap')
        need(type(b['byteLength']) is int and b['byteLength'] == b['frames'] * 4, 'Block byte count')
        offset += b['byteLength']
    need(offset == len(payload), 'Unaccounted packet bytes')
    return h, payload


def verify_bundle(directory, expected, renderer_bundle=None):
    directory = Path(directory)
    need({p.name for p in directory.iterdir()} == FILES | {'COMMIT.json'}, 'Unexpected or uncommitted native artifact')
    commit_bytes = read_bounded(directory / 'COMMIT.json', 65536)
    commit = decode_json(commit_bytes); keys(commit, {'schemaVersion', 'kind', 'complete', 'metadata', 'files'})
    need(type(commit['schemaVersion']) is int and commit['schemaVersion'] == 1 and commit['complete'] is True, 'Missing complete commit')
    keys(commit['files'], FILES)
    caps = {'descriptor.json':65536, 'journal.json':128 * 1024 * 1024,
            'packets.bin':MAX_PACKETS, 'raw.s16le':MAX_FRAMES * 4}
    data = {}
    for name in sorted(FILES):
        row = commit['files'][name]; keys(row, {'sha256', 'bytes'}); integer(row['bytes'], caps[name])
        data[name] = read_bounded(directory / name, caps[name])
        need(len(data[name]) == row['bytes'] and digest(data[name]) == row['sha256'], 'Commit binding mismatch: ' + name)
    d = decode_json(data['descriptor.json']); identity = descriptor(d)
    keys(commit['metadata'], {'guiPid'} | IDENTITY); check_identity(commit['metadata'], identity)
    need(type(commit['metadata']['guiPid']) is int and commit['metadata']['guiPid'] == d['guiPid']
         and commit['kind'] == 'native', 'Commit identity')
    need(d == expected, 'Independent expected descriptor mismatch')
    j = decode_json(data['journal.json']); keys(j, {'schemaVersion', 'events', 'termination', 'complete', 'incompleteReasons', 'uniqueIssuedFrames', 'uniqueIssuedSequences'})
    need(type(j['schemaVersion']) is int and j['schemaVersion'] == 1 and j['complete'] is True
         and j['incompleteReasons'] == [], 'Incomplete journal')
    events = j['events']; need(type(events) is list and 0 < len(events) <= MAX_EVENTS, 'Journal event bound')
    ack = frames = sequence = offset = 0
    pending = None; raw = data['raw.s16le']; packets = data['packets.bin']
    latest = None; final_empty = False; produced = last_produced_sequence = 0
    for ordinal, e in enumerate(events):
        need(type(e) is dict and type(e.get('ordinal')) is int and e['ordinal'] == ordinal, 'Event order')
        kind = e.get('kind')
        if kind == 'stop':
            keys(e, {'ordinal', 'kind', 'receipt'}); r = receipt(e['receipt']); final_empty = False
            need(r['acknowledgedSequence'] == ack, 'Stop ACK mismatch')
        else:
            need(kind == 'drain', 'Rejected or unknown drain cannot qualify')
            keys(e, {'ordinal', 'kind', 'request', 'ackAccepted', 'acknowledgedBefore', 'acknowledgedAfter', 'packetOffset', 'packetBytes', 'replay'})
            keys(e['request'], IDENTITY | {'ackThroughSequence'})
            check_identity(e['request'], identity)
            through = integer(e['request']['ackThroughSequence'])
            need(e['ackAccepted'] is True and type(e['acknowledgedBefore']) is int and e['acknowledgedBefore'] == ack, 'ACK not accepted from current state')
            if through != ack:
                need(pending is not None and through == pending[0], 'Partial/future/unissued ACK')
                ack = through; pending = None
            need(type(e['acknowledgedAfter']) is int and e['acknowledgedAfter'] == ack, 'ACK accounting')
            need(type(e['packetOffset']) is int and e['packetOffset'] == offset, 'Packet storage gap')
            size = integer(e['packetBytes'], 65540 + 8 * 35280)
            need(size > 0 and offset + size <= len(packets), 'Packet storage truncation')
            issued = packets[offset:offset + size]; offset += size
            need(type(e['replay']) is bool, 'Replay flag')
            if pending is not None:
                need(e['replay'] is True and issued == pending[1], 'Mutated or misidentified replay')
                continue
            need(e['replay'] is False, 'Spurious replay')
            header, payload = packet(issued, identity); r = header['receipt']; final_empty = not header['blocks']
            need(r['acknowledgedSequence'] == ack, 'Issued receipt ACK mismatch')
            for block in header['blocks']:
                need(block['sequence'] == sequence + 1 and block['frameStart'] == frames, 'Source sequence/frame gap')
                sequence += 1; frames += block['frames']; need(frames <= MAX_FRAMES, 'Source extent limit')
            start = frames * 4 - len(payload)
            need(raw[start:frames * 4] == payload, 'Raw bytes differ from unique issued blocks')
            if header['blocks']: pending = (sequence, issued)
        need(r['producedFrames'] >= produced and r['lastSequence'] >= last_produced_sequence, 'Receipt production regressed')
        need(r['producedFrames'] >= frames and r['lastSequence'] >= sequence, 'Receipt omits issued frames')
        produced = r['producedFrames']; last_produced_sequence = r['lastSequence']; latest = r
    need(type(j['uniqueIssuedFrames']) is int and j['uniqueIssuedFrames'] == frames
         and type(j['uniqueIssuedSequences']) is int and j['uniqueIssuedSequences'] == sequence, 'Journal unique coverage totals')
    need(offset == len(packets) and len(raw) == frames * 4, 'Extra or missing raw/packet bytes')
    keys(j['termination'], {'reason', 'receipt'})
    terminal = receipt(j['termination']['receipt'])
    need(j['termination']['reason'] == 'complete' and terminal == latest, 'Missing current terminal witness')
    need(terminal['state'] == 'stopped' and terminal['corkAcknowledged'] is True
         and terminal['barrierAcknowledged'] is True, 'Unconfirmed stopped tail')
    need(final_empty and pending is None and terminal['producedFrames'] == frames
         and terminal['lastSequence'] == sequence == ack == terminal['acknowledgedSequence'], 'Unacknowledged or missing terminal PCM')
    result = {'passed':True, 'frames':frames, 'blocks':sequence, 'events':len(events),
              'commitSha256':digest(commit_bytes), 'rawSha256':digest(raw), 'rendererMonoCompared':False}
    if renderer_bundle is not None:
        renderer_root = Path(renderer_bundle)
        need({p.name for p in renderer_root.iterdir()} == {'COMMIT.json','renderer.json','source.f32le'}, 'Unexpected or uncommitted renderer artifact')
        renderer_commit_bytes = read_bounded(renderer_root / 'COMMIT.json', 65536)
        rc = decode_json(renderer_commit_bytes)
        keys(rc, {'schemaVersion', 'kind', 'complete', 'metadata', 'files'})
        need(type(rc['schemaVersion']) is int and rc['schemaVersion'] == 1
             and rc['kind'] == 'renderer' and rc['complete'] is True, 'Incomplete renderer commit')
        keys(rc['files'], {'renderer.json', 'source.f32le'})
        renderer_files = {}
        for name, cap in [('renderer.json',65536), ('source.f32le',MAX_FRAMES * 4)]:
            binding = rc['files'][name]; keys(binding, {'sha256', 'bytes'}); integer(binding['bytes'], cap)
            content = read_bounded(renderer_root / name, cap)
            need(len(content) == binding['bytes'] and digest(content) == binding['sha256'], 'Renderer commit binding mismatch')
            renderer_files[name] = content
        meta = decode_json(renderer_files['renderer.json'])
        keys(meta, {'schemaVersion','nativeCaptureIdentity','captureDescriptor','stage','sampleFormat',
                    'sampleCount','byteLength','terminalOutcome','optIn','guiPid'})
        need(type(meta['schemaVersion']) is int and meta['schemaVersion'] == 1, 'Renderer schema version')
        need(type(meta['guiPid']) is int and meta['guiPid'] == d['guiPid'], 'Renderer GUI identity')
        keys(meta['nativeCaptureIdentity'], IDENTITY); check_identity(meta['nativeCaptureIdentity'], identity)
        need(meta['optIn'] == d['optIn'] and all(x is True for x in meta['optIn'].values()), 'Renderer opt-in provenance')
        need(meta['stage'] == 'renderer-retained-source-before-dc-resample' and meta['sampleFormat'] == 'f32le'
             and meta['terminalOutcome'] == 'healthy-stop', 'Renderer stage/outcome')
        need(type(meta['sampleCount']) is int and meta['sampleCount'] == frames
             and type(meta['byteLength']) is int and meta['byteLength'] == frames * 4, 'Renderer declared extent')
        capture = meta['captureDescriptor']
        keys(capture, {'backend','sessionId','generation','sourceSampleRate','sourceChannels','deliveredChannels','sourceIdentity','conversion'})
        expected_capture = {'backend':'native','sessionId':identity['sessionId'],'generation':identity['generation'],
                            'sourceSampleRate':44100,'sourceChannels':2,'deliveredChannels':1,
                            'sourceIdentity':capture['sourceIdentity'],'conversion':'s16le-stereo-average'}
        for key in ('sessionId','generation','sourceSampleRate','sourceChannels','deliveredChannels'):
            need(type(capture[key]) is int, 'Renderer capture numeric field')
        need(capture == expected_capture and type(capture['sourceIdentity']) is str, 'Renderer source descriptor')
        renderer_source = decode_json(capture['sourceIdentity'])
        keys(renderer_source, d['descriptor']['source'].keys())
        need(type(renderer_source['index']) is int and type(renderer_source['isMonitor']) is bool
             and renderer_source == d['descriptor']['source'], 'Renderer concrete source identity')
        keys(rc['metadata'], {'guiPid','identity','terminalOutcome'}); keys(rc['metadata']['identity'], IDENTITY)
        check_identity(rc['metadata']['identity'], identity)
        need(type(rc['metadata']['guiPid']) is int and rc['metadata']['guiPid'] == d['guiPid']
             and rc['metadata']['terminalOutcome'] == 'healthy-stop', 'Renderer commit identity')
        mono = renderer_files['source.f32le']
        need(len(mono) == frames * 4, 'Renderer mono extent')
        for n, (left, right) in enumerate(struct.iter_unpack('<hh', raw)):
            need(mono[n * 4:n * 4 + 4] == struct.pack('<f', (left + right) / 65536), 'Renderer mono bit mismatch at frame ' + str(n))
        result.update(rendererMonoCompared=True, rendererMonoSha256=digest(mono),
                      rendererCommitSha256=digest(renderer_commit_bytes))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--expected', type=Path, required=True)
    parser.add_argument('--renderer-bundle', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    with args.output.open('x') as output:
        try:
            expected_bytes = read_bounded(args.expected, 65536)
            result = verify_bundle(args.bundle, decode_json(expected_bytes), args.renderer_bundle)
            result['expectedSha256'] = digest(expected_bytes)
        except Exception as error:
            result = {'passed':False, 'error':str(error)}
        output.write(json.dumps(result, indent=2) + '\n')
    raise SystemExit(0 if result['passed'] else 1)


if __name__ == '__main__':
    main()
