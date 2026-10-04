"""Pinned local RNNT session, conservative silence gate and content-free timing."""
import collections
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import stat
import sys
from pathlib import Path
import time
import uuid
import queue
import resource
import threading
import numpy as np
from adapters import Nemotron

GATE_MODES = ('off', 'zero')

def coalesce_frames(frames, rate):
    """Batch released preroll without changing samples or exceeding one second."""
    if len(frames) < 2:
        return frames
    joined = np.concatenate(frames)
    return [joined[start:start + rate] for start in range(0, len(joined), rate)]


class SilenceGate:
    """Skip only long quiet interiors; preserve 640ms onset and 1.5s tail.

    Digital-zero mode is the default, and 'off' passes every sample through.
    Original audio is retained by the desktop.
    """
    def __init__(self, mode='zero'):
        if mode not in GATE_MODES: raise ValueError('gate mode')
        self.mode = mode
        self.pending = collections.deque()
        self.pending_n = 0
        self.quiet_s = 0.
        self.active = False
        self.skipped_s = 0.
        self.processed_s = 0.

    def push(self, data, rate):
        quiet = self.mode == 'zero' and not np.any(data)
        self.quiet_s = self.quiet_s + len(data)/rate if quiet else 0.
        if not quiet or (self.active and self.quiet_s < 1.5):
            frames = list(self.pending) + [data]
            self.pending.clear(); self.pending_n = 0
            self.active = True
            self.processed_s += sum(len(x) for x in frames)/rate
            return frames
        self.pending.append(data.copy()); self.pending_n += len(data)
        limit = round(rate*.64)
        while self.pending_n > limit:
            count = min(len(self.pending[0]), self.pending_n-limit)
            self.pending[0] = self.pending[0][count:]
            if not len(self.pending[0]): self.pending.popleft()
            self.pending_n -= count
            self.skipped_s += count/rate
        return []

    def finish(self, rate):
        frames = list(self.pending) if self.active else []
        if self.active: self.processed_s += self.pending_n/rate
        else: self.skipped_s += self.pending_n/rate
        self.pending.clear(); self.pending_n = 0
        return frames

class StreamingSession:
    def __init__(self, gate='zero', warmup=True):
        # Reject the mode before loading the model, so a bad value never reports ready.
        if gate not in GATE_MODES: raise ValueError('gate mode')
        self.mode = gate
        started = time.monotonic()
        self.context = int(os.environ.get('VOCO_NEMOTRON_CONTEXT', '1'))
        if self.context not in (0,1): raise ValueError('unsupported context')
        self.model = Nemotron(self.context)
        self.load_ms = (time.monotonic()-started)*1000
        self.warmup_ms = 0.
        self.active = False
        if warmup:
            started = time.monotonic(); self.model.start()
            self.model.push(np.zeros(16000, np.float32), 16000)
            self.model.finish()
            self.warmup_ms = (time.monotonic()-started)*1000
    def start(self):
        self.model.start(); self.gate = SilenceGate(self.mode)
        self.rate = None; self.audio_s = 0.; self.active = True
        self.metrics = {}; self.first_nonzero_audio_s = None
    def push(self, data, rate):
        if not self.active: raise ValueError('inactive session')
        if type(rate) is not int or rate < 8000 or rate > 96000 or (self.rate and self.rate != rate): raise ValueError('sample rate')
        data = np.asarray(data, np.float32)
        if data.ndim != 1 or not len(data) or len(data) > rate or not np.isfinite(data).all(): raise ValueError('audio shape')
        if self.first_nonzero_audio_s is None:
            nonzero = np.flatnonzero(data)
            if len(nonzero): self.first_nonzero_audio_s = self.audio_s + int(nonzero[0])/rate
        self.rate = rate; self.audio_s += len(data)/rate
        started = time.monotonic(); frames = self.gate.push(data, rate)
        gate_ms = (time.monotonic()-started)*1000
        started = time.monotonic(); text = None
        push_ms = drain_ms = 0.
        source_frame_count = len(frames)
        frames = coalesce_frames(frames, rate)
        for frame in frames:
            value = self.model.push(frame, rate)
            push_ms += self.model.metrics['recognizer_push_ms']
            drain_ms += self.model.metrics['result_drain_ms']
            if value is not None: text = value
        self.metrics = {'asr_ms': (time.monotonic()-started)*1000, 'gate_ms': gate_ms,
                        'recognizer_push_ms': push_ms, 'result_drain_ms': drain_ms,
                        'recognizer_push_calls': len(frames),
                        'gate_released_frames': source_frame_count,
                        'first_nonzero_audio_s': self.first_nonzero_audio_s}
        return text
    def finish(self):
        if not self.active: raise ValueError('inactive session')
        started = time.monotonic()
        for frame in coalesce_frames(self.gate.finish(self.rate or 16000), self.rate or 16000): self.model.push(frame, self.rate)
        text = self.model.finish(); self.active = False
        self.metrics = {'asr_ms': (time.monotonic()-started)*1000, 'gate_ms': 0.}
        return text
    def cancel(self):
        self.model.release_stream(); self.active = False; self.metrics = {}

    def close(self):
        self.cancel()
        self.model.close()

def state_home():
    """XDG_STATE_HOME if it is absolute; the spec says to ignore empty or relative values."""
    value = os.environ.get('XDG_STATE_HOME', '')
    return Path(value) if os.path.isabs(value) else Path.home()/'.local/state'


class PrivateRotatingHandler(RotatingFileHandler):
    def handleError(self, record):
        raise OSError("metrics write failed")

    def _open(self):
        # Opening a FIFO must not stall model startup. Inspect the opened inode,
        # not a prior path check; never follow links or chmod an unrelated target.
        descriptor = os.open(self.baseFilename, os.O_WRONLY | os.O_CREAT | os.O_APPEND
                             | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, 0o600)
        try:
            metadata = os.fstat(descriptor)
            if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid()
                    or metadata.st_mode & 0o077 or metadata.st_nlink != 1):
                raise OSError("metrics file must be private, owned and regular")
            return os.fdopen(descriptor, 'a', encoding='utf-8')
        except BaseException:
            os.close(descriptor)
            raise

def process_usage():
    """This worker's CPU seconds and resident bytes; OSError or ValueError when unreadable."""
    usage = resource.getrusage(resource.RUSAGE_SELF)
    with open('/proc/self/statm', 'rb') as statm:
        _size, resident, *_ = statm.read().split()
    return usage.ru_utime, usage.ru_stime, int(resident) * resource.getpagesize()

class Metrics:
    """Bounded asynchronous local logging. Disk failures never reject speech."""
    def __init__(self):
        self.run_id = uuid.uuid4().hex
        self.enabled = os.environ.get('VOCO_PERFORMANCE_LOG') == '1'
        self.dropped = 0
        self.sequence = 0
        self.writer = None
        self.closed = False
        if not self.enabled:
            return
        try:
            self._initialize()
        except (OSError, ValueError):
            self._unavailable()

    def _unavailable(self):
        self.enabled = False
        print('{"event":"worker_metrics_unavailable"}', file=sys.stderr, flush=True)

    def _initialize(self):
        root = state_home()/'voco/stream-performance'
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        metadata = root.lstat()
        if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.geteuid()
                or metadata.st_mode & 0o077):
            raise OSError("metrics directory must be private, owned and real")
        self.logger = logging.getLogger('voco-stream-'+self.run_id)
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False
        self.handler = PrivateRotatingHandler(root/'worker.jsonl', maxBytes=8*1024*1024, backupCount=3)
        self.logger.addHandler(self.handler)
        process_usage()  # Unreadable usage disables metrics before the writer starts.
        self.queue = queue.Queue(maxsize=256)
        self.writer = threading.Thread(target=self._write, name='voco-speech-metrics', daemon=True)
        self.writer.start()

    def _write(self):
        try:
            while True:
                record = self.queue.get()
                if record is None:
                    self.logger.info(json.dumps(self._record('metrics_closed', {}), separators=(',', ':')))
                    return
                self.logger.info(json.dumps(record, separators=(',', ':')))
                if self.closed and self.queue.empty():
                    self.logger.info(json.dumps(self._record('metrics_closed', {}), separators=(',', ':')))
                    return
        except (OSError, ValueError):
            self._unavailable()
        finally:
            self.handler.close()

    def _record(self, event, fields):
        cpu_user_s, cpu_system_s, rss_bytes = process_usage()
        self.sequence += 1
        return {'event': event, 'run_id': self.run_id, 'event_seq': self.sequence,
            'dropped_events': self.dropped, 'monotonic_s': time.monotonic(), 'unix_s': time.time(),
            'pid': os.getpid(), 'cpu_user_s': cpu_user_s, 'cpu_system_s': cpu_system_s,
            'rss_bytes': rss_bytes, **fields}

    def emit(self, event, **fields):
        if not self.enabled or self.closed:
            return
        try:
            self.queue.put_nowait(self._record(event, fields))
        except queue.Full:
            self.dropped += 1
        except (OSError, ValueError):
            self._unavailable()

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.writer is not None and self.writer.is_alive():
            # Wake an idle writer without polling. If a slow disk has filled
            # the queue, the closed flag stops it once pending records drain.
            try:
                self.queue.put_nowait(None)
            except queue.Full:
                pass
            self.writer.join(timeout=1)
