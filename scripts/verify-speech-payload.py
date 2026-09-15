#!/usr/bin/env python3
"""Verify the complete NVIDIA payload in an extracted VOCO Debian package."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

SOURCE_ROOT = Path(__file__).resolve().parents[1]
NATIVE_FILES = {"lib/libggml-base.so.0.12.0", "lib/libggml-cpu.so.0.12.0",
                "lib/libggml.so.0.12.0", "lib/libnemo_speech_asr.so",
                "lib/libnemo_speech_asr_c.so.1"}
NATIVE_LINKS = {f"lib/lib{name}.so.0": f"lib{name}.so.0.12.0"
                for name in ("ggml-base", "ggml-cpu", "ggml")}
NATIVE_LINKS.update({f"lib/lib{name}.so": f"lib{name}.so.0"
                     for name in ("ggml-base", "ggml-cpu", "ggml")})
NATIVE_LINKS["lib/libnemo_speech_asr_c.so"] = "libnemo_speech_asr_c.so.1"
REQUIRED_FILES = NATIVE_FILES | {
    "stream_worker.py", "worker_main.py", "streaming.py", "adapters.py",
    "MODEL-IDENTITY.json", "BUILD-IDENTITY.json", "voco-cpu-check", "libbench_nemo_pool.so",
    "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf",
}
COMPILED_FILES = NATIVE_FILES | {"libbench_nemo_pool.so", "voco-cpu-check"}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read_regular_json(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Missing regular payload metadata: {path.name}")
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f"Invalid payload metadata object: {path.name}")
    return value


def verify_build_identity(speech, files):
    identity = read_regular_json(speech / "BUILD-IDENTITY.json")
    if identity.get("schema") != 1:
        raise ValueError("Unsupported native build identity schema")
    # This release gate verifies against its own checkout, including source
    # archives without Git. A self-consistent package receipt is not provenance.
    if identity.get("source") != read_regular_json(SOURCE_ROOT / "runtime/NATIVE-SOURCE.json"):
        raise ValueError("Native build source differs from the current source pin")
    for key, name in (("bridge_sha256", "nemo_bridge.cpp"),
                      ("cpu_check_sha256", "cpu_check.c")):
        if identity.get(key) != digest(SOURCE_ROOT / "runtime/speech" / name):
            raise ValueError(f"Native build source checksum mismatch: {name}")
    built = identity.get("files")
    if not isinstance(built, dict) or any(built.get(name) != files[name]
                                          for name in COMPILED_FILES):
        raise ValueError("Native build binary checksums differ from payload")
    if identity.get("symlinks") != NATIVE_LINKS:
        raise ValueError("Native build loader aliases differ from payload")


def verify(root, version):
    parent = root
    for component in ("", "usr", "lib", "voco", "speech"):
        parent = parent / component
        if parent.is_symlink() or not parent.is_dir():
            raise ValueError("Speech payload parent must be a real directory")
    speech = root / "usr/lib/voco/speech"
    manifest = read_regular_json(speech / "MANIFEST.json")
    if manifest.get("version") != version:
        raise ValueError("Speech manifest version differs from package")
    if not isinstance(manifest.get("files"), dict) or set(manifest["files"]) != REQUIRED_FILES:
        raise ValueError("Incomplete or unexpected speech runtime manifest")
    if manifest.get("symlinks") != NATIVE_LINKS:
        raise ValueError("Incomplete or unexpected native library link closure")
    actual_files, actual_links = set(), {}
    for path in speech.rglob("*"):
        relative = str(path.relative_to(speech))
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode):
            target = os.readlink(path)
            if (NATIVE_LINKS.get(relative) != target
                    or not path.resolve().is_relative_to(speech.resolve())
                    or not path.is_file()):
                raise ValueError(f"Invalid speech symlink: {relative}")
            actual_links[relative] = target
        elif stat.S_ISDIR(mode):
            if relative not in {"lib", "models"}:
                raise ValueError(f"Unexpected speech payload directory: {relative}")
        elif not stat.S_ISREG(mode):
            raise ValueError(f"Unexpected speech payload object: {relative}")
        elif relative != "MANIFEST.json":
            actual_files.add(relative)
            if digest(path) != manifest["files"].get(relative):
                raise ValueError(f"Speech file missing from manifest or changed: {relative}")
    if actual_files != set(manifest["files"]) or actual_links != manifest.get("symlinks", {}):
        raise ValueError("Speech payload inventory mismatch")
    guard = speech / "voco-cpu-check"
    if guard.stat().st_mode & 0o111 != 0o111:
        raise ValueError("CPU compatibility guard must be executable")
    identity = read_regular_json(speech / "MODEL-IDENTITY.json")
    model = "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf"
    if manifest["files"][model] != identity["model_sha256"]:
        raise ValueError("Model identity differs from payload")
    verify_build_identity(speech, manifest["files"])
    return {"files": len(actual_files), "symlinks": len(actual_links), "version": version}


if __name__ == "__main__":
    print(json.dumps(verify(Path(sys.argv[1]), sys.argv[2])))
