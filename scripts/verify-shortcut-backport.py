"""Check vendor provenance and prevent a second, unpatched shortcut actor."""
import hashlib
import json
from pathlib import Path
import tomllib

root = Path(__file__).resolve().parents[1]
crate = root / 'vendor/global-hotkey'
provenance = json.loads((crate / 'VOCO-UPSTREAM.json').read_text())
modified = []
for name, expected in provenance['upstream_files_sha256'].items():
    path = crate / name
    if name.startswith(('.github/', '.changes/')) or name == 'renovate.json':
        continue
    assert path.is_file(), f'Missing upstream file: {name}'
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        modified.append(name)
assert sorted(modified) == [
    'Cargo.toml', 'src/lib.rs', 'src/platform_impl/mod.rs', 'src/platform_impl/x11/mod.rs'
], modified
manifest = tomllib.loads((crate / 'Cargo.toml').read_text())
assert manifest['package']['version'] == provenance['version']
lock = tomllib.loads((root / 'apps/desktop/src-tauri/Cargo.lock').read_text())
actors = [p for p in lock['package'] if p['name'] == 'global-hotkey']
assert len(actors) == 1, f'Expected one shared shortcut actor, found {actors}'
assert actors[0]['version'] == provenance['version'] and 'source' not in actors[0], actors
for consumer in ('voco', 'tauri-plugin-global-shortcut'):
    package = next(p for p in lock['package'] if p['name'] == consumer)
    assert 'global-hotkey' in package['dependencies'], consumer
print(f"global-hotkey {provenance['version']}: upstream inventory and shared patched actor verified")
