# Loaded by whisper-rs-sys through CMAKE_PROJECT_INCLUDE. The pinned upstream
# WHISPER_NATIVE compatibility option only enables GGML_NATIVE; OFF is a no-op.
# Keep distributed CPU code independent of the builder's instruction set.
set(GGML_NATIVE OFF CACHE BOOL "Use a portable CPU baseline" FORCE)
set(GGML_AVX ON CACHE BOOL "Enable AVX baseline" FORCE)
set(GGML_AVX2 ON CACHE BOOL "Enable AVX2 baseline" FORCE)
set(GGML_FMA ON CACHE BOOL "Enable FMA baseline" FORCE)
set(GGML_F16C ON CACHE BOOL "Enable F16C baseline" FORCE)
set(GGML_AVX512 OFF CACHE BOOL "Do not require AVX-512" FORCE)
set(GGML_AVX512_VBMI OFF CACHE BOOL "Do not require AVX-512 VBMI" FORCE)
set(GGML_AVX512_VNNI OFF CACHE BOOL "Do not require AVX-512 VNNI" FORCE)
set(GGML_AVX512_BF16 OFF CACHE BOOL "Do not require AVX-512 BF16" FORCE)
