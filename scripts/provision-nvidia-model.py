#!/usr/bin/env python3
"""Provision the exact public NVIDIA GGUF; never substitute model bytes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
IDENTITY_PATH = ROOT / "runtime/speech/MODEL-IDENTITY.json"
SOURCE = "https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b"
FILENAME = "nemotron-speech-streaming-en-0.6b.q8_0.gguf"
MODEL_BYTES = 699872960


def read_identity():
    identity = json.loads(IDENTITY_PATH.read_text())
    if not isinstance(identity, dict) or identity.get("source") != SOURCE:
        raise ValueError("Model identity must use the expected NVIDIA HTTPS repository")
    for key, length in (("revision", 40), ("model_sha256", 64)):
        value = identity.get(key)
        if not isinstance(value, str) or not re.fullmatch(rf"[0-9a-f]{{{length}}}", value):
            raise ValueError(f"Model identity requires a pinned {key}")
    return identity


def verify_file(path, expected_digest):
    # NONBLOCK avoids hanging on a FIFO; inspect the actual opened file and never
    # follow a symlink, including a dangling target supplied as a cache entry.
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Model must be a regular file")
        if before.st_size != MODEL_BYTES:
            raise ValueError("Model size does not match the pinned artifact")
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
        after = os.fstat(stream.fileno())
    current = path.lstat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
        after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns
    ) or (current.st_dev, current.st_ino) != (after.st_dev, after.st_ino):
        raise ValueError("Model changed during verification")
    if stat.S_ISLNK(current.st_mode) or actual != expected_digest:
        raise ValueError("Model SHA-256 does not match the pinned artifact")


def provision(output):
    identity = read_identity()
    # abspath preserves the final path component so a symlink is rejected rather
    # than resolved into a different publication destination.
    output = Path(os.path.abspath(output))
    expected = identity["model_sha256"]
    try:
        output.lstat()
    except FileNotFoundError:
        pass
    else:
        verify_file(output, expected)
        return {"status": "reused", "bytes": MODEL_BYTES, "sha256": expected}

    output.parent.mkdir(parents=True, exist_ok=True)
    url = f"{identity['source']}/resolve/{identity['revision']}/{FILENAME}"
    with tempfile.TemporaryDirectory(prefix=".voco-model-", dir=output.parent) as directory:
        temporary = Path(directory) / FILENAME
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
        subprocess.run([
            "curl", "--disable", "--fail", "--location", "--proto", "=https",
            "--proto-redir", "=https", "--retry", "3", "--retry-max-time", "900",
            "--connect-timeout", "30", "--max-time", "900",
            "--max-filesize", str(MODEL_BYTES), "--output", str(temporary), url,
        ], check=True, timeout=960)
        verify_file(temporary, expected)
        # The sibling staging directory ensures one filesystem. link() publishes
        # complete verified bytes atomically and refuses any existing destination.
        os.link(temporary, output, follow_symlinks=False)
    return {"status": "downloaded", "bytes": MODEL_BYTES, "sha256": expected}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "runtime/speech/models" / FILENAME)
    args = parser.parse_args()
    try:
        result = provision(args.output)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Model provisioning failed: {error}\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
