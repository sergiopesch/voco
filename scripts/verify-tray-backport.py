"""Check tray provenance and require Tauri to use the patched Linux icon API."""
import hashlib
import json
from pathlib import Path
import tomllib

root = Path(__file__).resolve().parents[1]
crate = root / 'vendor/tray-icon'
manifest = json.loads((crate / 'UPSTREAM-SHA256.json').read_text())
provenance = json.loads((crate / 'VOCO-UPSTREAM.json').read_text())
package = tomllib.loads((crate / 'Cargo.toml').read_text())['package']
assert package['name'] == provenance['crate'] == 'tray-icon'
assert package['version'] == provenance['version'] == '0.24.2'
changed = []
for name, digest in manifest.items():
    actual = hashlib.sha256((crate / name).read_bytes()).hexdigest()
    if actual != digest:
        changed.append(name)
assert sorted(changed) == ['src/lib.rs', 'src/platform_impl/gtk/mod.rs'], changed
lock = tomllib.loads((root / 'apps/desktop/src-tauri/Cargo.lock').read_text())
trays = [p for p in lock['package'] if p['name'] == 'tray-icon']
assert len(trays) == 1, f'Expected one patched tray library, found {trays}'
assert trays[0]['version'] == provenance['version'] and 'source' not in trays[0], trays
tauri = next(p for p in lock['package'] if p['name'] == 'tauri')
assert 'tray-icon' in tauri['dependencies'], 'Tauri must consume the patched tray library'
print(f"tray-icon {provenance['version']}: upstream inventory and Tauri patch resolution verified")
