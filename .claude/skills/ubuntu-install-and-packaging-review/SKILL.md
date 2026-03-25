# Ubuntu Install and Packaging Review

## When to use
Invoke when changes touch `scripts/setup.sh`, Tauri build config (`tauri.conf.json`), packaging targets, desktop entries, or install/uninstall flows.

## What to review

### Setup script
- Does `./scripts/setup.sh` work on a clean Ubuntu system?
- Does `./scripts/setup.sh --install` build and install the .deb successfully?
- Are all system dependencies listed and installed correctly?
- Does the script handle missing prerequisites gracefully (clear error messages)?
- Are there any hardcoded paths that assume a specific user or directory?

### .deb packaging
- Does the .deb package install cleanly via `dpkg -i`?
- Is the desktop entry correct (name, icon, exec path, categories)?
- Does the app appear in the Ubuntu application launcher after install?
- Are file permissions correct in the installed package?
- Is the binary placed in a standard location?

### Tauri build config
- Is `tauri.conf.json` correctly configured for Linux targets?
- Are bundle identifiers, version, and metadata correct?
- Are Linux-specific Tauri features (tray icon, shell, global shortcut) properly declared?

### First-run experience
- Does the app launch correctly from the desktop entry?
- Is model download behaviour clearly communicated to the user?
- Does the app handle XDG directories correctly on first run?

### Uninstall
- Can the package be cleanly removed via `dpkg -r` or `apt remove`?
- Are config/data files in XDG directories left for the user to clean up (standard behaviour)?

### Distribution compatibility
- Would the setup script likely work on Debian-derived systems beyond Ubuntu?
- Are there Ubuntu-specific assumptions that should be documented?

## Output format
| Area | Severity | Issue | File:line | Recommendation |
|------|----------|-------|-----------|----------------|
