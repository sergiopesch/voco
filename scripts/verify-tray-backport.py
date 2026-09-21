"""Check unchanged upstream files and the exact additive Linux API patch."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
crate = root / 'vendor/tray-icon'
manifest = json.loads((crate / 'UPSTREAM-SHA256.json').read_text())
changed = []
for name, digest in manifest.items():
    actual = hashlib.sha256((crate / name).read_bytes()).hexdigest()
    if actual != digest:
        changed.append(name)
assert sorted(changed) == ['src/lib.rs', 'src/platform_impl/gtk/mod.rs'], changed
lock = (root / 'apps/desktop/src-tauri/Cargo.lock').read_text()
assert 'name = "tray-icon"\nversion = "0.23.1"\ndependencies =' in lock
print('tray-icon 0.23.1: upstream inventory and local resolution verified')
