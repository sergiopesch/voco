#!/usr/bin/env python3
"""Test the application's resolved glib with release optimization and no desktop.

The tiny harness avoids linking the whole desktop for a dependency regression.
Its dependency versions must match the production lockfile. Fresh evidence paths
retain compiler/source identity and failures, including an upstream crash repro.
"""
import argparse
import hashlib
import json
from pathlib import Path
import resource
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def metadata(manifest, locked=False):
    return json.loads(subprocess.check_output([
        "cargo", "metadata", "--offline", "--format-version", "1",
        "--manifest-path", str(manifest), "--filter-platform", "x86_64-unknown-linux-gnu",
        *(["--locked", "--features", "custom-protocol"] if locked else []),
    ], text=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--filter", default="")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    manifest = ROOT / "apps/desktop/src-tauri/Cargo.toml"
    production = metadata(manifest, locked=True)
    glib = [p for p in production["packages"] if p["name"] == "glib"]
    if len(glib) != 1:
        raise RuntimeError("Expected exactly one resolved glib dependency")
    glib_root = Path(glib[0]["manifest_path"]).parent
    harness = args.output / "harness"
    harness.mkdir()
    test = ROOT / "apps/desktop/src-tauri/tests/glib_variant_iter.rs"
    (harness / "Cargo.toml").write_text(
        '[package]\nname = "voco-glib-regression"\nversion = "0.0.0"\nedition = "2021"\n'
        '[dependencies]\nglib = { path = ' + json.dumps(str(glib_root)) + ' }\n'
        '[[test]]\nname = "variant_iter"\npath = ' + json.dumps(str(test)) + '\n'
        '[profile.release]\nopt-level = 3\nlto = "thin"\ncodegen-units = 1\n'
    )
    shutil.copyfile(manifest.with_name("Cargo.lock"), harness / "Cargo.lock")
    resolved = metadata(harness / "Cargo.toml")
    production_versions = {(p["name"], p["version"]) for p in production["packages"]}
    for package in resolved["packages"]:
        if package["name"] != "voco-glib-regression":
            assert (package["name"], package["version"]) in production_versions, package
    command = ["cargo", "test", "--locked", "--offline", "--manifest-path",
               str(harness / "Cargo.toml"), "--target-dir",
               str(ROOT / "apps/desktop/src-tauri/target/glib-regression")]
    if not args.debug:
        command.append("--release")
    command += ["--test", "variant_iter", args.filter, "--", "--test-threads=1"]
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    result = subprocess.run(command, check=False)
    receipt = {
        "passed": result.returncode == 0, "exitCode": result.returncode,
        "command": command, "profile": "debug" if args.debug else "release",
        "glibVersion": glib[0]["version"], "glibSource": str(glib_root),
        "variantIterSha256": hashlib.sha256((glib_root / "src/variant_iter.rs").read_bytes()).hexdigest(),
        "testSha256": hashlib.sha256(test.read_bytes()).hexdigest(),
        "rustc": subprocess.check_output(["rustc", "-Vv"], text=True),
        "scope": "Dependency iterator regression; no live application, audio or input session",
    }
    (args.output / "result.json").write_text(json.dumps(receipt, indent=2) + "\n")
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
