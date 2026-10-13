"""Lab-only ctypes access to VOCO's pinned recognizer, exactly as the worker opens it."""
import ctypes as c, os, sys, subprocess
from pathlib import Path
import numpy as np
# A copy of VOCO's installed speech payload, such as /usr/lib/voco/speech.
R = Path(os.environ['VOCO_LAB_RUNTIME'])
sys.path.insert(0, str(R))
from adapters import RecognitionOptions  # same layout check as production
lib = c.CDLL(str(R/'libbench_nemo_pool.so'))
def fn(name, args, res):
    f = getattr(lib, name); f.argtypes = args; f.restype = res; return f
bench_create = fn('bench_create', [c.c_char_p, c.c_int], c.c_void_p)
defaults = fn('nemo_speech_asr_recognition_options_default', [], RecognitionOptions)
recognize = fn('nemo_speech_asr_streaming_recognize', [c.c_void_p, c.POINTER(RecognitionOptions), c.POINTER(c.c_void_p)], c.c_int)
push_f = fn('nemo_speech_asr_stream_push_f32', [c.c_void_p, c.POINTER(c.c_float), c.c_size_t, c.c_int32], c.c_int)
next_f = fn('nemo_speech_asr_stream_next', [c.c_void_p, c.POINTER(c.c_void_p)], c.c_int)
finish_f = fn('nemo_speech_asr_stream_finish', [c.c_void_p], c.c_int)
force_f = fn('nemo_speech_asr_stream_force_endpoint', [c.c_void_p], c.c_int)
text_f = fn('nemo_speech_asr_result_transcript', [c.c_void_p, c.c_size_t], c.c_char_p)
final_f = fn('nemo_speech_asr_result_is_final', [c.c_void_p], c.c_bool)
wcount = fn('nemo_speech_asr_result_word_count', [c.c_void_p, c.c_size_t], c.c_size_t)
wtext = fn('nemo_speech_asr_result_word_text', [c.c_void_p, c.c_size_t, c.c_size_t], c.c_char_p)
wstart = fn('nemo_speech_asr_result_word_start_time', [c.c_void_p, c.c_size_t, c.c_size_t], c.c_int32)
wend = fn('nemo_speech_asr_result_word_end_time', [c.c_void_p, c.c_size_t, c.c_size_t], c.c_int32)
destroy = fn('nemo_speech_asr_result_destroy', [c.c_void_p], None)
close_f = fn('nemo_speech_asr_stream_close', [c.c_void_p], None)
error = fn('nemo_speech_asr_last_error', [], c.c_char_p)
MODEL = str(R/'models/nemotron-speech-streaming-en-0.6b.q8_0.gguf')
_rec = None
def recognizer():
    global _rec
    if _rec is None:
        _rec = bench_create(MODEL.encode(), int(os.environ.get('VOCO_LAB_CONTEXT', '1')))
        if not _rec: raise RuntimeError(error())
    return _rec
class Stream:
    """bench_start's options (interim, punctuation, verbatim), optionally with word times."""
    def __init__(self, word_times=False):
        o = defaults(); o.interim_results = o.enable_automatic_punctuation = o.verbatim_transcripts = True
        o.enable_word_time_offsets = word_times
        s = c.c_void_p()
        if recognize(recognizer(), c.byref(o), c.byref(s)): raise RuntimeError(error())
        self.s = s; self.done = ''; self.last = ''; self.words = []; self.word_times = word_times
    def drain(self):
        while True:
            p = c.c_void_p()
            if next_f(self.s, c.byref(p)): raise RuntimeError(error())
            if not p: break
            try:
                t = text_f(p, 0).decode(); r = (self.done + ' ' + t).strip(); self.last = r
                if final_f(p):
                    self.done = r
                    if self.word_times:
                        self.words += [(wtext(p, 0, i).decode(), wstart(p, 0, i), wend(p, 0, i)) for i in range(wcount(p, 0))]
            finally: destroy(p)
        return self.last
    def push(self, audio, rate=16000):
        d = np.ascontiguousarray(audio, dtype=np.float32)
        if push_f(self.s, d.ctypes.data_as(c.POINTER(c.c_float)), len(d), rate): raise RuntimeError(error())
    def force(self):
        if force_f(self.s): raise RuntimeError(error())
    def finish(self):
        if finish_f(self.s): raise RuntimeError(error())
        self.drain(); close_f(self.s); return self.last
def load_flac(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).copy()
