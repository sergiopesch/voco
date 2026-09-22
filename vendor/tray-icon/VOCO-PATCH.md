# Immutable Linux tray icons

Upstream: tray-icon 0.24.2 (MIT / Apache-2.0), required by Tauri 2.11.5.
`VOCO-UPSTREAM.json` records the registry archive checksum and source commit.
`UPSTREAM-SHA256.json` records the unmodified crate files. Only `src/lib.rs` and
`src/platform_impl/gtk/mod.rs` change.

The additive Linux `set_icon_path` API selects a caller-owned PNG without deleting
any prior path. VOCO creates four state icons and 64 meter frames in a private
per-process directory and retains them for its lifetime. Delayed AppIndicator readers can still
open any previously advertised filename. No icon cache or unbounded update history
is introduced; the upstream image API and other platforms are unchanged.

VOCO pins Tauri 2.11.5 because it uses `with_inner_tray_icon` to call this method.
The 0.23.1 → 0.24.2 update retains the exact additive Linux patch; its upstream
Linux implementation is unchanged. The dependency gate rejects a second tray
version or a registry copy that would bypass the patch.
The startup/lifetime regression observes real exported icon names and file reads
in isolated GNOME. The public native fallback labels use the existing title API.
