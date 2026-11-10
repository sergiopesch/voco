//! Start at login (AGENTS.md, Product contract): one XDG autostart entry in
//! `$XDG_CONFIG_HOME/autostart`, present only while `startAtLogin` is on and
//! setup is complete. The packages' entry is `~/.config/autostart`; the snap's
//! `XDG_CONFIG_HOME` is its own `$SNAP_USER_DATA/.config`, where snapd's
//! `autostart:` app key looks for it. A source build keeps no entry.
use crate::config::AppConfig;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// VOCO's own entry. It isn't `VOCO.desktop` and lives in an `autostart`
/// folder, so `activation.rs` never counts a login start as a launcher click.
/// The snap's recipe names it in the app's `autostart:` key.
pub const ENTRY_NAME: &str = "voco-login.desktop";

/// The entry. `TryExec` makes the session skip it once the package that
/// provides `voco` is removed. snapd runs the snap's app for it and keeps only
/// the arguments of `Exec`, of which there are none: a login start stays in
/// the tray. `StartupNotify=false` as in the launcher's entry: a tray start
/// shows no window to end a startup sequence.
pub const ENTRY: &str = "[Desktop Entry]
Type=Application
Name=VOCO
Comment=Start VOCO when you sign in
Exec=voco
TryExec=voco
Icon=voco
Terminal=false
NoDisplay=true
StartupNotify=false
X-GNOME-Autostart-enabled=true
";

/// What keeping the entry in step did.
#[derive(Debug, PartialEq, Eq)]
pub enum Change {
    Unchanged,
    Written,
    Removed,
}

/// Whether the entry belongs there: the setting is on and setup is complete.
pub fn wanted(config: &AppConfig) -> bool {
    config.start_at_login && config.onboarding_completed
}

/// Whether this VOCO can start at login: the packages' `/usr/bin/voco`, which
/// `Exec=voco` finds, or the snap, which snapd starts. A source build's entry
/// would start the packaged VOCO, or nothing.
pub fn supported() -> bool {
    supported_for(
        crate::confinement::is_snap(),
        std::env::current_exe().ok().as_deref(),
    )
}

fn supported_for(snap: bool, executable: Option<&Path>) -> bool {
    snap || executable == Some(Path::new(crate::update_install::INSTALLED_APP))
}

/// Whether Settings offers the switch, and setup says VOCO starts at login.
#[tauri::command]
pub fn login_start_available() -> bool {
    supported()
}

/// Brings the entry in step with `config`. It does nothing for a source build,
/// and rewrites nothing that is already right.
pub fn sync(config: &AppConfig) -> Result<Change, String> {
    sync_with(supported(), autostart_directory, config)
}

type Directory = Result<PathBuf, Box<dyn std::error::Error>>;

fn autostart_directory() -> Directory {
    Ok(crate::config::xdg_config_home()?.join("autostart"))
}

fn sync_with(
    supported: bool,
    directory: impl FnOnce() -> Directory,
    config: &AppConfig,
) -> Result<Change, String> {
    if !supported {
        return Ok(Change::Unchanged);
    }
    let wanted = wanted(config);
    let failed = |error: &dyn std::fmt::Display| {
        if wanted {
            format!("VOCO couldn't set itself to start when you sign in: {error}")
        } else {
            format!("VOCO couldn't stop itself from starting when you sign in: {error}")
        }
    };
    let directory = directory().map_err(|error| failed(&error))?;
    sync_at(&directory, wanted).map_err(|error| failed(&error))
}

/// Writes or removes `directory/voco-login.desktop`. Like the settings file,
/// the entry is touched only when it is a regular file this user owns: never
/// through a link, and never another user's file.
fn sync_at(directory: &Path, wanted: bool) -> io::Result<Change> {
    let path = directory.join(ENTRY_NAME);
    let present = match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            own_regular_file(&path, &metadata)?;
            true
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(error),
    };
    match (wanted, present) {
        (false, false) => Ok(Change::Unchanged),
        (false, true) => {
            fs::remove_file(&path)?;
            Ok(Change::Removed)
        }
        (true, true) if fs::read(&path)? == ENTRY.as_bytes() => Ok(Change::Unchanged),
        (true, _) => {
            crate::config::atomic_write(&path, ENTRY)?;
            Ok(Change::Written)
        }
    }
}

fn own_regular_file(path: &Path, metadata: &fs::Metadata) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{} must be a regular file", path.display()),
        ));
    }
    if metadata.uid() != crate::browser_socket::effective_uid() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("{} is not owned by the current user", path.display()),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    fn test_directory(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "voco-login-start-{name}-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    /// The entry's keys, as a desktop entry parser reads them.
    fn keys(entry: &str) -> std::collections::HashMap<&str, &str> {
        entry
            .lines()
            .skip(1)
            .map(|line| line.split_once('=').unwrap())
            .collect()
    }

    #[test]
    fn the_entry_starts_the_installed_voco_and_only_while_it_is_installed() {
        assert_eq!(ENTRY.lines().next(), Some("[Desktop Entry]"));
        let keys = keys(ENTRY);
        assert_eq!(keys["Type"], "Application");
        assert_eq!(keys["Name"], "VOCO");
        // TryExec guards the very program Exec runs, with no arguments.
        assert_eq!(keys["Exec"], "voco");
        assert_eq!(keys["TryExec"], keys["Exec"]);
        assert_eq!(keys["NoDisplay"], "true");
        assert_eq!(keys["StartupNotify"], "false");
        assert_eq!(keys["X-GNOME-Autostart-enabled"], "true");
        // Nothing that hides it from a session or limits it to some desktops.
        for key in [
            "Hidden",
            "OnlyShowIn",
            "NotShowIn",
            "X-GNOME-Autostart-Phase",
        ] {
            assert!(!keys.contains_key(key), "{key}");
        }
    }

    #[test]
    fn only_a_completed_setup_with_the_setting_on_wants_the_entry() {
        for (completed, on, expected) in [
            (true, true, true),
            (true, false, false),
            (false, true, false),
            (false, false, false),
        ] {
            let config = AppConfig {
                onboarding_completed: completed,
                start_at_login: on,
                ..AppConfig::default()
            };
            assert_eq!(wanted(&config), expected, "{completed} {on}");
        }
        // A new config waits for setup.
        assert!(!wanted(&AppConfig::default()));
    }

    #[test]
    fn only_the_packages_and_the_snap_start_at_login() {
        assert!(supported_for(false, Some(Path::new("/usr/bin/voco"))));
        assert!(supported_for(
            true,
            Some(Path::new("/snap/voco/3/usr/bin/voco"))
        ));
        assert!(supported_for(true, None));
        for build in [
            "/home/u/voco/apps/desktop/src-tauri/target/release/voco",
            "/usr/local/bin/voco",
        ] {
            assert!(!supported_for(false, Some(Path::new(build))), "{build}");
        }
        assert!(!supported_for(false, None));
    }

    #[test]
    fn a_source_build_keeps_no_entry() {
        let config = AppConfig {
            onboarding_completed: true,
            ..AppConfig::default()
        };
        let unused = || -> Directory { panic!("looked for the autostart folder") };
        assert_eq!(sync_with(false, unused, &config), Ok(Change::Unchanged));

        let directory = test_directory("installed");
        let found = || -> Directory { Ok(directory.join("autostart")) };
        assert_eq!(sync_with(true, found, &config), Ok(Change::Written));
        let off = AppConfig {
            start_at_login: false,
            ..config
        };
        let found = || -> Directory { Ok(directory.join("autostart")) };
        assert_eq!(sync_with(true, found, &off), Ok(Change::Removed));
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_failure_says_what_it_could_not_do() {
        let directory = test_directory("failure");
        let blocked = directory.join(ENTRY_NAME);
        fs::create_dir_all(&blocked).unwrap();
        let config = AppConfig {
            onboarding_completed: true,
            ..AppConfig::default()
        };
        let found = || -> Directory { Ok(directory.clone()) };
        let error = sync_with(true, found, &config).unwrap_err();
        assert!(error.starts_with("VOCO couldn't set itself to start when you sign in: "));
        assert!(
            error.ends_with("voco-login.desktop must be a regular file"),
            "{error}"
        );
        let off = AppConfig {
            start_at_login: false,
            ..config
        };
        let found = || -> Directory { Ok(directory.clone()) };
        assert!(sync_with(true, found, &off)
            .unwrap_err()
            .starts_with("VOCO couldn't stop itself from starting when you sign in: "));
        assert!(blocked.is_dir());
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn the_entry_is_written_once_and_removed_when_not_wanted() {
        let directory = test_directory("in-step");
        let autostart = directory.join("autostart");
        let path = autostart.join(ENTRY_NAME);
        // Nothing to remove creates nothing.
        assert_eq!(sync_at(&autostart, false).unwrap(), Change::Unchanged);
        assert!(!autostart.exists());

        assert_eq!(sync_at(&autostart, true).unwrap(), Change::Written);
        assert_eq!(fs::read_to_string(&path).unwrap(), ENTRY);
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        // An entry that is already right is left as it is.
        let written = fs::metadata(&path).unwrap();
        assert_eq!(sync_at(&autostart, true).unwrap(), Change::Unchanged);
        let kept = fs::metadata(&path).unwrap();
        assert_eq!(
            (kept.ino(), kept.mtime_nsec()),
            (written.ino(), written.mtime_nsec())
        );
        // An entry an earlier VOCO, or a hand edit, left differently is replaced.
        fs::write(&path, "[Desktop Entry]\nExec=voco --old\n").unwrap();
        assert_eq!(sync_at(&autostart, true).unwrap(), Change::Written);
        assert_eq!(fs::read_to_string(&path).unwrap(), ENTRY);

        // Removing touches only VOCO's own entry.
        let other = autostart.join("VOCO.desktop");
        fs::write(&other, "[Desktop Entry]\n").unwrap();
        assert_eq!(sync_at(&autostart, false).unwrap(), Change::Removed);
        assert!(!path.exists());
        assert!(other.exists());
        assert_eq!(sync_at(&autostart, false).unwrap(), Change::Unchanged);
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_link_at_the_entry_is_never_followed_replaced_or_removed() {
        let directory = test_directory("linked");
        let autostart = directory.join("autostart");
        fs::create_dir_all(&autostart).unwrap();
        let elsewhere = directory.join("elsewhere.desktop");
        fs::write(&elsewhere, "someone else's").unwrap();
        let path = autostart.join(ENTRY_NAME);
        std::os::unix::fs::symlink(&elsewhere, &path).unwrap();

        for wanted in [true, false] {
            let error = sync_at(&autostart, wanted).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidData);
            assert!(fs::symlink_metadata(&path).unwrap().is_symlink());
            assert_eq!(fs::read_to_string(&elsewhere).unwrap(), "someone else's");
        }
        let _ = fs::remove_dir_all(&directory);
    }
}
