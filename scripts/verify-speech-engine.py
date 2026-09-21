#!/usr/bin/env python3
"""Keep the retired recognizer out of shipping source and dependency metadata."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
prefixes = ("apps/desktop/src/", "apps/desktop/src-tauri/src/", "vendor/",
            "runtime/speech/", "packaging/", ".github/workflows/")
manifests = {"package.json", "package-lock.json", "apps/desktop/package.json",
             "apps/desktop/src-tauri/Cargo.toml", "apps/desktop/src-tauri/Cargo.lock"}
failures = []
retired = (b"whisper", b"base.en", b"transcribe_partial_audio", b"download_model")
for name in paths:
    if not (name.startswith(prefixes) or name in manifests):
        continue
    path = root / name
    if not path.is_file():
        continue
    # Upstream model cards, sample attributions and dated qualification records
    # live outside this executable-source gate and retain their original facts.
    content = path.read_bytes().lower()
    if "whisper" in name.lower() or any(token in content for token in retired):
        failures.append(name)
if failures:
    raise SystemExit("Retired speech engine references: " + ", ".join(failures))
print("Single speech engine: shipping source and dependency metadata are clean")
