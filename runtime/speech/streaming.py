"""Pinned local RNNT session, conservative silence gate and content-free timing."""
import collections
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import sys
from pathlib import Path
import time
import uuid
import queue
import threading
import numpy as np
import psutil
from adapters import Nemotron, ROOT

def coalesce_frames(frames, rate):
    """Batch released preroll without changing samples or exceeding one second."""
    if len(frames) < 2:
        return frames
    joined = np.concatenate(frames)
    return [joined[start:start + rate] for start in range(0, len(joined), rate)]


class SilenceGate:
    """Skip only long quiet interiors; preserve 640ms onset and 1.5s tail.

    Digital-zero mode is the default. Acoustic VAD is opt-in pending broader
    microphone qualification. Original audio is retained by the desktop.
    """
    def __init__(self, mode='zero'):
        if mode not in ('off', 'zero', 'vad'): raise ValueError('gate mode')
        self.mode = mode
        self.pending = collections.deque()
        self.pending_n = 0
        self.quiet_s = 0.
        self.active = False
        self.skipped_s = 0.
        self.processed_s = 0.
        self.vad_ms = 0.
        self.vad_buffer = np.empty(0, np.float32)
        self.resample_count = 0
        self.resample_next = 0.
        self.resample_last = None
        self.state = np.zeros((2, 1, 128), np.float32)
        self.context = np.zeros((1, 64), np.float32)
        self.probability = 1.
        self.session = None
        if mode == 'vad':
            import onnxruntime as ort
            opts = ort.SessionOptions()
            opts.inter_op_num_threads = opts.intra_op_num_threads = 1
            self.session = ort.InferenceSession(str(ROOT/'vad/silero_vad.onnx'), opts, providers=['CPUExecutionProvider'])

    def quiet(self, data, rate):
        if self.mode == 'off': return False
        if self.mode == 'zero': return not np.any(data)
        started = time.monotonic()
        # Interpolate only the VAD sidechain, preserving fractional phase across
        # transport blocks. The recognizer always receives original samples.
        start = self.resample_count
        end = start + len(data) - 1
        if self.resample_last is None:
            values, positions = data, np.arange(start, end+1)
        else:
            values = np.concatenate(([self.resample_last], data))
            positions = np.arange(start-1, end+1)
        points = np.arange(self.resample_next, end + 1e-8, rate / 16000.)
        if len(points):
            self.resample_next = points[-1] + rate / 16000.
            self.vad_buffer = np.concatenate((self.vad_buffer, np.interp(points, positions, values).astype(np.float32)))
        self.resample_count += len(data)
        self.resample_last = data[-1]
        maximum = 0.
        evaluated = False
        while len(self.vad_buffer) >= 512:
            frame, self.vad_buffer = self.vad_buffer[:512], self.vad_buffer[512:]
            x = np.concatenate((self.context, frame[None, :]), axis=1)
            out, self.state = self.session.run(None, {'input': x, 'state': self.state, 'sr': np.array(16000, np.int64)})
            self.context = x[:, -64:]
            self.probability = float(out[0, 0])
            maximum = max(maximum, self.probability)
            evaluated = True
        self.vad_ms += (time.monotonic()-started)*1000
        # Avoid dismissing audible sounds or a frame that has not yet been scored.
        return evaluated and maximum < .05 and float(np.sqrt(np.mean(data.astype(np.float64)**2))) < .008

    def push(self, data, rate):
        quiet = self.quiet(data, rate)
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
        self.rate = None; self.audio_s = 0.; self.last = ''; self.active = True
        self.metrics = {}; self.chunks = 0; self.first_nonzero_audio_s = None
    def push(self, data, rate):
        if not self.active: raise ValueError('inactive session')
        if type(rate) is not int or rate < 8000 or rate > 96000 or (self.rate and self.rate != rate): raise ValueError('sample rate')
        data = np.asarray(data, np.float32)
        if data.ndim != 1 or not len(data) or len(data) > rate or not np.isfinite(data).all(): raise ValueError('audio shape')
        if self.first_nonzero_audio_s is None:
            nonzero = np.flatnonzero(data)
            if len(nonzero): self.first_nonzero_audio_s = self.audio_s + int(nonzero[0])/rate
        self.rate = rate; self.audio_s += len(data)/rate; self.chunks += 1
        before_vad = self.gate.vad_ms
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
        self.metrics = {'asr_ms': (time.monotonic()-started)*1000, 'gate_ms': gate_ms, 'vad_ms': self.gate.vad_ms-before_vad,
                        'recognizer_push_ms': push_ms, 'result_drain_ms': drain_ms,
                        'recognizer_push_calls': len(frames),
                        'gate_released_frames': source_frame_count,
                        'first_nonzero_audio_s': self.first_nonzero_audio_s}
        if text is not None: self.last = text
        return text
    def finish(self):
        if not self.active: raise ValueError('inactive session')
        started = time.monotonic()
        for frame in coalesce_frames(self.gate.finish(self.rate or 16000), self.rate or 16000): self.model.push(frame, self.rate)
        text = self.model.finish(); self.active = False; self.last = text
        self.metrics = {'asr_ms': (time.monotonic()-started)*1000, 'gate_ms': 0., 'vad_ms': 0.}
        return text
    def cancel(self):
        if getattr(self.model, 'stream', None):
            self.model.close_stream(self.model.stream); self.model.stream = None
        self.active = False

    def close(self):
        self.cancel()
        self.model.close()

class PrivateRotatingHandler(RotatingFileHandler):
    def handleError(self, record):
        raise OSError("metrics write failed")

    def _open(self):
        descriptor = os.open(self.baseFilename, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        return os.fdopen(descriptor, 'a', encoding='utf-8')

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
        except (OSError, psutil.Error):
            self._unavailable()

    def _unavailable(self):
        self.enabled = False
        print('{"event":"worker_metrics_unavailable"}', file=sys.stderr, flush=True)

    def _initialize(self):
        root = Path(os.environ.get('XDG_STATE_HOME', str(Path.home()/'.local/state')))/'voco/stream-performance'
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.logger = logging.getLogger('voco-stream-'+self.run_id)
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False
        self.handler = PrivateRotatingHandler(root/'worker.jsonl', maxBytes=8*1024*1024, backupCount=3)
        os.chmod(root/'worker.jsonl', 0o600)
        self.logger.addHandler(self.handler)
        self.process = psutil.Process()
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
        except (OSError, ValueError, psutil.Error):
            self._unavailable()
        finally:
            self.handler.close()

    def _record(self, event, fields):
        cpu = self.process.cpu_times()
        self.sequence += 1
        return {'event': event, 'run_id': self.run_id, 'event_seq': self.sequence,
            'dropped_events': self.dropped, 'monotonic_s': time.monotonic(), 'unix_s': time.time(),
            'pid': os.getpid(), 'cpu_user_s': cpu.user, 'cpu_system_s': cpu.system,
            'rss_bytes': self.process.memory_info().rss, **fields}

    def emit(self, event, **fields):
        if not self.enabled or self.closed:
            return
        try:
            self.queue.put_nowait(self._record(event, fields))
        except queue.Full:
            self.dropped += 1
        except (OSError, psutil.Error):
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
