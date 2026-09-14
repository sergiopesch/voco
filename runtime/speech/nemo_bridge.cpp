#include <nemo_speech/asr.h>
extern "C" {
void* bench_create(const char* path, int context) {
  nemo_speech_asr_backend_config backend{}; backend.size=sizeof(backend); backend.gpu=-1;
  nemo_speech_asr_model_config model{}; model.size=sizeof(model); model.path=path;
  nemo_speech_asr_streaming_config streaming{}; streaming.size=sizeof(streaming); streaming.rnnt_right_context=context; streaming.chunk_size=1.6f;
  nemo_speech_asr_recognizer_config config{}; config.size=sizeof(config); config.backend=&backend; config.model=&model; config.streaming=&streaming;
  nemo_speech_asr_recognizer* out=nullptr;
  return nemo_speech_asr_create(&config,&out)==NEMO_SPEECH_ASR_OK?out:nullptr;
}
void* bench_start(nemo_speech_asr_recognizer* r) {
  auto opts=nemo_speech_asr_recognition_options_default(); opts.interim_results=true; opts.enable_automatic_punctuation=true; opts.verbatim_transcripts=true;
  nemo_speech_asr_stream* out=nullptr;
  return nemo_speech_asr_streaming_recognize(r,&opts,&out)==NEMO_SPEECH_ASR_OK?out:nullptr;
}
}
