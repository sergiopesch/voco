#!/usr/bin/env bash
# TEST ONLY: provision an Ubuntu 24.04 benchmark box for VOCO's engine benchmark.
# Runs as root. Everything lands in /opt/bench; every download is pinned by SHA-256.
#
#   setup-box.sh tools     build NeMo-Speech.cpp at VOCO's pin with VOCO's recipe, the
#                          research bridge, whisper.cpp v1.9.5 and its shim; Python venv
#   setup-box.sh models    the four Q8 model files
#   setup-box.sh data      the public test sets, then corpus.py
set -euo pipefail
B=/opt/bench
VOCO_COMMIT=754b4c738844503543f7095de811c4207b35adec
NSC_COMMIT=a5b6953c4a579a2bbd1c0913ad8a85c2a4d99953
WHISPER_TAG=v1.9.5
WHISPER_COMMIT=d1be6fde11ac6e0407606b4e42fe72d34add8037
mkdir -p "$B"/{src,models,downloads,results}

fetch() {  # url file sha256
  local url=$1 out=$2 sum=$3
  if [[ ! -s $out ]] || ! echo "$sum  $out" | sha256sum --check --status; then
    curl --fail --location --retry 6 --retry-delay 5 --retry-all-errors --http1.1 --silent --show-error -o "$out.part" "$url"
    mv "$out.part" "$out"
  fi
  echo "$sum  $out" | sha256sum --check --strict
}

tools() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git cmake g++ make patch libsentencepiece-dev python3-venv python3-dev \
    curl binutils libsndfile1 >/dev/null
  [[ -d $B/src/voco ]] || git clone -q https://github.com/sergiopesch/voco.git "$B/src/voco"
  git -C "$B/src/voco" checkout -q "$VOCO_COMMIT"
  if [[ ! -d $B/src/nsc ]]; then
    git clone -q https://github.com/NVIDIA/NeMo-Speech.cpp.git "$B/src/nsc"
  fi
  git -C "$B/src/nsc" checkout -q "$NSC_COMMIT"
  git -C "$B/src/nsc" submodule update --init -q ggml
  rm -rf "$B/nsc-build"
  python3 "$B/src/voco/runtime/native/build.py" --source "$B/src/nsc" --output "$B/nsc-build" --jobs "$(nproc)"
  c++ -shared -fPIC -O2 -march=x86-64 -mtune=generic "$B/tools/bench_bridge.cpp" \
    -I"$B/nsc-build/source/include" -L"$B/nsc-build/payload/lib" -lnemo_speech_asr_c \
    -Wl,-rpath,"$B/nsc-build/payload/lib" -o "$B/libbench_research.so"
  if [[ ! -d $B/src/whisper ]]; then
    git clone -q --branch "$WHISPER_TAG" --depth 1 https://github.com/ggml-org/whisper.cpp.git "$B/src/whisper"
  fi
  [[ $(git -C "$B/src/whisper" rev-parse HEAD) == "$WHISPER_COMMIT" ]] || { echo "whisper.cpp commit mismatch"; exit 1; }
  cmake -S "$B/src/whisper" -B "$B/whisper-build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON \
    -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_AVX512=OFF \
    -DGGML_AVX512_VBMI=OFF -DGGML_AVX512_VNNI=OFF -DGGML_AVX512_BF16=OFF -DGGML_AVX_VNNI=OFF \
    -DGGML_BMI2=OFF -DGGML_OPENMP=OFF -DWHISPER_BUILD_EXAMPLES=OFF -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_BUILD_SERVER=OFF >/dev/null
  cmake --build "$B/whisper-build" --parallel "$(nproc)" >/dev/null
  local wlib; wlib=$(dirname "$(find "$B/whisper-build" -name 'libwhisper.so' | head -1)")
  local glib; glib=$(dirname "$(find "$B/whisper-build" -name 'libggml.so' | head -1)")
  cc -shared -fPIC -O2 "$B/tools/ws_shim.c" -I"$B/src/whisper/include" -I"$B/src/whisper/ggml/include" \
    -L"$wlib" -lwhisper -Wl,-rpath,"$wlib:$glib" -o "$B/libws_shim.so"
  python3 -m venv "$B/venv"
  "$B/venv/bin/pip" install -q numpy soundfile pyarrow "whisper-normalizer==0.1.12"
  "$B/venv/bin/pip" freeze > "$B/results/pip-freeze.txt"
  echo "tools ready"
}

models() {
  local hf=https://huggingface.co
  fetch "$hf/nvidia/nemotron-speech-streaming-en-0.6b/resolve/ebe59e5a817142986528bbbee5dba8db7b38ed50/nemotron-speech-streaming-en-0.6b.q8_0.gguf" \
    "$B/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf" d9a01898d2a611c8764e23a1c2f45e70bbd5a425dc4de93692ac951dd603812d
  fetch "$hf/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/1c8deaecc64b91f034d73e08dd8b64625eb3395d/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf" \
    "$B/models/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf" a5c435f294eea8f88ce68dd27b8c3bfea7f777cb2fbba04fcd30eaa555f429ae
  fetch "$hf/nvidia/parakeet-tdt-0.6b-v3/resolve/541d1f99c6b0c3cd0b11a95167540bb8edefd82b/parakeet-tdt-0.6b-v3.q8_0.gguf" \
    "$B/models/parakeet-tdt-0.6b-v3.q8_0.gguf" e3880d0aaaaf2c308ea2c35016b2b895c423eb3fda924c1b463d1c19b7f4d32e
  fetch "$hf/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q8_0.bin" \
    "$B/models/ggml-large-v3-turbo-q8_0.bin" 317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1
  echo "models ready"
}

data() {
  local d=$B/downloads hf=https://huggingface.co
  fetch https://www.openslr.org/resources/12/test-clean.tar.gz "$d/test-clean.tar.gz" \
    39fde525e59672dc6d1551919b1478f724438a95aa55f874b576be21967e6c23
  fetch https://www.openslr.org/resources/12/test-other.tar.gz "$d/test-other.tar.gz" \
    d09c181bba5cf717b3dee7d4d592af11a3ee3a09e08ae025c5506f6ebe961c29
  fetch https://www.openslr.org/resources/145/manifests.tar.gz "$d/librispeech-pc-manifests.tar.gz" \
    96d4eae2222b29b66437a21959252419bcd4762e5042e71e023790171054d1c0
  fetch "$hf/datasets/google/fleurs/resolve/70bb2e84b976b7e960aa89f1c648e09c59f894dd/data/en_us/audio/test.tar.gz" \
    "$d/fleurs-en_us-test.tar.gz" d9c2e37b41aacd41bc283554a0a82b5476b36887049774ecb2819dcaaa55a356
  fetch "$hf/datasets/google/fleurs/resolve/70bb2e84b976b7e960aa89f1c648e09c59f894dd/data/en_us/test.tsv" \
    "$d/fleurs-en_us-test.tsv" 74c046239374deeb60fa63f258f907388093a32bcaa3140965f70ef05c79f7ca
  fetch "$hf/datasets/facebook/voxpopuli/resolve/42f01879c780b4a2e90ec0b4f616c2ece526e4f1/en/test-00000-of-00001.parquet" \
    "$d/voxpopuli-en-test.parquet" 02cc7290425ddb95beeabda1d1e81e5e068cd7a25380bcf1fb69071b62610ffa
  rm -rf "$B/corpus"
  "$B/venv/bin/python" "$B/tools/corpus.py" --downloads "$d" --out "$B/corpus"
}

case ${1:-} in
  tools) tools ;;
  models) models ;;
  data) data ;;
  *) sed -n '2,9p' "$0"; exit 2 ;;
esac
