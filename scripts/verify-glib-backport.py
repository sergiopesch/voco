#!/usr/bin/env python3
"""Verify the exact upstream backport and every application's glib resolution."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def verify():
    vendor = ROOT / "vendor/glib"
    provenance = json.loads((vendor / "VOCO-UPSTREAM.json").read_text())
    archive = (vendor / provenance["archive"]).read_bytes()
    assert hashlib.sha256(archive).hexdigest() == provenance["archive_sha256"]
    patch = vendor / "upstream-fix.patch"
    assert hashlib.sha256(patch.read_bytes()).hexdigest() == provenance["fix_patch_sha256"]
    # Reconstruct the allowed result from the pristine archive, not the working copy.
    with tempfile.TemporaryDirectory(prefix="voco-glib-verify-") as temporary:
        base = Path(temporary)
        original = base / "glib"
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            for member in tar.getmembers():
                relative = Path(member.name).relative_to("glib-0.18.5")
                assert ".." not in relative.parts and not relative.is_absolute()
                if member.isdir():
                    continue
                assert member.isfile(), member.name
                path = original / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(tar.extractfile(member).read())
        subprocess.run(["git", "apply", "--no-index", str(patch)], cwd=base, check=True)
        expected = {str(p.relative_to(original)): p.read_bytes()
                    for p in original.rglob("*") if p.is_file()}
        additions = {"VOCO-PATCH.md", "VOCO-UPSTREAM.json", "upstream-fix.patch"}
        actual = {str(p.relative_to(vendor)) for p in vendor.rglob("*") if p.is_file()}
        assert actual == set(expected) | additions, "Unexpected vendor files"
        for relative, content in expected.items():
            path = vendor / relative
            assert not path.is_symlink() and path.read_bytes() == content, relative
    metadata = json.loads(subprocess.check_output([
        "cargo", "metadata", "--locked", "--offline", "--format-version", "1",
        "--manifest-path", str(ROOT / "apps/desktop/src-tauri/Cargo.toml"),
        "--filter-platform", "x86_64-unknown-linux-gnu",
        "--features", "custom-protocol",
    ], text=True))
    packages = [p for p in metadata["packages"] if p["name"] == "glib"]
    assert len(packages) == 1, "Additional glib copy would bypass this patch"
    package = packages[0]
    assert package["version"] == "0.18.5" and package["source"] is None
    assert Path(package["manifest_path"]).resolve() == vendor / "Cargo.toml"
    return {"passed": True, "version": package["version"],
            "sourceFilesVerified": len(expected), "resolvedCopies": len(packages),
            "fixCommit": provenance["fix_commit"]}


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
