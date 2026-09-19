#!/usr/bin/env python3
"""Build the pinned NVIDIA CPU runtime in a new directory, without modifying sources."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
NEMO = "a5b6953c4a579a2bbd1c0913ad8a85c2a4d99953"
GGML = "c03b4e2bcece5134827881af90242086daf75be5"
PATCHES = {
    "first-chunk.patch": "617e3d67a0f92296346f154eeee826ec8ca6afdc8c44bfdc061cd510346e0f32",
    "thread-pool.patch": "ab84627970075b78a72afdf3d82356d3ab6a8630bf21eb2214a50cfc9fcb9563",
}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def archive(repo, commit, destination, receipt):
    # Export immutable Git objects, never the caller's possibly dirty worktree.
    with receipt.open("xb") as stream:
        subprocess.run(["git", "-C", str(repo), "archive", commit], stdout=stream, check=True)
    destination.mkdir(parents=True, exist_ok=True)
    subprocess.run(["tar", "-xf", str(receipt), "-C", str(destination)], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="NeMo-Speech.cpp Git clone with ggml submodule")
    parser.add_argument("--output", required=True, type=Path, help="New build/receipt directory")
    parser.add_argument("--sentencepiece-prefix", type=Path, help="Optional development package prefix")
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.jobs <= 64:
        parser.error("jobs must be between 1 and 64")
    for name, expected in PATCHES.items():
        if digest(HERE / name) != expected:
            raise ValueError(f"Patch identity mismatch: {name}")
    submodule = subprocess.check_output(
        ["git", "-C", str(args.source), "ls-tree", NEMO, "ggml"], text=True)
    if submodule.split()[2] != GGML:
        raise ValueError("ggml submodule identity mismatch")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    source, build, payload = output / "source", output / "build", output / "payload"
    archive(args.source, NEMO, source, output / "nemo-source.tar")
    archive(args.source / "ggml", GGML, source / "ggml", output / "ggml-source.tar")
    for name in PATCHES:
        subprocess.run(["patch", "--batch", "--forward", "-p1", "-i", str(HERE / name)], cwd=source, check=True)
    flags = (f"-march=x86-64 -mtune=generic -ffile-prefix-map={output}=/usr/src/voco-native "
             f"-fdebug-prefix-map={output}=/usr/src/voco-native")
    options = {"CMAKE_BUILD_TYPE": "Release", "CMAKE_BUILD_WITH_INSTALL_RPATH": "ON",
               "CMAKE_C_FLAGS": flags, "CMAKE_CXX_FLAGS": flags,
               "NEMO_SPEECH_BUILD_ASR": "ON", "NEMO_SPEECH_BUILD_DIAR": "OFF",
               "NEMO_SPEECH_BUILD_TTS": "OFF", "NEMO_SPEECH_BUILD_NMT": "OFF",
               "NEMO_SPEECH_GGML_PATCHED": "OFF", "NEMO_SPEECH_BUILD_MIC_CAPTURE": "OFF",
               "GGML_OPENMP": "OFF", "GGML_NATIVE": "OFF"}
    options.update({"GGML_" + name: "ON" for name in ("AVX", "AVX2", "FMA", "F16C")})
    options.update({"GGML_" + name: "OFF" for name in (
        "AVX512", "AVX512_VBMI", "AVX512_VNNI", "AVX512_BF16", "AVX_VNNI",
        "AMX_TILE", "AMX_INT8", "AMX_BF16", "BMI2")})
    if args.sentencepiece_prefix:
        options["CMAKE_PREFIX_PATH"] = str(args.sentencepiece_prefix.resolve())
    # Do not inherit host CPU optimization settings from the developer's shell.
    env = {k: v for k, v in os.environ.items() if k not in ("CFLAGS", "CXXFLAGS", "CPPFLAGS", "LDFLAGS")}
    subprocess.run(["cmake", "-S", str(source), "-B", str(build),
                    *[f"-D{k}={v}" for k, v in options.items()]], env=env, check=True)
    subprocess.run(["cmake", "--build", str(build), "--target", "nemo_speech_asr_c",
                    "--parallel", str(args.jobs)], env=env, check=True)
    (payload / "lib").mkdir(parents=True)
    for path in sorted((build / "bin").glob("*.so*")):
        shutil.copy2(path, payload / "lib" / path.name, follow_symlinks=False)
    bridge = HERE.parent / "speech/nemo_bridge.cpp"
    subprocess.run(["c++", "-shared", "-fPIC", "-O2", "-march=x86-64", "-mtune=generic",
                    f"-ffile-prefix-map={bridge.parent}=/usr/src/voco-native/bridge",
                    str(bridge), "-I" + str(source / "include"), "-L" + str(build / "bin"),
                    "-lnemo_speech_asr_c", "-Wl,-rpath,$ORIGIN/lib", "-o",
                    str(payload / "libbench_nemo_pool.so")], env=env, check=True)
    # Fail before publishing a payload if build-machine paths or external RPATHs survive.
    for path in payload.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        strings = subprocess.check_output(["strings", str(path)])
        dynamic = subprocess.check_output(["readelf", "-d", str(path)], text=True)
        if b"/home/" in strings or str(output).encode() in strings:
            raise ValueError(f"Build path leaked into {path.name}")
        for line in dynamic.splitlines():
            if "RPATH" in line or "RUNPATH" in line:
                if any(not p.startswith("$ORIGIN") for p in line.split("[", 1)[1].split("]", 1)[0].split(":")):
                    raise ValueError(f"Non-relative runtime path in {path.name}")
    public_options = {k: v.replace(str(output), "/build") for k, v in options.items() if k != "CMAKE_PREFIX_PATH"}
    receipt = dict(schemaVersion=1, upstream="https://github.com/NVIDIA/NeMo-Speech.cpp",
                   revision=NEMO, ggmlRevision=GGML, patches=PATCHES,
                   bridgeSha256=digest(bridge), options=public_options,
                   compiler=subprocess.check_output(["c++", "--version"], text=True).splitlines()[0],
                   cmake=subprocess.check_output(["cmake", "--version"], text=True).splitlines()[0],
                   files={str(p.relative_to(payload)): digest(p) for p in sorted(payload.rglob("*")) if p.is_file() and not p.is_symlink()},
                   symlinks={str(p.relative_to(payload)): os.readlink(p) for p in sorted(payload.rglob("*")) if p.is_symlink()})
    (payload / "NATIVE-BUILD.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"payload": str(payload), "nativeFiles": len(receipt["files"])}))


if __name__ == "__main__":
    main()
