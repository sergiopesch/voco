# Vendored dependencies

VOCO patches three Rust crates and builds one private helper from vendored
source. Each directory keeps the upstream licenses and a provenance record, and
a script checks it against upstream.

| Directory | Upstream | What VOCO changes | Check |
| --- | --- | --- | --- |
| [glib](glib/VOCO-PATCH.md) | glib 0.18.5 (gtk-rs) | Backports the upstream RUSTSEC-2024-0429 iterator fix | `scripts/verify-glib-backport.py` |
| [global-hotkey](global-hotkey/VOCO-PATCH.md) | global-hotkey 0.8.0 | Replaces the X11 polling loop with an event-driven actor | `scripts/verify-shortcut-backport.py` |
| [tray-icon](tray-icon/VOCO-PATCH.md) | tray-icon 0.24.2 | Adds immutable, caller-owned Linux icon paths | `scripts/verify-tray-backport.py` |
| [ydotool-legacy](ydotool-legacy/README.md) | ydotool 0.1.8 and libuInputPlus 0.1.4 | Builds a private `ydotoold` for Ubuntu 24.04's `ydotool` client, with socket lifecycle fixes | `scripts/build-legacy-ydotool.py --verify-only` |

`provenance/` holds the original glib crate archive that its check rebuilds
from. [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) summarizes these
notices. The package installs it, with each directory's licenses and patch
notes, in `/usr/share/doc/voco/`.

Speech recognition uses the pinned [Nemotron runtime](../runtime/native/README.md).
The application compiles in no other recognizer.
