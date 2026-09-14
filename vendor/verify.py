#!/usr/bin/env python3
"""Verify the exact pinned speech sources without mutable or optional assertions."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys


ROOTS = ["whisper-rs", "whisper-rs-sys"]


def verify(root: Path) -> dict:
    inventory_path = root / "OWNED-FILES.json"
    if not stat.S_ISREG(inventory_path.lstat().st_mode):
        raise ValueError("Source inventory must be a regular file")
    inventory_bytes = inventory_path.read_bytes()
    manifest = json.loads(inventory_bytes)
    if (not isinstance(manifest, dict) or type(manifest.get("schemaVersion")) is not int
            or manifest["schemaVersion"] != 1):
        raise ValueError("Unsupported source inventory schema")
    if manifest.get("roots") != ROOTS:
        raise ValueError("Source inventory must cover both pinned crate roots")
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        raise ValueError("Source inventory must contain files")
    expected = {}
    for item in entries:
        if not isinstance(item, dict):
            raise ValueError("Invalid source inventory entry")
        name = item.get("path")
        if not isinstance(name, str):
            raise ValueError("Inventory path must be a string")
        path = PurePosixPath(name)
        if (path.is_absolute() or len(path.parts) < 2
                or path.parts[0] not in ROOTS or ".." in path.parts
                or path.as_posix() != name):
            raise ValueError(f"Invalid inventory path: {name}")
        if name in expected:
            raise ValueError(f"Duplicate inventory path: {name}")
        if (type(item.get("bytes")) is not int or item["bytes"] < 0
                or type(item.get("executable")) is not bool
                or not isinstance(item.get("sha256"), str)
                or re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) is None):
            raise ValueError(f"Invalid inventory metadata: {name}")
        expected[name] = item

    actual = {}
    for name in ROOTS:
        tree = root / name
        if tree.is_symlink() or not tree.is_dir():
            raise ValueError(f"Missing or symlink source root: {name}")
        for path in tree.rglob("*"):
            mode = path.lstat().st_mode
            if stat.S_ISDIR(mode):
                continue
            if not stat.S_ISREG(mode):
                raise ValueError(f"Nonregular entry in owned source: {path.relative_to(root)}")
            actual[path.relative_to(root).as_posix()] = path
    if actual.keys() != expected.keys():
        raise ValueError(
            f"Owned file set differs: missing={sorted(expected.keys() - actual.keys())}, "
            f"extra={sorted(actual.keys() - expected.keys())}"
        )
    for name, path in actual.items():
        item = expected[name]
        data = path.read_bytes()
        if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError(f"Content changed: {name}")
        if bool(path.stat().st_mode & 0o111) != item["executable"]:
            raise ValueError(f"Executable permission changed: {name}")
    return {
        "passed": True,
        "files": len(actual),
        "inventorySha256": hashlib.sha256(inventory_bytes).hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vendor-root", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    try:
        result = verify(args.vendor_root.resolve())
    except (OSError, ValueError, TypeError) as error:
        print(f"Speech source verification failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
