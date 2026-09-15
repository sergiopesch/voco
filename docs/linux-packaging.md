# Linux packaging

The complete Debian package contains the app, browser host, Python speech worker,
NVIDIA Nemotron English Q8_0 model and its native CPU libraries. A Tauri base
package alone is incomplete. Model weights and compiled libraries stay out of Git.

## Support matrix

The build baseline is Ubuntu 24.04, x86_64, GCC 13. The native speech backend
requires OS-enabled AVX, AVX2, FMA, F16C, BMI2 and SSE4.2. A standalone baseline
CPU check runs before loading those libraries and fails clearly on unsupported
hardware. It does not enable instructions the operating system has disabled.

Use the exact release's validation record for tested distributions and desktop
behavior. Older [cross-Linux userspace checks](testing/cross-linux-review-2026-09-15.md)
are useful context, not qualification of new binaries. Containers share a host
kernel; virtual input tests do not establish physical microphone or default
compositor compatibility. Some custom or protected fields cannot accept paste.

## Runtime provisioning

Build in a disposable Ubuntu 24.04 environment using neutral paths, such as
`/src` and `/build`. Install Git, CMake, Make, GCC/G++, binutils, curl and
`libsentencepiece-dev`. Then, from the source root:

```bash
python3 scripts/build-nvidia-runtime.py \
  --work-dir /build/native --output /build/payload
python3 scripts/provision-nvidia-model.py
```

The native builder checks out exact NeMo and GGML commits, verifies two patches
and their resulting files, and records the toolchain, flags and output hashes.
[Native provenance](../runtime/NATIVE-SOURCE.json) defines those inputs. The CPU
backend uses a fixed instruction baseline, never `-march=native`; debug and
assertion source paths are remapped. The desktop wrapper and CI also set
`WHISPER_NATIVE=OFF` for the separate compatibility engine. Model provisioning downloads NVIDIA's exact
revision and requires the pinned size and SHA-256 in
[model identity](../runtime/speech/MODEL-IDENTITY.json). It never substitutes another
model, quantization or mutable revision. This reproduces the published model bytes;
it does not claim to reproduce NVIDIA's checkpoint-to-GGUF conversion.

Copy `lib/`, `libbench_nemo_pool.so`, `voco-cpu-check` and `BUILD-IDENTITY.json`
from the fresh native payload into `runtime/speech/`. Preserve relative library
links. The builder's notices and source patches supplement the app's required
[runtime notices](../runtime/notices/NOTICE); all native/model licenses remain
separate from VOCO's MIT license.

## Build and verify

Follow [development setup](contributing.md) for desktop dependencies. Use a fresh
Cargo target directory and neutral HOME/cache paths. Set Rust
`--remap-path-prefix` and C/C++ `-ffile-prefix-map` flags for source and build paths.
The release workflow records these settings. Never reuse native object files built
with private paths or host-specific CPU options.

```bash
npm ci
npm run build
python3 scripts/package-nvidia.py BASE.deb COMPLETE.deb
bash scripts/verify-deb-package.sh COMPLETE.deb
```

The build wrapper obtains the matching browser host from Cargo's output. Assembly
requires the matching base version, exact runtime files, model digest and licenses.
It copies only [listed public documentation](../packaging/public-docs.json), rejects
symlinked source documents and unsafe loader links, normalizes permissions and
writes a payload inventory. Unlisted local recordings, logs and documents are
excluded. Existing output packages are never overwritten.

Before publication, unpack the exact archive and check its entire inventory,
embedded paths, credentials, ELF dependencies and checksums. Run worker, desktop
delivery and isolated install/remove checks against those bytes. Record timing
comparisons anew when native flags change. See [release process](release-process.md).

## Desktop integration

The package declares Python, NumPy, psutil, SentencePiece, accessibility and
clipboard dependencies. It installs IBus protocol 6 for dictation shortcut ownership;
that helper never mutates text. Installation does not select an input source,
restart IBus, change keyboard permissions or modify browser profiles.

The optional Chromium extension uses a fixed public extension identity and a
same-user private socket. Its native host and manifests are package-owned. The
extension is activated by the user. Normal cursor delivery uses clipboard paste,
never Enter, with focus guards and explicit recovery after interruptions.

Performance logs are off by default. [Diagnostics](testing/laptop-performance.md)
explains opt-in timings and content-free error categories. Logs are not proof of
text appearing in a target field; independent field readback is needed for that.

## Native Fedora and Arch candidate recipes

`scripts/stage-native-packages.py` wraps an explicitly hash-verified complete
Debian payload in RPM/Arch recipes. These wrappers preserve the same application
bytes; they are not independent source builds or signed distribution repositories.

```bash
python3 scripts/stage-native-packages.py COMPLETE.deb FRESH_DIRECTORY \
  --sha256 EXPECTED_SHA256 --verifier "$PWD/scripts/verify-deb-package.sh"
```

Build and test them only in disposable distribution environments. Keep dependency,
payload-parity and install/remove receipts. Fedora needs GStreamer's base/good
plugins; Arch also needs a separately verified SentencePiece package. Do not
silently run an arbitrary AUR recipe. `scripts/verify-native-install.py` validates
installed payload bytes and removal in a disposable Docker environment.

## Experimental channels

Flatpak, Snap and AppImage recipes are research paths, not supported public
channels. Flatpak sandbox behavior, Snap confinement and the complete AppImage
builder chain require separate qualification. Do not infer readiness from a recipe.
The experimental AppImage helper requires a pre-fetched tool and its expected hash.

Brand assets use VOCO's graphite microphone. Launch videos and private benchmark
media belong outside the repository. Public package names are
`voco_<version>_amd64.deb` and `voco_latest_amd64.deb`, with matching checksum files.
