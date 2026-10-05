# Vendored dependencies

VOCO patches three Rust crates. Each directory keeps the upstream licenses and a
provenance record, and a script checks it against upstream.

| Directory | Upstream | What VOCO changes | Check |
| --- | --- | --- | --- |
| [glib](glib/VOCO-PATCH.md) | glib 0.18.5 (gtk-rs) | Backports the upstream RUSTSEC-2024-0429 iterator fix | `scripts/verify-glib-backport.py` |
| [global-hotkey](global-hotkey/VOCO-PATCH.md) | global-hotkey 0.8.0 | Replaces the X11 polling loop with an event-driven actor | `scripts/verify-shortcut-backport.py` |
| [tray-icon](tray-icon/VOCO-PATCH.md) | tray-icon 0.24.2 | Adds immutable, caller-owned Linux icon paths | `scripts/verify-tray-backport.py` |

`provenance/` holds the original glib crate archive that its check rebuilds
from. [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) summarizes these
notices. The package installs it, with each directory's licenses and patch
notes, in `/usr/share/doc/voco/`.

Speech recognition uses the pinned [Nemotron runtime](../runtime/native/README.md).
The application compiles in no other recognizer.
