# Native speech runtime

The .42 native libraries are built from NVIDIA's NeMo-Speech.cpp commit
`a5b6953c4a579a2bbd1c0913ad8a85c2a4d99953` and its ggml submodule
`c03b4e2bcece5134827881af90242086daf75be5`. Two included patches correct
first-chunk overlap accounting and reuse the CPU thread pool. The C bridge is
[`../speech/nemo_bridge.cpp`](../speech/nemo_bridge.cpp).

On an amd64 build system with Git, Python 3, CMake, a C/C++ compiler, Make,
binutils, patch and SentencePiece development headers installed:

```bash
git clone https://github.com/NVIDIA/NeMo-Speech.cpp.git /tmp/nemo-source
git -C /tmp/nemo-source checkout a5b6953c4a579a2bbd1c0913ad8a85c2a4d99953
git -C /tmp/nemo-source submodule update --init ggml
python3 runtime/native/build.py --source /tmp/nemo-source --output /tmp/voco-native-build
```

`--output` must not exist. The builder exports the pinned Git objects, verifies
patch identities, builds ASR and its C interface, and writes libraries plus a
`NATIVE-BUILD.json` receipt under `payload/`. Dirty upstream working files are
never used. `--sentencepiece-prefix` can point at extracted development packages;
the .42 release used Ubuntu SentencePiece 0.2.0-1build1, GCC 13.3 and CMake 3.28.3.
SentencePiece remains a system dependency, not a bundled library.

The explicit baseline is x86_64 with AVX2, FMA and F16C. Host-native, AVX-512,
AVX-VNNI, BMI2 and AMX optimizations and OpenMP are disabled. Prefix maps remove
build paths, and library lookup uses relative `$ORIGIN` paths. Review generated
compiler flags, licenses, ABI dependencies and receipt hashes before provisioning
the payload into `runtime/speech/`; a rebuild must be requalified even when source
pins match. Keep the previously qualified payload for comparison.

The checked-in `runtime/speech/NATIVE-BUILD.json` describes the public release's
specific native bytes. Rebuilders replace that receipt together with **all** native
libraries, then run package verification, real-worker speech/protocol checks and
isolated desktop tests. Do not mix receipts and libraries from different builds.

This supplies native source and a build recipe. It does not establish bit-for-bit
reproducibility across toolchains, or reproduce conversion of the pinned NVIDIA
model to GGUF. Model provisioning and distribution terms are described in
[Linux packaging](../../docs/linux-packaging.md#runtime-provisioning) and
[`runtime/notices`](../notices/).
