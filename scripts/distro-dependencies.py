#!/usr/bin/env python3
"""Print the system packages VOCO's package depends on, by one distribution's
names: Debian and Ubuntu from tauri.conf.json plus the packages Tauri adds
itself, Fedora from their mapping in rpm_package.py. CI installs exactly these,
so a renamed or missing package fails before a release does."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import rpm_package  # noqa: E402


def debian_dependencies():
    deb = json.loads((ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text())["bundle"]["linux"]["deb"]
    return [*deb["depends"], *rpm_package.TAURI_IMPLIED_DEPENDS]


def names(dependencies):
    # "libc6 (>= 2.39)" and "glibc >= 2.39" install by name; the floors are
    # the package's business, checked by the package verifiers.
    return [dependency.split()[0] for dependency in dependencies]


if __name__ == "__main__":
    if sys.argv[1:] == ["debian"]:
        print(" ".join(names(debian_dependencies())))
    elif sys.argv[1:] == ["fedora"]:
        print(" ".join(names(rpm_package.FEDORA_REQUIRES)))
    else:
        sys.exit("Usage: distro-dependencies.py debian|fedora")
