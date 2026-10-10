"""TEST ONLY: speech engines behind one streaming interface for VOCO's benchmark.

Every engine takes 16 kHz mono float32 packets. After each `push` and at `end`
it returns the text VOCO could have pasted so far. VOCO pastes each new suffix
at once and stops dictation if earlier text changes, so for a usable engine
this text only ever grows.

  NscStream        a cache-aware streaming model (Nemotron); the text is its
                   running hypothesis, exactly what VOCO's worker forwards
  NscOffline       one offline decode at Stop (accuracy ceiling, no live text)
  WindowedOffline  an offline model re-decoded over [t-L, t+C+R) windows that
                   commits only the words starting inside [t, t+C)
  WhisperOffline   one whisper.cpp decode at Stop
  WhisperLA2       whisper.cpp with LocalAgreement-2: commit the longest common
                   word prefix of the last two decodes (ufal/whisper_streaming)
"""
import ctypes as c
import re

import numpy as np

RATE = 16000
SEAM_TOLERANCE_S = 0.08


def floats(audio):
    audio = np.ascontiguousarray(audio, dtype=np.float32)
    return audio, audio.ctypes.data_as(c.POINTER(c.c_float))


class Nsc:
    """VOCO's pinned NeMo-Speech.cpp, through bench_bridge.cpp."""

    def __init__(self, library):
        lib = c.CDLL(library)

        def fn(name, args, result):
            function = getattr(lib, name)
            function.argtypes, function.restype = args, result
            return function

        P, S, I = c.c_void_p, c.c_size_t, c.c_int
        self.error = fn("nemo_speech_asr_last_error", [], c.c_char_p)
        self.create = fn("rb_create", [c.c_char_p, I], P)
        self.start = fn("rb_start", [P, c.c_char_p], P)
        self.recognize = fn("rb_recognize", [P, c.c_char_p, c.POINTER(c.c_float), S, I], P)
        self.push = fn("nemo_speech_asr_stream_push_f32", [P, c.POINTER(c.c_float), S, c.c_int32], I)
        self.next = fn("nemo_speech_asr_stream_next", [P, c.POINTER(c.c_void_p)], I)
        self.finish = fn("nemo_speech_asr_stream_finish", [P], I)
        self.close = fn("nemo_speech_asr_stream_close", [P], None)
        self.text = fn("nemo_speech_asr_result_transcript", [P, S], c.c_char_p)
        self.final = fn("nemo_speech_asr_result_is_final", [P], c.c_bool)
        self.destroy = fn("nemo_speech_asr_result_destroy", [P], None)
        self.word_count = fn("nemo_speech_asr_result_word_count", [P, S], S)
        self.word_text = fn("nemo_speech_asr_result_word_text", [P, S, S], c.c_char_p)
        self.word_start = fn("nemo_speech_asr_result_word_start_time", [P, S, S], c.c_int32)
        self.word_end = fn("nemo_speech_asr_result_word_end_time", [P, S, S], c.c_int32)

    def check(self, code):
        if code:
            raise RuntimeError((self.error() or b"").decode() or f"NeMo-Speech.cpp status {code}")

    def recognizer(self, model, right_context):
        handle = self.create(model.encode(), right_context)
        if not handle:
            raise RuntimeError((self.error() or b"").decode())
        return handle

    def words(self, recognizer, audio, language=None):
        """One offline decode: (transcript, [(start_s, end_s, word)])."""
        audio, pointer = floats(audio)
        result = self.recognize(recognizer, language.encode() if language else None, pointer, len(audio), 1)
        if not result:
            raise RuntimeError((self.error() or b"").decode())
        try:
            text = (self.text(result, 0) or b"").decode()
            words = [(self.word_start(result, 0, i) / 1000, self.word_end(result, 0, i) / 1000,
                      (self.word_text(result, 0, i) or b"").decode())
                     for i in range(self.word_count(result, 0))]
        finally:
            self.destroy(result)
        return text, words


class NscStream:
    def __init__(self, nsc, model, right_context, language=None):
        self.nsc, self.language = nsc, language.encode() if language else None
        self.handle = nsc.recognizer(model, right_context)

    def begin(self):
        self.stream = self.nsc.start(self.handle, self.language)
        if not self.stream:
            raise RuntimeError((self.nsc.error() or b"").decode())
        self.done, self.last = "", ""

    def _drain(self):
        # Same accumulation as VOCO's runtime/speech/adapters.py Nemotron.drain.
        while True:
            pointer = c.c_void_p()
            self.nsc.check(self.nsc.next(self.stream, c.byref(pointer)))
            if not pointer:
                return self.last
            try:
                text = (self.nsc.text(pointer, 0) or b"").decode()
                self.last = (self.done + " " + text).strip()
                if self.nsc.final(pointer):
                    self.done = self.last
            finally:
                self.nsc.destroy(pointer)

    def push(self, audio):
        audio, pointer = floats(audio)
        self.nsc.check(self.nsc.push(self.stream, pointer, len(audio), RATE))
        return self._drain()

    def end(self):
        self.nsc.check(self.nsc.finish(self.stream))
        text = self._drain()
        self.nsc.close(self.stream)
        self.stream = None
        return text


class NscOffline:
    live = False

    def __init__(self, nsc, model, language=None):
        self.nsc, self.language = nsc, language
        self.handle = nsc.recognizer(model, -1)

    def begin(self):
        self.audio = []
        self.words = []

    def push(self, audio):
        self.audio.append(np.asarray(audio, dtype=np.float32))
        return ""

    def end(self):
        text, self.words = self.nsc.words(self.handle, np.concatenate(self.audio), self.language)
        return text.strip()


class WindowedOffline:
    """NVIDIA's buffered streaming for offline models, approximated without decoder state."""

    def __init__(self, nsc, model, left, chunk, right):
        self.nsc, self.left, self.chunk, self.right = nsc, left, chunk, right
        self.handle = nsc.recognizer(model, -1)

    def begin(self):
        self.audio = np.zeros(0, dtype=np.float32)
        self.t = 0.0
        self.committed = []

    def _decode(self, start, stop):
        lo, hi = max(0, int(start * RATE)), min(len(self.audio), int(stop * RATE))
        _, words = self.nsc.words(self.handle, self.audio[lo:hi])
        return [(lo / RATE + a, lo / RATE + b, w) for a, b, w in words]

    def _commit(self, words, until):
        # A word seen near a seam may shift by a frame between windows: never
        # commit one that starts before the previous committed word ended.
        floor = self.committed[-1][1] - SEAM_TOLERANCE_S if self.committed else -1.0
        self.committed += [w for w in words if floor <= w[0] < until and w[2].strip()]

    def text(self):
        return " ".join(w[2].strip() for w in self.committed)

    def push(self, audio):
        self.audio = np.concatenate([self.audio, np.asarray(audio, dtype=np.float32)])
        available = len(self.audio) / RATE
        while self.t + self.chunk + self.right <= available:
            self._commit(self._decode(self.t - self.left, self.t + self.chunk + self.right), self.t + self.chunk)
            self.t += self.chunk
        return self.text()

    def end(self):
        available = len(self.audio) / RATE
        if self.t < available:
            self._commit(self._decode(self.t - self.left, available), float("inf"))
        return self.text()


class Whisper:
    def __init__(self, library, model, threads):
        lib = c.CDLL(library)

        def fn(name, args, result):
            function = getattr(lib, name)
            function.argtypes, function.restype = args, result
            return function

        self.init = fn("ws_init", [c.c_char_p], c.c_void_p)
        self.run = fn("ws_run", [c.c_void_p, c.POINTER(c.c_float), c.c_int, c.c_char_p, c.c_int, c.c_int], c.c_int)
        self.segments = fn("ws_segments", [c.c_void_p], c.c_int)
        self.segment = fn("ws_text", [c.c_void_p, c.c_int], c.c_char_p)
        self.t0 = fn("ws_t0", [c.c_void_p, c.c_int], c.c_longlong)
        self.t1 = fn("ws_t1", [c.c_void_p, c.c_int], c.c_longlong)
        self.ctx = self.init(model.encode())
        if not self.ctx:
            raise RuntimeError("whisper.cpp could not load the model")
        self.threads = threads

    def words(self, audio, offset=0.0, prompt=""):
        audio, pointer = floats(audio)
        if self.run(self.ctx, pointer, len(audio), prompt.encode() if prompt else None, self.threads, 0):
            raise RuntimeError("whisper_full failed")
        out = []
        for i in range(self.segments(self.ctx)):
            text = (self.segment(self.ctx, i) or b"").decode(errors="replace").strip()
            if text:
                out.append((offset + self.t0(self.ctx, i) / 100, offset + self.t1(self.ctx, i) / 100, text))
        return out


class WhisperOffline:
    live = False

    def __init__(self, whisper):
        self.whisper = whisper

    def begin(self):
        self.audio = []

    def push(self, audio):
        self.audio.append(np.asarray(audio, dtype=np.float32))
        return ""

    def end(self):
        return " ".join(w[2] for w in self.whisper.words(np.concatenate(self.audio)))


def _key(word):
    return re.sub(r"[^\w']", "", word.lower())


class WhisperLA2:
    """ufal/whisper_streaming OnlineASRProcessor, simplified: word buffer trimming."""

    def __init__(self, whisper, min_chunk=1.0, trim=15.0):
        self.whisper, self.min_chunk, self.trim = whisper, min_chunk, trim

    def begin(self):
        self.audio = np.zeros(0, dtype=np.float32)
        self.offset = 0.0
        self.pending = 0.0
        self.committed = []
        self.previous = []

    def text(self):
        return " ".join(w[2] for w in self.committed)

    def _iterate(self):
        scrolled = " ".join(w[2] for w in self.committed if w[1] <= self.offset)[-200:]
        words = self.whisper.words(self.audio, self.offset, scrolled)
        last = self.committed[-1][1] if self.committed else 0.0
        new = [w for w in words if w[0] > last - 0.1]
        if new and self.committed and abs(new[0][0] - last) < 1:
            for n in range(min(5, len(self.committed), len(new)), 0, -1):
                if [_key(w[2]) for w in self.committed[-n:]] == [_key(w[2]) for w in new[:n]]:
                    new = new[n:]
                    break
        agreed = []
        while new and self.previous and _key(new[0][2]) == _key(self.previous[0][2]):
            agreed.append(new.pop(0))
            self.previous.pop(0)
        self.previous = new
        self.committed += agreed
        if len(self.audio) / RATE > self.trim and self.committed:
            cut = self.committed[-1][1] - self.offset
            if cut > 0:
                self.audio = self.audio[int(cut * RATE):]
                self.offset += cut

    def push(self, audio):
        self.audio = np.concatenate([self.audio, np.asarray(audio, dtype=np.float32)])
        self.pending += len(audio) / RATE
        if self.pending >= self.min_chunk:
            self.pending = 0.0
            self._iterate()
        return self.text()

    def end(self):
        self._iterate()
        self.committed += self.previous
        self.previous = []
        return self.text()
