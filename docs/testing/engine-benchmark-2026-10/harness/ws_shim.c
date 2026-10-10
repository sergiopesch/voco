// TEST ONLY whisper.cpp shim for VOCO's engine benchmark: whisper_full takes its
// large params struct by value, which is fragile to mirror with ctypes.
#include "whisper.h"

void* ws_init(const char* model) {
  struct whisper_context_params params = whisper_context_default_params();
  params.use_gpu = false;
  return whisper_init_from_file_with_params(model, params);
}

void ws_free(struct whisper_context* ctx) { whisper_free(ctx); }

// Greedy English transcription with word-level segments (times in 10 ms units).
int ws_run(struct whisper_context* ctx, const float* pcm, int count, const char* prompt,
           int threads, int audio_ctx) {
  struct whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
  p.n_threads = threads;
  p.language = "en";
  p.translate = false;
  p.no_context = true;
  p.single_segment = false;
  p.print_progress = false;
  p.print_realtime = false;
  p.print_timestamps = false;
  p.print_special = false;
  p.token_timestamps = true;
  p.max_len = 1;
  p.split_on_word = true;
  p.temperature_inc = 0.0f;
  p.suppress_nst = true;
  p.initial_prompt = (prompt && *prompt) ? prompt : NULL;
  p.audio_ctx = audio_ctx;
  return whisper_full(ctx, p, pcm, count);
}

int ws_segments(struct whisper_context* ctx) { return whisper_full_n_segments(ctx); }
const char* ws_text(struct whisper_context* ctx, int i) { return whisper_full_get_segment_text(ctx, i); }
long long ws_t0(struct whisper_context* ctx, int i) { return whisper_full_get_segment_t0(ctx, i); }
long long ws_t1(struct whisper_context* ctx, int i) { return whisper_full_get_segment_t1(ctx, i); }
