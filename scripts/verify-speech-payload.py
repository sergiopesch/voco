#!/usr/bin/env python3
"""Verify the complete NVIDIA payload in an extracted VOCO Debian package."""
import hashlib
import json
import os
from pathlib import Path
import sys

NATIVE_FILES = {"lib/libggml-base.so.0.12.0", "lib/libggml-cpu.so.0.12.0",
                "lib/libggml.so.0.12.0", "lib/libnemo_speech_asr.so",
                "lib/libnemo_speech_asr_c.so.1"}
NATIVE_LINKS = {f"lib/lib{name}.so.0": f"lib{name}.so.0.12.0"
                for name in ("ggml-base", "ggml-cpu", "ggml")}
NATIVE_LINKS.update({f"lib/lib{name}.so": f"lib{name}.so.0"
                     for name in ("ggml-base", "ggml-cpu", "ggml")})
NATIVE_LINKS["lib/libnemo_speech_asr_c.so"] = "libnemo_speech_asr_c.so.1"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify(root, version):
    speech = root / "usr/lib/voco/speech"
    manifest = json.loads((speech / "MANIFEST.json").read_text())
    if manifest["version"] != version:
        raise ValueError("Speech manifest version differs from package")
    required = {"stream_worker.py", "worker_main.py", "streaming.py", "adapters.py",
                "MODEL-IDENTITY.json", "NATIVE-BUILD.json", "libbench_nemo_pool.so",
                "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf"}
    if not (required | NATIVE_FILES).issubset(manifest["files"]):
        raise ValueError("Incomplete speech runtime manifest")
    if any(manifest.get("symlinks", {}).get(name) != target for name, target in NATIVE_LINKS.items()):
        raise ValueError("Incomplete native library link closure")
    actual_files, actual_links = set(), {}
    for path in speech.rglob("*"):
        relative = str(path.relative_to(speech))
        if path.is_symlink():
            target = os.readlink(path)
            if (Path(target).is_absolute() or not path.resolve().is_relative_to(speech.resolve())
                    or not path.is_file()):
                raise ValueError(f"Invalid speech symlink: {relative}")
            actual_links[relative] = target
        elif path.is_file() and relative != "MANIFEST.json":
            actual_files.add(relative)
            if digest(path) != manifest["files"].get(relative):
                raise ValueError(f"Speech file missing from manifest or changed: {relative}")
    if actual_files != set(manifest["files"]) or actual_links != manifest.get("symlinks", {}):
        raise ValueError("Speech payload inventory mismatch")
    identity = json.loads((speech / "MODEL-IDENTITY.json").read_text())
    model = "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf"
    if manifest["files"][model] != identity["model_sha256"]:
        raise ValueError("Model identity differs from payload")
    native = json.loads((speech / "NATIVE-BUILD.json").read_text())
    if set(native["files"]) != NATIVE_FILES | {"libbench_nemo_pool.so"}:
        raise ValueError("Native build inventory is incomplete")
    if any(manifest["files"].get(name) != sha for name, sha in native["files"].items()):
        raise ValueError("Native build identity differs from payload")
    if native["symlinks"] != NATIVE_LINKS:
        raise ValueError("Native build link identity differs from payload")
    return {"files": len(actual_files), "symlinks": len(actual_links), "version": version}


if __name__ == "__main__":
    print(json.dumps(verify(Path(sys.argv[1]), sys.argv[2])))
