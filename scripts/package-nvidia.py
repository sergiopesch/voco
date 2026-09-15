#!/usr/bin/env python3
"""Assemble a complete local NVIDIA Debian candidate from a Tauri base package."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
VENDORED_NOTICES = {
    "global-hotkey": ("VOCO-PATCH.md", "VOCO-UPSTREAM.json", "LICENSE-APACHE", "LICENSE-MIT", "LICENSE.spdx"),
    "glib": ("VOCO-PATCH.md", "VOCO-UPSTREAM.json", "upstream-fix.patch", "LICENSE", "COPYRIGHT"),
}
SPEECH_FILES = (
    "stream_worker.py", "worker_main.py", "streaming.py", "adapters.py",
    "MODEL-IDENTITY.json", "BUILD-IDENTITY.json", "voco-cpu-check", "libbench_nemo_pool.so",
    "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf",
    "lib/libggml-base.so.0.12.0", "lib/libggml-cpu.so.0.12.0",
    "lib/libggml.so.0.12.0", "lib/libnemo_speech_asr.so", "lib/libnemo_speech_asr_c.so.1",
)
SPEECH_LINKS = {f"lib/lib{name}.so.0": f"lib{name}.so.0.12.0"
                for name in ("ggml-base", "ggml-cpu", "ggml")}
SPEECH_LINKS.update({f"lib/lib{name}.so": f"lib{name}.so.0"
                     for name in ("ggml-base", "ggml-cpu", "ggml")})
SPEECH_LINKS["lib/libnemo_speech_asr_c.so"] = "libnemo_speech_asr_c.so.1"
NVIDIA_NOTICES = (
    "GGML-LICENSE", "LICENSE", "NOTICE", "NVIDIA-MODEL-CARD.md",
    "NVIDIA-NOTICE.txt", "NVIDIA-OPEN-MODEL-LICENSE.html", "THIRD_PARTY_NOTICES.md",
)


def relative_parts(name):
    """Manifest entries use canonical relative POSIX paths, never traversal."""
    if not isinstance(name, str):
        raise ValueError("Invalid public payload path")
    path = PurePosixPath(name)
    if (not path.parts or path.is_absolute() or ".." in path.parts
            or str(path) != name or "\\" in name):
        raise ValueError("Invalid public payload path")
    return path.parts


def source_file(source_root, name, link_target=None):
    parts = relative_parts(name)
    path = source_root
    if path.is_symlink() or not path.is_dir():
        raise ValueError("Public payload source must be a real directory")
    for index, part in enumerate(parts):
        path = path / part
        try:
            mode = path.lstat().st_mode
        except OSError as error:
            raise ValueError(f"Missing public payload source: {name}") from error
        if index < len(parts) - 1:
            if not stat.S_ISDIR(mode):
                raise ValueError(f"Public payload parent must be a real directory: {name}")
        elif link_target is not None:
            if not stat.S_ISLNK(mode) or os.readlink(path) != link_target:
                raise ValueError(f"Unexpected runtime link: {name}")
        elif not stat.S_ISREG(mode):
            raise ValueError(f"Public payload source must be a regular file: {name}")
    return path


def copy_public_files(source_root, destination, entries):
    """Copy only enumerated regular files; validate all sources before writing."""
    sources = [(source_file(source_root, source), relative_parts(target))
               for source, target in entries.items()]
    destination.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink() or not destination.is_dir():
        raise ValueError("Public payload destination must be a real directory")
    for source, parts in sources:
        parent = destination
        for part in parts[:-1]:
            parent = parent / part
            parent.mkdir(exist_ok=True)
            if parent.is_symlink() or not parent.is_dir():
                raise ValueError("Public payload destination parent must be a real directory")
        target = parent / parts[-1]
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise ValueError("Public payload destination must be a regular file")
        shutil.copy2(source, target)


def copy_public_documents(source_root, doc):
    manifest = source_file(source_root, "packaging/public-docs.json")
    names = json.loads(manifest.read_text())
    if (not isinstance(names, list) or not names
            or any(not isinstance(name, str) for name in names)
            or len(names) != len(set(names))):
        raise ValueError("Invalid public documentation manifest")
    if any(relative_parts(name)[0] != "docs" for name in names):
        raise ValueError("Public documentation manifest must name docs files")
    entries = {name: name for name in names}
    entries.update({name: name for name in ("README.md", "AGENTS.md", "SECURITY.md")})
    entries.update({f"scripts/{name}": name for name in
                    ("report-performance.py", "report-speech-performance.py")})
    copy_public_files(source_root, doc, entries)


def copy_speech_payload(source_root, speech):
    # Validate the exact loader aliases, then recreate them without following
    # checkout symlinks. Every terminal library target is copied as a regular file.
    for name, target in SPEECH_LINKS.items():
        source_file(source_root, f"runtime/speech/{name}", link_target=target)
    copy_public_files(source_root, speech,
                      {f"runtime/speech/{name}": name for name in SPEECH_FILES})
    for name, target in SPEECH_LINKS.items():
        (speech / name).symlink_to(target)


def copy_nvidia_notices(source_root, doc):
    copy_public_files(source_root, doc / "nvidia",
                      {f"runtime/notices/{name}": name for name in NVIDIA_NOTICES})


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


def copy_vendored_notices(source_root, doc):
    """Ship patched dependencies' licenses and provenance, preserving doc links."""
    for crate, names in VENDORED_NOTICES.items():
        for name in names:
            try:
                source_file(source_root, f"vendor/{crate}/{name}")
            except ValueError as error:
                raise ValueError(f"Missing regular vendored notice: {crate}/{name}") from error
    copy_public_files(source_root, doc, {
        f"vendor/{crate}/{name}": f"vendor/{crate}/{name}"
        for crate, names in VENDORED_NOTICES.items() for name in names
    })


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
        subprocess.run(["python3", str(ROOT / "scripts/verify-glib-backport.py")], check=True)
        speech = stage / "usr/lib/voco/speech"
        copy_speech_payload(ROOT, speech)
        model = speech / "models/nemotron-speech-streaming-en-0.6b.q8_0.gguf"
        expected = json.loads((speech / "MODEL-IDENTITY.json").read_text())["model_sha256"]
        if digest(model) != expected:
            raise ValueError("Packaged model does not match pinned MODEL-IDENTITY.json")
        doc = stage / "usr/share/doc/voco"
        copy_nvidia_notices(ROOT, doc)
        copy_public_documents(ROOT, doc)
        copy_vendored_notices(ROOT, doc)
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
