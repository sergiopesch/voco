"""Local, stateful streaming adapters. Package-owned NVIDIA runtime; no cloud service."""
from pathlib import Path
import ctypes as c
import os
import hashlib
import time
import numpy as np
ROOT=Path(__file__).resolve().parent
class Moonshine:
    def __init__(self,size,interval=.2,fast=False):
        from moonshine_voice import Transcriber, ModelArch
        self.transcriber=Transcriber(ROOT/f'models/moonshine/download.moonshine.ai/model/{size}-streaming-en/quantized_26_08_21', getattr(ModelArch,f'{size.upper()}_STREAMING'),update_interval=999999,options={"transcription_interval":.2,"vad_window_duration":.2} if fast else None)
        self.interval=interval
    def start(self):
        if getattr(self,"stream",None) is not None:self.stream.close()
        self.stream=self.transcriber.create_stream(update_interval=999999)
        self.stream.start(); self.lines={}; self.seconds=0.; self.updated=0.
    def transcript(self, result):
        for line in result.lines: self.lines[line.line_id]=line.text
        return ' '.join(self.lines.values()).strip()
    def push(self,audio,rate):
        self.stream.add_audio(audio.tolist(),rate); self.seconds+=len(audio)/rate
        if self.seconds-self.updated+1e-8<self.interval:return None
        self.updated=self.seconds
        result=self.stream.update_transcription()
        text=self.transcript(result)
        return text if any(line.is_updated for line in result.lines) else None
    def finish(self):
        result=self.stream.stop()
        if result is None: raise RuntimeError('Moonshine stop returned no transcript')
        text=self.transcript(result); self.stream.close(); self.stream=None; return text

class Nemotron:
    def __init__(self,context=1):
        backend=os.environ.get('VOCO_NEMO_BACKEND','pool')
        if backend not in ('openmp','pool'):raise ValueError('unsupported backend')
        self.lib=c.CDLL(str(ROOT/f'libbench_nemo_{backend}.so')); lib=self.lib
        def fn(name,args,result):
            f=getattr(lib,name); f.argtypes=args; f.restype=result; return f
        self.error=fn('nemo_speech_asr_last_error',[],c.c_char_p)
        create=fn('bench_create',[c.c_char_p,c.c_int],c.c_void_p)
        self.open=fn('bench_start',[c.c_void_p],c.c_void_p)
        self.push_f=fn('nemo_speech_asr_stream_push_f32',[c.c_void_p,c.POINTER(c.c_float),c.c_size_t,c.c_int32],c.c_int)
        self.next=fn('nemo_speech_asr_stream_next',[c.c_void_p,c.POINTER(c.c_void_p)],c.c_int)
        self.finish_f=fn('nemo_speech_asr_stream_finish',[c.c_void_p],c.c_int)
        self.text_f=fn('nemo_speech_asr_result_transcript',[c.c_void_p,c.c_size_t],c.c_char_p)
        self.final_f=fn('nemo_speech_asr_result_is_final',[c.c_void_p],c.c_bool)
        self.destroy_result=fn('nemo_speech_asr_result_destroy',[c.c_void_p],None)
        self.close_stream=fn('nemo_speech_asr_stream_close',[c.c_void_p],None)
        self.destroy_recognizer=fn('nemo_speech_asr_destroy',[c.c_void_p],None)
        model_path=Path(os.environ.get('VOCO_NEMOTRON_MODEL', str(ROOT/'models/nemotron-speech-streaming-en-0.6b.q8_0.gguf')))
        if not model_path.is_absolute(): raise ValueError('Model path must be absolute')
        with model_path.open('rb') as model_file:
            digest=hashlib.file_digest(model_file,'sha256').hexdigest()
        if digest != 'd9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d':
            raise ValueError('Model integrity mismatch')
        self.recognizer=create(str(model_path).encode(),context)
        if not self.recognizer: raise RuntimeError(self.error())
    def close(self):
        if getattr(self, 'stream', None):
            self.close_stream(self.stream); self.stream=None
        if self.recognizer:
            self.destroy_recognizer(self.recognizer); self.recognizer=None
    def check(self,code):
        if code: raise RuntimeError(self.error())
    def start(self):
        if getattr(self,"stream",None):self.close_stream(self.stream)
        self.stream=self.open(self.recognizer); self.done='';self.last=''
        if not self.stream:raise RuntimeError(self.error())
    def drain(self):
        result=None
        while True:
            ptr=c.c_void_p();self.check(self.next(self.stream,c.byref(ptr)))
            if not ptr: break
            try:
                text=self.text_f(ptr,0).decode();result=(self.done+' '+text).strip();self.last=result
                if self.final_f(ptr):self.done=result
            finally:self.destroy_result(ptr)
        return result
    def push(self,audio,rate):
        data=np.ascontiguousarray(audio,dtype=np.float32)
        started=time.monotonic()
        self.check(self.push_f(self.stream,data.ctypes.data_as(c.POINTER(c.c_float)),len(data),rate))
        pushed=time.monotonic()
        result=self.drain()
        self.metrics={'recognizer_push_ms':(pushed-started)*1000,'result_drain_ms':(time.monotonic()-pushed)*1000}
        return result
    def finish(self):
        self.check(self.finish_f(self.stream));self.drain();self.close_stream(self.stream);self.stream=None;return self.last

def create(name):
    if name.startswith('moonshine-'):return Moonshine(name.split('-')[1],fast=name.endswith('-fast'))
    if name.startswith('nemotron-'):return Nemotron(int(name.split('-')[1]))
    raise ValueError(name)
