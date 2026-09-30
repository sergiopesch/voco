# Native speech runtime

VOCO recognizes speech with NVIDIA's NeMo-Speech.cpp and its ggml submodule,
built for x86-64 CPUs with AVX2, FMA and F16C. This folder holds the recipe:
`build.py` and the two patches it applies. Git holds neither the libraries nor
the model, so a checkout needs them provisioned before it can recognize speech,
as [runtime provisioning](../../docs/linux-packaging.md#runtime-provisioning)
describes.

## What ships

The package installs the runtime in `/usr/lib/voco/speech/`:

| Path | Contents |
| --- | --- |
| `lib/` | `libggml-base`, `libggml-cpu`, `libggml`, `libnemo_speech_asr` and `libnemo_speech_asr_c`, with their version links |
| `libbench_nemo_pool.so` | The bridge built from [`nemo_bridge.cpp`](../speech/nemo_bridge.cpp), which the worker loads with `ctypes` |
| `models/nemotron-speech-streaming-en-0.6b.q8_0.gguf` | Nemotron Speech Streaming 0.6B as 8-bit GGUF |
| `NATIVE-BUILD.json` | Commits, patch and bridge hashes, CMake options, compiler and CMake versions, the hash of every native file and the target of every link |
| `MODEL-IDENTITY.json` | The model's source, revision and SHA-256 |

The bridge creates a CPU-only recognizer and opens streams with interim results
and automatic punctuation. The worker refuses a model whose SHA-256 differs from
the pinned value. SentencePiece comes from the system, through the package's
dependency on `libsentencepiece0`. The licenses and notices for NeMo-Speech.cpp,
ggml and the model are in [runtime/notices](../notices/), which the package
installs in `/usr/share/doc/voco/nvidia/`.

## Patches

`build.py` checks each patch's SHA-256 before it applies it.

- `first-chunk.patch`: the first chunk fills its nine overlap frames with
  zeros, so it waits only for real audio frames, 90 ms sooner than upstream.
- `thread-pool.patch`: each recognizer keeps one CPU thread pool, which sleeps
  between graphs instead of polling, and takes its size from
  `NEMO_SPEECH_CPU_THREADS` (1 to 16, 4 when unset). `NEMO_SPEECH_DISABLE_POOL`
  turns the pool off. VOCO's worker sets the size to one less than the CPUs it
  may run on, between 1 and 4.

## Build

On x86-64 Linux, with Git, Python 3.11 or newer, CMake, Make, a C and C++
compiler with `c++` on the path, `patch`, `tar`, binutils and the SentencePiece
development files (`libsentencepiece-dev` on Ubuntu):

```bash
git clone https://github.com/NVIDIA/NeMo-Speech.cpp.git /tmp/nemo-source
git -C /tmp/nemo-source checkout a5b6953c4a579a2bbd1c0913ad8a85c2a4d99953
git -C /tmp/nemo-source submodule update --init ggml
python3 runtime/native/build.py --source /tmp/nemo-source --output /tmp/voco-native-build
```

`--output` must be a new directory. `--jobs` sets build parallelism, 1 to 64
and 2 by default, and `--sentencepiece-prefix` points CMake at SentencePiece
files outside the system paths. The script checks that the NeMo-Speech.cpp
commit records ggml `c03b4e2bcece5134827881af90242086daf75be5`, exports both
commits with `git archive`, so uncommitted changes never reach the build, and
applies the patches. It builds ASR and its C interface only, for generic
x86-64 with AVX2, FMA and F16C and without host tuning, OpenMP, AVX-512 or AMX,
and ignores compiler flags from your shell. It refuses a result that contains
`/home/`, the output path or a runtime search path outside `$ORIGIN`, then
writes `payload/` with `lib/`, `libbench_nemo_pool.so` and `NATIVE-BUILD.json`.

## Use a rebuild

`runtime/speech/NATIVE-BUILD.json` describes the libraries VOCO ships. CI fills
`runtime/speech/` with `scripts/provision-ci-speech.sh`, which copies the model
and native files from a published package pinned by SHA-256, after checking
that its receipts equal the checked-in ones. To use a rebuild, replace `lib/`,
keeping its links, `libbench_nemo_pool.so` and `NATIVE-BUILD.json` there
together. `scripts/lib/test-speech-runtime.sh`, which stages the runtime for
desktop tests, and `scripts/verify-speech-payload.py`, which
`scripts/verify-deb-package.sh` runs on the built package, compare every native
file and link with the receipt and the model with `MODEL-IDENTITY.json`.
`scripts/package-nvidia.py` copies `runtime/speech/` into the package, refuses
a model with another hash, and records every file in the `MANIFEST.json` that
the verifier checks.

## Known limits

- The recipe doesn't convert the NVIDIA model to GGUF, so the pinned model
  bytes come from a published package.
- Nothing checks that a rebuild reproduces the recorded hashes. They depend on
  the toolchain and the system SentencePiece, and the receipt records only the
  compiler and CMake versions.
- The libraries need an x86-64 CPU with AVX2, FMA and F16C.
