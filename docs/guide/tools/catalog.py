"""Build a complete, pinned file map. No working-tree edits or private recordings enter it."""

from pathlib import Path
import argparse, hashlib, json, re, subprocess

DEFAULT_COMMIT = "0bf733022d5ffbb2783ab86ff30d533f3fbae6ef"
GROUPS = [
    ("apps/desktop/src-tauri/native/", "Native audio bridge", "C code connecting native microphone capture to the Rust boundary."),
    ("apps/desktop/src-tauri/examples/", "Replay and research tools", "An executable replay, fixture or measurement example; not the ordinary app entry point."),
    ("apps/desktop/src-tauri/icons/", "Product assets", "An application icon bundled for desktop integration."),
    (
        "vendor/",
        "Borrowed libraries",
        "Upstream library code. VOCO carries specific patches; this is not all code written for VOCO.",
    ),
    (
        "apps/desktop/src-tauri/resources/",
        "Linux helpers",
        "A packaged Linux integration helper or its tests.",
    ),
    (
        "apps/desktop/src-tauri/src/",
        "Rust backend",
        "Native application code: operating-system authority, validation or lifecycle.",
    ),
    (
        "apps/desktop/src/",
        "Interface and capture",
        "Frontend interface, recording orchestration or a supporting module.",
    ),
    (
        "apps/desktop/public/",
        "Product assets",
        "A shipped static interface resource or audio worklet.",
    ),
    (
        "runtime/speech/",
        "Speech worker",
        "Local recognition runtime, protocol, streaming or tests.",
    ),
    (
        "runtime/",
        "Runtime packaging",
        "Pinned runtime configuration, notices or provisioning.",
    ),
    (
        "integrations/",
        "Optional browser route",
        "Explicit Chromium integration; separate from normal desktop paste.",
    ),
    (
        "scripts/",
        "Engineering tools",
        "A build, test, benchmark, verification or maintenance program.",
    ),
    (
        "tests/",
        "Test fixtures",
        "A public test input or expectation; not private personal recordings.",
    ),
    (
        "docs/",
        "Documentation",
        "Written guidance. Current implementation wins when a dated document disagrees.",
    ),
    (
        "packaging/",
        "Linux packages",
        "Installation, desktop integration or package-channel metadata.",
    ),
    (
        ".github/",
        "GitHub automation",
        "Repository automation and CI/release workflows.",
    ),
    (
        "assets/",
        "Brand identity",
        "A retained brand asset or source; not recognition code.",
    ),
]


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args])


def build(repo, commit):
    commit = git(repo, "rev-parse", commit + "^{commit}").decode().strip()
    version = json.loads(git(repo, "show", commit + ":package.json"))["version"]
    entries = []
    raw = git(repo, "ls-tree", "-r", "-l", "-z", commit)
    for item in raw.split(b"\0"):
        if not item:
            continue
        meta, path = item.split(b"\t", 1)
        mode, kind, blob, size = meta.decode().split()
        path = path.decode()
        group, why = (
            "Project configuration",
            "Repository entry point, dependency lock, policy or project metadata.",
        )
        for prefix, g, w in GROUPS:
            if path.startswith(prefix):
                group, why = g, w
                break
        textual = (
            True  # Decode small Git blobs directly; do not hide source by extension.
        )
        text = ""
        symbols = []
        if textual and int(size) < 2_000_000:
            data = git(repo, "cat-file", "blob", blob)
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                textual = False
            if "\0" in text:
                textual = False
                text = ""
            for number, line in enumerate(text.splitlines(), 1):
                m = re.match(
                    r"\s*(?:(?:export|pub(?:\([^)]*\))?|async|default|unsafe)\s+)*(?:fn|function|class|def|struct|enum|trait|interface|type)\s+(\w+)",
                    line,
                )
                if m:
                    symbols.append({"name": m[1], "line": number})
        test = bool(
            re.search(r"(?:^|/)(?:test[_-]|tests/)|\.test\.|_test\.|/test_", path)
        )
        entries.append(
            {
                "path": path,
                "group": group,
                "role": why,
                "bytes": int(size),
                "blob": blob,
                "mode": mode,
                "kind": kind,
                "text": textual and int(size) < 2_000_000,
                "lines": len(text.splitlines()) if text else None,
                "symbols": symbols,
                "test": test,
            }
        )
    return {
        "commit": commit,
        "version": version,
        "fileCount": len(entries),
        "scope": "Every tracked entry at the pinned commit. Binary files are catalogued; text files up to 2 MB are readable through the local server. Group roles are navigation aids, not hand-written reviews of every file.",
        "files": entries,
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True, type=Path)
    p.add_argument("--commit", default=DEFAULT_COMMIT)
    p.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "site/catalog.json",
    )
    a = p.parse_args()
    d = build(a.repo, a.commit)
    a.output.write_text(json.dumps(d, separators=(",", ":")) + "\n")
    print(f"Indexed {d['fileCount']} tracked files at {d['commit']}")
