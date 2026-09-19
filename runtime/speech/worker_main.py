"""Bounded local speech protocol; diagnostics contain identities and counters only."""
import hashlib
import json
import math
import os
import sys
import time


def configure_cpu_threads():
    if 'NEMO_SPEECH_CPU_THREADS' in os.environ:
        return
    try:
        available = len(os.sched_getaffinity(0))
    except (AttributeError, OSError):
        available = os.cpu_count() or 1
    # The native pool spins between tasks. Oversubscribing a two-core desktop
    # with four workers can exceed the startup deadline instead of running faster.
    os.environ['NEMO_SPEECH_CPU_THREADS'] = str(max(1, min(4, available)))


def error_code(error):
    known = {
        'identity': 'invalid_identity', 'object': 'invalid_object', 'operation': 'invalid_operation',
        'sequence': 'stale_session_or_sequence', 'sample rate': 'invalid_sample_rate',
        'audio shape': 'invalid_audio', 'inactive session': 'inactive_session',
        'Model integrity mismatch': 'model_integrity', 'unsupported context': 'invalid_context',
        'unsupported backend': 'invalid_backend', 'Model path must be absolute': 'invalid_model_path',
    }
    if str(error) in known:
        return known[str(error)]
    if isinstance(error, FileNotFoundError):
        return 'runtime_file_missing'
    if isinstance(error, ImportError):
        return 'runtime_dependency_missing'
    if isinstance(error, json.JSONDecodeError):
        return 'invalid_json'
    if isinstance(error, OSError):
        return 'runtime_io_failed'
    return 'runtime_failed'


def identity(request):
    session = request.get('session')
    seq = request.get('seq')
    if not isinstance(session, str) or not 1 <= len(session) <= 80 or type(seq) is not int or seq < 0:
        raise ValueError('identity')
    return session, seq


def metadata(request):
    session = request.get('session')
    queue_age = request.get('queue_age_ms')
    recording = request.get('dictation_session_id')
    return {
        'stream_session_hash': hashlib.sha256(session.encode()).hexdigest() if isinstance(session, str) and len(session) <= 80 else None,
        'dictation_session_id': recording if type(recording) is int and recording >= 0 else None,
        'seq': request.get('seq') if type(request.get('seq')) is int else None,
        'queue_age_ms': queue_age if type(queue_age) in (int, float) and math.isfinite(queue_age) and queue_age >= 0 else None,
    }


def serve(protocol, source, model, metrics):
    active = None
    last_request = -1
    emitted_text = None
    first_text = False
    session_started = None
    print(json.dumps({'ready': True, 'worker_run_id': metrics.run_id}), file=protocol, flush=True)
    while True:
        line = source.readline(4 * 1024 * 1024 + 1)
        if not line:
            return 0
        if len(line) > 4 * 1024 * 1024 or not line.endswith(b'\n'):
            metrics.emit('protocol_rejected', reason='oversized_or_truncated')
            return 1
        request = {}
        op = 'invalid'
        try:
            started = time.monotonic()
            decoded = json.loads(line)
            if not isinstance(decoded, dict):
                raise ValueError('object')
            request = decoded
            session, seq = identity(request)
            op = request.get('op')
            if op not in ('start', 'push', 'finish', 'cancel'):
                op = 'invalid'
                raise ValueError('operation')
            if op == 'cancel' and session != active:
                print(json.dumps({'session': session, 'seq': seq, 'text': None, 'mode': 'append-only'}), file=protocol, flush=True)
                metrics.emit('stale_cancel_ignored', **metadata(request))
                continue
            if op == 'start':
                model.start()
                active, last_request, emitted_text = session, seq, None
                text = None
                first_text = False
                session_started = started
                model.metrics = {}
            else:
                if session != active or seq <= last_request:
                    raise ValueError('sequence')
                last_request = seq
                if op == 'push':
                    text = model.push(request['audio'], request['rate'])
                elif op == 'finish':
                    text = model.finish()
                    active = None
                else:
                    model.cancel()
                    active = None
                    text = None
                    model.metrics = {}
            fresh = text is not None and text != emitted_text
            if text is not None and (fresh or op == 'finish'):
                emitted_text = text
            elif op == 'push':
                text = None
            timing = (time.monotonic() - started) * 1000
            fields = metadata(request)
            if text and not first_text:
                first_text = True
                metrics.emit('first_hypothesis', elapsed_ms=(time.monotonic() - session_started) * 1000, audio_s=model.audio_s, **fields)
            metrics.emit('request_completed', op=op, total_ms=timing, audio_s=model.audio_s,
                         processed_audio_s=model.gate.processed_s, skipped_audio_s=model.gate.skipped_s,
                         buffered_audio_s=model.gate.pending_n / (model.rate or 16000),
                         has_text=bool(text), fresh_hypothesis=fresh, **fields, **model.metrics)
            print(json.dumps({'session': session, 'seq': seq, 'text': text, 'mode': 'append-only'}), file=protocol, flush=True)
        except Exception as error:
            # No arbitrary exception message, request data or transcript in diagnostics.
            metrics.emit('request_failed', op=op, error_type=type(error).__name__, error_code=error_code(error), **metadata(request))
            print(json.dumps({'session': request.get('session'), 'seq': request.get('seq'),
                              'error': 'stream request rejected: ' + type(error).__name__}), file=protocol, flush=True)


def main(protocol):
    configure_cpu_threads()
    try:
        from streaming import StreamingSession, Metrics
    except Exception as error:
        # Dependencies may fail before the rotating diagnostics are available.
        print(json.dumps({'event': 'worker_startup_failed', 'stage': 'runtime_import',
                          'error_type': type(error).__name__, 'error_code': error_code(error)}),
              file=sys.stderr, flush=True)
        print(json.dumps({'ready': False, 'error': 'local speech runtime could not initialize'}),
              file=protocol, flush=True)
        return 1
    metrics = Metrics()
    model = None
    try:
        started = time.monotonic()
        try:
            model = StreamingSession(os.environ.get('VOCO_SILENCE_GATE', 'zero'))
        except Exception as error:
            metrics.emit('worker_startup_failed', stage='model_initialize', error_type=type(error).__name__, error_code=error_code(error), elapsed_ms=(time.monotonic()-started)*1000)
            print(json.dumps({'ready': False, 'error': 'local speech runtime could not initialize'}), file=protocol, flush=True)
            return 1
        metrics.emit('worker_ready', model=f'nemotron-0.6b-q8-context{model.context}',
                     cpu_threads=int(os.environ.get('NEMO_SPEECH_CPU_THREADS', '4')),
                     backend=os.environ.get('VOCO_NEMO_BACKEND', 'pool'), runtime_revision='a5b6953+voco-installed-v1',
                     model_sha256='d9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d',
                     parent_pid=os.getppid(), load_ms=model.load_ms, warmup_ms=model.warmup_ms, gate=model.mode)
        return serve(protocol, sys.stdin.buffer, model, metrics)
    finally:
        if model is not None:
            model.close()
        metrics.emit('worker_closed')
        metrics.close()
