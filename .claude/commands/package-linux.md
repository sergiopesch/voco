# Package for Linux

Evaluate and improve Linux desktop packaging.

## Steps
1. Assess current packaging state:
   - Does `./scripts/setup.sh --install` produce a working .deb?
   - Is the desktop entry correct?
   - Does the app appear in the Ubuntu launcher?
2. Review `tauri.conf.json` for:
   - Bundle identifiers and metadata
   - Linux-specific Tauri features (tray, shell, global shortcut)
   - Package targets (.deb, AppImage)
3. Check install/uninstall flow:
   - Clean install on Ubuntu
   - Binary location and permissions
   - XDG directory creation on first run
4. Identify packaging gaps:
   - Missing dependencies in the .deb control file
   - AppImage build status
   - Desktop entry icon and categories
5. Recommend improvements with specific file changes
