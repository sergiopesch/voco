# Immutable Linux tray icons

Upstream: tray-icon 0.25.1 (MIT / Apache-2.0), selected by the pinned Tauri
dependency in `apps/desktop/src-tauri/Cargo.toml` and `Cargo.lock`.
`VOCO-UPSTREAM.json` records the registry archive checksum and source commit.
`UPSTREAM-SHA256.json` records the unmodified crate files. Only `src/lib.rs` and
`src/platform_impl/gtk/mod.rs` change.

The additive Linux `set_icon_path` API selects a caller-owned PNG without deleting
any prior path. VOCO creates three state icons and 64 meter frames in a private
per-process directory and retains them for its lifetime. Delayed AppIndicator readers can still
open any previously advertised filename. No icon cache or unbounded update history
is introduced; the upstream image API and other platforms are unchanged.

VOCO uses Tauri's `with_inner_tray_icon` to call this method. The rest of the
upstream Linux implementation is unchanged. Tauri enables the AppIndicator backend
(`libappindicator`), the only one with this method; the optional KSNI backend is
not compiled. `scripts/verify-tray-backport.py`
rejects a second tray-icon version or a registry copy that would bypass the patch.
An isolated GNOME regression watches the exported icon names and file reads from
startup onwards. The fallback tray's labels use the existing title API.
