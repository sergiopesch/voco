#!/usr/bin/env python3
"""Assemble a complete local NVIDIA Debian candidate from a Tauri base package."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
VENDORED_SHORTCUT_NOTICES = (
    "VOCO-PATCH.md", "VOCO-UPSTREAM.json", "LICENSE-APACHE", "LICENSE-MIT", "LICENSE.spdx",
)


def digest(path, algorithm="sha256"):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, algorithm).hexdigest()


def payload_inventory(directory):
    """Record links as links, and reject dependencies outside this payload."""
    files, links = {}, {}
    for path in sorted(directory.rglob("*")):
        relative = str(path.relative_to(directory))
        if path.name == "MANIFEST.json":
            continue
        if path.is_symlink():
            target = os.readlink(path)
            if Path(target).is_absolute() or not path.resolve().is_relative_to(directory.resolve()):
                raise ValueError(f"Runtime link escapes payload: {relative}")
            if not path.is_file():
                raise ValueError(f"Runtime link is broken: {relative}")
            links[relative] = target
        elif path.is_file():
            if "__pycache__" in path.parts or path.suffix == ".pyc":
                raise ValueError(f"Runtime contains generated cache: {relative}")
            files[relative] = digest(path)
    return {"files": files, "symlinks": links}


def normalize_payload_modes(directory):
    """Drop inherited write/special bits in the private package staging tree.

    Root ownership is supplied by dpkg-deb. Keep executable intent, preserve
    symlinks without following them, and reject non-file payload objects.
    """
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Payload root must be a regular directory")
    for parent, directories, files in os.walk(directory, followlinks=False):
        Path(parent).chmod(0o755)
        for name in directories + files:
            path = Path(parent) / name
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode):
                continue
            if stat.S_ISDIR(mode):
                path.chmod(0o755)
            elif stat.S_ISREG(mode):
                path.chmod(0o755 if mode & 0o111 else 0o644)
            else:
                raise ValueError(f"Unsupported payload object: {path.relative_to(directory)}")


def validate_base_executables(stage):
    """Reject incomplete direct Tauri bundles before copying the model payload."""
    for name in ("usr/bin/voco", "usr/libexec/voco-browser-host"):
        path = stage / name
        if (path.is_symlink() or not path.is_file()
                or not path.resolve().is_relative_to(stage.resolve())
                or path.stat().st_mode & 0o111 != 0o111):
            raise ValueError(
                f"Base package is missing a regular executable /{name}; "
                "run npm run build to bundle the matching application and browser host")


def copy_vendored_shortcut_notices(source_root, doc):
    """Ship the patched dependency's licenses and provenance, not its build tree.

    Preserve the source-relative vendor path used by README/AGENTS/docs links.
    Missing notices must fail assembly rather than produce an incomplete release.
    """
    source = source_root / "vendor/global-hotkey"
    for name in VENDORED_SHORTCUT_NOTICES:
        path = source / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Missing regular vendored shortcut notice: {name}")
    destination = doc / "vendor/global-hotkey"
    destination.mkdir(parents=True, exist_ok=True)
    for name in VENDORED_SHORTCUT_NOTICES:
        shutil.copy2(source / name, destination / name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--debian-version", help="Local revision, e.g. 2026.0.35+local1")
    args = parser.parse_args()
    base, output = args.base.resolve(), args.output.resolve()
    version = json.loads((ROOT / "package.json").read_text())["version"]
    package_version = args.debian_version or version
    if package_version != version and not package_version.startswith(version + "+"):
        parser.error("Debian revision must extend the application version with +suffix")
    subprocess.run(["dpkg", "--validate-version", package_version], check=True)
    actual = subprocess.check_output(["dpkg-deb", "-f", str(base), "Version"], text=True).strip()
    if actual != version:
        parser.error(f"Base package version {actual} does not match source {version}")
    if output.exists():
        parser.error("Output already exists; choose a fresh candidate filename")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="voco-package-", dir=output.parent) as directory:
        stage = Path(directory) / "stage"
        subprocess.run(["dpkg-deb", "-R", str(base), str(stage)], check=True)
        validate_base_executables(stage)
        speech = stage / "usr/lib/voco/speech"
        speech.mkdir(parents=True)
        source = ROOT / "runtime/speech"
        for name in ("stream_worker.py", "worker_main.py", "streaming.py", "adapters.py",
                     "MODEL-IDENTITY.json", "libbench_nemo_pool.so"):
            shutil.copy2(source / name, speech / name)
        for name in ("lib", "models"):
            shutil.copytree(source / name, speech / name, symlinks=True)
        model = speech / "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf"
        expected = json.loads((speech / "MODEL-IDENTITY.json").read_text())["model_sha256"]
        if digest(model) != expected:
            raise ValueError("Packaged model does not match pinned MODEL-IDENTITY.json")
        doc = stage / "usr/share/doc/voco"
        shutil.copytree(ROOT / "runtime/notices", doc / "nvidia", dirs_exist_ok=True)
        for name in ("report-performance.py", "report-speech-performance.py"):
            shutil.copy2(ROOT / "scripts" / name, doc / name)
        for name in ("README.md", "AGENTS.md"):
            shutil.copy2(ROOT / name, doc / name)
        shutil.copytree(ROOT / "docs", doc / "docs", dirs_exist_ok=True)
        copy_vendored_shortcut_notices(ROOT, doc)
        identity = {"version": package_version, "application_version": version,
                    "backend": "CPU native pool", "context": 1, "cpu_threads": 4,
                    **payload_inventory(speech)}
        (speech / "MANIFEST.json").write_text(json.dumps(identity, indent=2) + "\n")
        normalize_payload_modes(speech)
        normalize_payload_modes(doc)
        control = stage / "DEBIAN/control"
        lines = [line for line in control.read_text().splitlines()
                 if not line.startswith(("Version:", "Installed-Size:"))]
        files = [p for p in sorted(stage.rglob("*")) if p.is_file() and not p.is_symlink()
                 and p.relative_to(stage).parts[0] != "DEBIAN"]
        size = (sum(path.stat().st_size for path in files) + 1023) // 1024
        control.write_text("\n".join(lines) + f"\nVersion: {package_version}\nInstalled-Size: {size}\n")
        (stage / "DEBIAN/md5sums").write_text("".join(
            f"{digest(path, 'md5')}  {path.relative_to(stage)}\n" for path in files))
        temporary_output = Path(directory) / "candidate.deb"
        subprocess.run(["dpkg-deb", "--root-owner-group", "-Zzstd", "-z3", "--build",
                        str(stage), str(temporary_output)], check=True)
        # Publish only a completely built archive; an existing candidate is never replaced.
        os.link(temporary_output, output)
    print(json.dumps({"package": str(output), "version": package_version,
                      "application_version": version, "bytes": output.stat().st_size,
                      "sha256": digest(output)}))


if __name__ == "__main__":
    main()
