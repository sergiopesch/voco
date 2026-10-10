"""Build a complete, pinned file map. No working-tree edits or private recordings enter it."""

from pathlib import Path
import argparse, hashlib, json, re, subprocess

DEFAULT_COMMIT = "3fca5b8"
GROUPS = [
    # First match wins, so specific prefixes come before the areas that contain them.
    ("apps/desktop/src-tauri/native/", "Native audio bridge", "The C shim that opens one PulseAudio or PipeWire recording stream for native capture."),
    ("apps/desktop/src-tauri/examples/", "Engineering tools", "A Rust fixture program that tests drive, such as the browser broker fixture; not built into the app."),
    ("apps/desktop/src-tauri/icons/", "Product assets", "An application icon bundled for desktop integration."),
    ("apps/desktop/src-tauri/resources/", "Linux helpers", "The packaged IBus shortcut engine and its protocol, the GNOME companion check, and their tests."),
    ("apps/desktop/src-tauri/src/", "Rust backend", "Native application code: operating-system access, validation, delivery and lifecycle."),
    ("apps/desktop/src-tauri/tests/", "Rust backend", "A Rust integration test run by cargo test, such as desktop notifications or the glib iterator fix."),
    ("apps/desktop/src-tauri/capabilities/", "Rust backend", "The Tauri capability file that limits which commands the interface may call."),
    ("apps/desktop/src-tauri/", "Rust backend", "Rust crate setup: Cargo manifest and lock, build script and the Tauri app and package configuration."),
    ("apps/desktop/src/", "Interface and capture", "React interface, recording orchestration, the phrase queue or a supporting module and its tests."),
    ("apps/desktop/public/", "Product assets", "A shipped static interface resource, tray image or the audio worklet."),
    ("apps/desktop/tests/", "Engineering tools", "A browser test page for the brand motion checks."),
    ("apps/desktop/", "Interface and capture", "Frontend build setup: Vite, TypeScript, ESLint and the interface package manifest."),
    ("runtime/speech/", "Speech worker", "The local recognition worker: protocol, streaming, native bridge, model identity and tests."),
    ("runtime/native/", "Speech runtime build", "The pinned native recognizer build recipe and the patches VOCO applies to it."),
    ("runtime/notices/", "Speech runtime build", "Licenses and notices shipped with the speech runtime and model."),
    ("integrations/gnome/", "GNOME companion", "The optional GNOME Shell top-bar companion: meter, menu and Wayland shortcut grab."),
    ("integrations/chromium/", "Browser field route", "The optional Chromium extension that writes into one exact text field."),
    ("scripts/", "Engineering tools", "A build, test, packaging, verification or measurement program."),
    ("tests/", "Test fixtures", "Public test inputs such as speech clips and installer fixtures; no personal recordings."),
    ("docs/guide/", "This guide", "Inside VOCO itself: the local server, site, lesson generator and tests."),
    ("docs/", "Documentation", "Written guidance. When a document and the code disagree, the code wins."),
    ("packaging/", "Linux packages", "Package files: desktop entry, AppStream data, IBus component, the /dev/uinput udev rule, the RPM spec, browser host manifests, install hooks and the published-release record."),
    ("vendor/", "Borrowed libraries", "Upstream code that VOCO patches, with provenance records; not code written for VOCO."),
    (".github/", "GitHub automation", "The CI workflow, issue and pull request templates, and dependency update settings."),
    ("assets/", "Brand identity", "A brand image or its source notes; not application logic."),
    ("install", "Release installer", "The guided installer that downloads a release, checks its signature and checksums, and installs the package."),
    ("KEYS", "Release installer", "The public key that signs release checksums."),
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
