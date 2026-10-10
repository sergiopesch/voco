// TEST ONLY research bridge for VOCO's engine benchmark. Like VOCO's
// runtime/speech/nemo_bridge.cpp, but the right context is explicit, the
// language prompt can be chosen (Nemotron 3.5) and offline recognition with
// word times is exposed (Parakeet TDT, and reference alignments).
#include <nemo_speech/asr.h>

extern "C" {

void* rb_create(const char* path, int right_context) {
  nemo_speech_asr_backend_config backend{}; backend.size = sizeof(backend); backend.gpu = -1;
  nemo_speech_asr_model_config model{}; model.size = sizeof(model); model.path = path;
  nemo_speech_asr_streaming_config streaming{}; streaming.size = sizeof(streaming);
  streaming.rnnt_right_context = right_context; streaming.chunk_size = 1.6f;
  nemo_speech_asr_recognizer_config config{}; config.size = sizeof(config);
  config.backend = &backend; config.model = &model; config.streaming = &streaming;
  nemo_speech_asr_recognizer* out = nullptr;
  return nemo_speech_asr_create(&config, &out) == NEMO_SPEECH_ASR_OK ? out : nullptr;
}

static nemo_speech_asr_recognition_options options_for(const char* language, bool words) {
  auto opts = nemo_speech_asr_recognition_options_default();
  opts.interim_results = true;
  opts.enable_automatic_punctuation = true;
  opts.verbatim_transcripts = true;
  opts.enable_word_time_offsets = words;
  opts.language_code = (language && *language) ? language : nullptr;
  return opts;
}

void* rb_start(nemo_speech_asr_recognizer* recognizer, const char* language) {
  auto opts = options_for(language, false);
  nemo_speech_asr_stream* out = nullptr;
  return nemo_speech_asr_streaming_recognize(recognizer, &opts, &out) == NEMO_SPEECH_ASR_OK ? out : nullptr;
}

void* rb_recognize(nemo_speech_asr_recognizer* recognizer, const char* language,
                   const float* samples, size_t count, int words) {
  auto opts = options_for(language, words != 0);
  nemo_speech_asr_result* out = nullptr;
  return nemo_speech_asr_recognize_f32(recognizer, &opts, samples, count, 16000, &out) == NEMO_SPEECH_ASR_OK
      ? out : nullptr;
}

}
