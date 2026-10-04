use log::warn;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const APP_DIR_NAME: &str = "voco";
pub const LEGACY_APP_DIR_NAME: &str = "voice";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    #[serde(default)]
    pub selected_mic: Option<String>,
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default)]
    pub update_channel: UpdateChannel,
    #[serde(default)]
    pub install_channel: InstallChannel,
}

/// A field-level configuration update sent by the frontend.
///
/// `PatchField` distinguishes an omitted key from a present value. Nullable
/// fields use `PatchField<Option<T>>`, so an explicit JSON `null` clears them.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppConfigPatch {
    #[serde(default)]
    pub hotkey: PatchField<String>,
    #[serde(default)]
    pub selected_mic: PatchField<Option<String>>,
    #[serde(default)]
    pub onboarding_completed: PatchField<bool>,
    #[serde(default)]
    pub update_channel: PatchField<UpdateChannel>,
    #[serde(default)]
    pub install_channel: PatchField<InstallChannel>,
}

#[derive(Debug, Clone, Default)]
pub enum PatchField<T> {
    #[default]
    Unchanged,
    Set(T),
}

impl<'de, T> Deserialize<'de> for PatchField<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        T::deserialize(deserializer).map(Self::Set)
    }
}

impl AppConfigPatch {
    pub fn with_hotkey(hotkey: String) -> Self {
        Self {
            hotkey: PatchField::Set(hotkey),
            ..Self::default()
        }
    }

    pub fn apply_to(self, config: &mut AppConfig) {
        if let PatchField::Set(value) = self.hotkey {
            config.hotkey = value;
        }
        if let PatchField::Set(value) = self.selected_mic {
            config.selected_mic = value;
        }
        if let PatchField::Set(value) = self.onboarding_completed {
            config.onboarding_completed = value;
        }
        if let PatchField::Set(value) = self.update_channel {
            config.update_channel = value;
        }
        if let PatchField::Set(value) = self.install_channel {
            config.install_channel = value;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedUpdateCheck {
    pub channel: UpdateChannel,
    pub state: UpdateCheckState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckState {
    pub status: UpdateCheckStatus,
    pub current_version: Option<String>,
    pub latest_release: Option<ReleaseInfo>,
    pub last_checked_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub version: String,
    pub name: String,
    pub url: String,
    pub published_at: Option<String>,
    pub prerelease: bool,
}

fn default_hotkey() -> String {
    "Alt+D".to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Beta,
}

/// Only chooses which update instructions Settings shows. VOCO no longer
/// publishes AppImage, Flatpak or Snap builds, so those read as GitHub Release.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstallChannel {
    #[default]
    #[serde(alias = "appimage", alias = "flatpak", alias = "snap")]
    GithubRelease,
    Source,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateCheckStatus {
    #[default]
    Idle,
    Checking,
    UpToDate,
    Available,
    Error,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey(),
            selected_mic: None,
            onboarding_completed: false,
            update_channel: UpdateChannel::default(),
            install_channel: InstallChannel::default(),
        }
    }
}

impl AppConfig {
    /// The private settings directory, without copying a legacy `voice` config
    /// into it. The recovery panel's Open and Reset use it, and so does the update
    /// cache, which is read and written without the config lock.
    pub fn config_dir_without_migration() -> Result<PathBuf, Box<dyn std::error::Error>> {
        let base_dir =
            dirs::config_dir().ok_or("Cannot find config directory (XDG_CONFIG_HOME)")?;
        let config_dir = base_dir.join(APP_DIR_NAME);
        fs::create_dir_all(&config_dir)?;
        secure_private_directory(&config_dir)?;
        Ok(config_dir)
    }

    pub fn config_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
        let base_dir =
            dirs::config_dir().ok_or("Cannot find config directory (XDG_CONFIG_HOME)")?;
        let config_dir = Self::config_dir_without_migration()?;
        migrate_legacy_config(&base_dir, &config_dir)?;
        Ok(config_dir)
    }

    pub fn config_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
        Ok(Self::config_dir()?.join("config.json"))
    }

    pub fn update_cache_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
        Ok(Self::config_dir_without_migration()?.join("update-cache.json"))
    }

    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let path = Self::config_path()?;
        if path.exists() {
            secure_private_regular_file(&path)?;
            let content = fs::read_to_string(&path)?;
            let config: Self = serde_json::from_str(&content)?;
            // Retired settings are ignored on read and dropped by this save;
            // the microphone, shortcut and other current settings are kept.
            if serde_json::to_value(&config)?
                != serde_json::from_str::<serde_json::Value>(&content)?
            {
                if let Err(error) = config.save() {
                    warn!(
                        "Loaded VOCO settings, but could not save them in the current format: {error}"
                    );
                }
            }
            Ok(config)
        } else {
            let config = Self::default();
            config.save()?;
            Ok(config)
        }
    }

    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let path = Self::config_path()?;
        let content = serde_json::to_string_pretty(self)?;
        atomic_write(&path, &content)?;
        Ok(())
    }

    pub fn reset_to_defaults() -> Result<Self, Box<dyn std::error::Error>> {
        let path = Self::config_dir_without_migration()?.join("config.json");
        reset_config_file(&path)
    }
}

fn reset_config_file(path: &std::path::Path) -> Result<AppConfig, Box<dyn std::error::Error>> {
    let existing = match fs::symlink_metadata(path) {
        Ok(_) => {
            let suffix = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let backup = path.with_file_name(format!(
                "config.recovery-backup-{}-{suffix}.json",
                std::process::id()
            ));
            fs::rename(path, &backup)?;
            Some(backup)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };

    let config = AppConfig::default();
    let content = serde_json::to_string_pretty(&config)?;
    if let Err(error) = atomic_write(path, &content) {
        if let Some(backup) = existing.as_ref() {
            if let Err(restore_error) = fs::rename(backup, path) {
                return Err(format!(
                    "Could not write default settings ({error}) or restore the previous settings ({restore_error})"
                )
                .into());
            }
        }
        return Err(error.into());
    }

    if let Some(backup) = existing {
        warn!(
            "Reset VOCO settings to defaults; preserved the previous entry at {}",
            backup.display()
        );
    }
    Ok(config)
}

pub fn load_cached_update_check() -> Result<Option<CachedUpdateCheck>, Box<dyn std::error::Error>> {
    let path = AppConfig::update_cache_path()?;
    if !path.exists() {
        return Ok(None);
    }

    secure_private_regular_file(&path)?;
    let content = fs::read_to_string(path)?;
    Ok(Some(serde_json::from_str(&content)?))
}

pub fn save_cached_update_check(
    cache: &CachedUpdateCheck,
) -> Result<(), Box<dyn std::error::Error>> {
    let path = AppConfig::update_cache_path()?;
    let content = serde_json::to_string_pretty(cache)?;
    atomic_write(&path, &content)?;
    Ok(())
}

fn atomic_write(path: &std::path::Path, content: &str) -> Result<(), std::io::Error> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("Path has no parent: {}", path.display()),
        )
    })?;
    fs::create_dir_all(parent)?;

    let file_name = path.file_name().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("Path has no file name: {}", path.display()),
        )
    })?;
    let unique_suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp_path = parent.join(format!(
        ".{}.tmp-{}-{}",
        file_name.to_string_lossy(),
        std::process::id(),
        unique_suffix
    ));

    let write_result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp_path)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        Ok::<(), std::io::Error>(())
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&tmp_path);
        return Err(error);
    }

    fs::rename(&tmp_path, path)?;

    if let Ok(dir) = fs::File::open(parent) {
        let _ = dir.sync_all();
    }

    Ok(())
}

fn secure_private_directory(path: &std::path::Path) -> Result<(), std::io::Error> {
    secure_private_entry(path, true)
}

fn secure_private_regular_file(path: &std::path::Path) -> Result<(), std::io::Error> {
    secure_private_entry(path, false)
}

/// Accepts only a directory or regular file that this user owns; lstat reports a
/// symbolic link as neither.
fn secure_private_entry(path: &std::path::Path, directory: bool) -> Result<(), std::io::Error> {
    let metadata = fs::symlink_metadata(path)?;
    let (expected_type, kind, private_mode) = if directory {
        (metadata.is_dir(), "a real directory", 0o700)
    } else {
        (metadata.is_file(), "a regular file", 0o600)
    };
    if !expected_type {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} must be {kind}", path.display()),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.uid() != crate::browser_socket::effective_uid() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!("{} is not owned by the current user", path.display()),
            ));
        }
        // Settings load every second while a window is open, so change the mode
        // only when it is wrong. All 12 bits count: chmod also clears setuid,
        // setgid and sticky.
        if metadata.mode() & 0o7777 == private_mode {
            return Ok(());
        }
        fs::set_permissions(path, fs::Permissions::from_mode(private_mode))?;
        let secured = fs::symlink_metadata(path)?;
        if secured.uid() != crate::browser_socket::effective_uid()
            || secured.mode() & 0o777 != private_mode
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!(
                    "{} could not be secured to mode {private_mode:04o}",
                    path.display()
                ),
            ));
        }
    }
    Ok(())
}

fn migrate_legacy_config(
    base_dir: &std::path::Path,
    new_config_dir: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let old_config_path = base_dir.join(LEGACY_APP_DIR_NAME).join("config.json");
    let new_config_path = new_config_dir.join("config.json");

    if fs::symlink_metadata(&new_config_path).is_ok() || !old_config_path.exists() {
        return Ok(());
    }

    secure_private_regular_file(&old_config_path)?;
    fs::copy(&old_config_path, &new_config_path)?;
    secure_private_regular_file(&new_config_path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_patch_rejects_unknown_fields_and_null_non_nullable_values() {
        assert!(serde_json::from_str::<AppConfigPatch>(r#"{"unknown":true}"#).is_err());
        assert!(serde_json::from_str::<AppConfigPatch>(r#"{"hotkey":null}"#).is_err());
    }

    #[test]
    fn update_channel_serializes_kebab_case() {
        let json = serde_json::to_string(&UpdateChannel::Stable).unwrap();
        assert_eq!(json, r#""stable""#);
    }

    #[test]
    fn install_channel_reads_retired_package_formats_as_github_release() {
        assert_eq!(
            serde_json::to_string(&InstallChannel::GithubRelease).unwrap(),
            r#""github-release""#
        );
        for retired in ["appimage", "flatpak", "snap"] {
            let channel: InstallChannel =
                serde_json::from_value(serde_json::json!(retired)).unwrap();
            assert!(matches!(channel, InstallChannel::GithubRelease));
        }
        let source: InstallChannel = serde_json::from_str(r#""source""#).unwrap();
        assert!(matches!(source, InstallChannel::Source));
    }

    #[test]
    fn update_check_status_serializes_kebab_case() {
        let json = serde_json::to_string(&UpdateCheckStatus::UpToDate).unwrap();
        assert_eq!(json, r#""up-to-date""#);
    }

    #[test]
    fn cached_update_check_round_trips() {
        let cache = CachedUpdateCheck {
            channel: UpdateChannel::Beta,
            state: UpdateCheckState {
                status: UpdateCheckStatus::Available,
                current_version: Some("2026.0.6".to_string()),
                latest_release: Some(ReleaseInfo {
                    version: "2026.0.7-beta.1".to_string(),
                    name: "VOCO 2026.0.7 beta 1".to_string(),
                    url: "https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.7-beta.1"
                        .to_string(),
                    published_at: Some("2026-04-02T10:00:00Z".to_string()),
                    prerelease: true,
                }),
                last_checked_at: Some("2026-04-02T10:05:00Z".to_string()),
                error: None,
            },
        };

        let json = serde_json::to_string(&cache).unwrap();
        let parsed: CachedUpdateCheck = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed.channel, UpdateChannel::Beta));
        assert!(matches!(parsed.state.status, UpdateCheckStatus::Available));
        assert_eq!(
            parsed
                .state
                .latest_release
                .as_ref()
                .map(|release| release.version.as_str()),
            Some("2026.0.7-beta.1")
        );
    }

    #[test]
    fn atomic_write_replaces_existing_file_contents() {
        let test_dir = std::env::temp_dir().join(format!(
            "voco-config-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&test_dir).unwrap();
        let path = test_dir.join("config.json");
        fs::write(&path, "old").unwrap();

        atomic_write(&path, "{\"new\":true}").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"new\":true}");

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn reset_config_preserves_invalid_entry_and_writes_private_defaults() {
        let test_dir = std::env::temp_dir().join(format!(
            "voco-config-recovery-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&test_dir).unwrap();
        let path = test_dir.join("config.json");
        fs::write(&path, "{not valid json").unwrap();

        let recovered = reset_config_file(&path).unwrap();

        assert_eq!(recovered.hotkey, "Alt+D");
        let persisted: AppConfig =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(persisted.hotkey, "Alt+D");
        let backups = fs::read_dir(&test_dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("config.recovery-backup-")
            })
            .collect::<Vec<_>>();
        assert_eq!(backups.len(), 1);
        assert_eq!(
            fs::read_to_string(backups[0].path()).unwrap(),
            "{not valid json"
        );

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_persisted_settings_private() {
        use std::os::unix::fs::PermissionsExt;

        let test_dir = std::env::temp_dir().join(format!(
            "voco-config-mode-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&test_dir).unwrap();
        let path = test_dir.join("config.json");

        atomic_write(&path, "{\"private\":true}").unwrap();

        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let _ = fs::remove_dir_all(&test_dir);
    }

    #[cfg(unix)]
    #[test]
    fn existing_settings_paths_are_normalized_and_symlinks_are_rejected() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let test_root = std::env::temp_dir().join(format!(
            "voco-config-security-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let directory = test_root.join("voco");
        fs::create_dir_all(&directory).unwrap();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o775)).unwrap();
        secure_private_directory(&directory).unwrap();
        assert_eq!(
            fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );

        let config_path = directory.join("config.json");
        fs::write(&config_path, "{}").unwrap();
        fs::set_permissions(&config_path, fs::Permissions::from_mode(0o664)).unwrap();
        secure_private_regular_file(&config_path).unwrap();
        assert_eq!(
            fs::metadata(&config_path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        let linked_path = directory.join("linked.json");
        symlink(&config_path, &linked_path).unwrap();
        assert!(secure_private_regular_file(&linked_path).is_err());

        // A link to a private directory is still a link, never the settings folder.
        let linked_directory = test_root.join("linked-voco");
        symlink(&directory, &linked_directory).unwrap();
        assert!(secure_private_directory(&linked_directory).is_err());

        let _ = fs::remove_dir_all(test_root);
    }

    #[cfg(unix)]
    #[test]
    fn settings_paths_of_another_type_are_rejected_and_private_ones_are_left_alone() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let test_root = std::env::temp_dir().join(format!(
            "voco-config-private-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let directory = test_root.join("voco");
        fs::create_dir_all(&directory).unwrap();
        let config_path = directory.join("config.json");
        fs::write(&config_path, "{}").unwrap();
        let socket_path = directory.join("config.sock");
        let _socket = std::os::unix::net::UnixListener::bind(&socket_path).unwrap();

        // The recovery panel shows these messages.
        assert_eq!(
            secure_private_directory(&config_path)
                .unwrap_err()
                .to_string(),
            format!("{} must be a real directory", config_path.display())
        );
        assert_eq!(
            secure_private_regular_file(&directory)
                .unwrap_err()
                .to_string(),
            format!("{} must be a regular file", directory.display())
        );
        assert!(secure_private_directory(&socket_path).is_err());
        assert!(secure_private_regular_file(&socket_path).is_err());

        fs::set_permissions(&directory, fs::Permissions::from_mode(0o1700)).unwrap();
        fs::set_permissions(&config_path, fs::Permissions::from_mode(0o4600)).unwrap();
        secure_private_directory(&directory).unwrap();
        secure_private_regular_file(&config_path).unwrap();
        assert_eq!(fs::metadata(&directory).unwrap().mode() & 0o7777, 0o700);
        assert_eq!(fs::metadata(&config_path).unwrap().mode() & 0o7777, 0o600);

        // A chmod, even to the same mode, would move the inode change time.
        let changed = |path: &std::path::Path| {
            let metadata = fs::metadata(path).unwrap();
            (metadata.ctime(), metadata.ctime_nsec())
        };
        let before = (changed(&directory), changed(&config_path));
        std::thread::sleep(std::time::Duration::from_millis(50));
        secure_private_directory(&directory).unwrap();
        secure_private_regular_file(&config_path).unwrap();
        assert_eq!((changed(&directory), changed(&config_path)), before);

        let _ = fs::remove_dir_all(test_root);
    }

    #[cfg(unix)]
    #[test]
    fn legacy_migration_never_follows_a_dangling_destination_symlink() {
        use std::os::unix::fs::symlink;

        let test_root = std::env::temp_dir().join(format!(
            "voco-config-migration-security-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let legacy_dir = test_root.join(LEGACY_APP_DIR_NAME);
        let config_dir = test_root.join(APP_DIR_NAME);
        fs::create_dir_all(&legacy_dir).unwrap();
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(legacy_dir.join("config.json"), "{\"hotkey\":\"Alt+D\"}").unwrap();
        let unrelated_target = test_root.join("must-not-be-created.json");
        let destination = config_dir.join("config.json");
        symlink(&unrelated_target, &destination).unwrap();

        migrate_legacy_config(&test_root, &config_dir).unwrap();

        assert!(!unrelated_target.exists());
        assert!(fs::symlink_metadata(destination)
            .unwrap()
            .file_type()
            .is_symlink());
        let _ = fs::remove_dir_all(test_root);
    }

    #[test]
    fn retired_settings_are_dropped_without_losing_current_ones() {
        let config: AppConfig = serde_json::from_str(
            r#"{
            "hotkey":"Super+D", "selectedMic":"usb-mic", "onboardingCompleted":true,
            "updateChannel":"beta", "installChannel":"appimage",
            "insertionStrategy":"clipboard", "transcriptTarget":"openclaw-speech",
            "liveCursorMode":"final-text-only", "transcriptEnhancement":"conservative",
            "voiceProfile":"accent-aware", "localLlmEndpoint":"http://localhost:8080",
            "openclawAgent":"old-agent"
        }"#,
        )
        .unwrap();
        assert_eq!(config.hotkey, "Super+D");
        assert_eq!(config.selected_mic.as_deref(), Some("usb-mic"));
        assert!(config.onboarding_completed);
        assert!(matches!(config.update_channel, UpdateChannel::Beta));
        assert!(matches!(
            config.install_channel,
            InstallChannel::GithubRelease
        ));
        assert_eq!(
            serde_json::to_value(config).unwrap(),
            serde_json::json!({
                "hotkey": "Super+D",
                "selectedMic": "usb-mic",
                "onboardingCompleted": true,
                "updateChannel": "beta",
                "installChannel": "github-release",
            })
        );
    }

    #[test]
    fn patches_reject_retired_modes_and_preserve_omitted_preferences() {
        for field in [
            "insertionStrategy",
            "transcriptTarget",
            "liveCursorMode",
            "transcriptEnhancement",
            "voiceProfile",
            "openclawAgent",
            "localLlmModel",
        ] {
            assert!(
                serde_json::from_value::<AppConfigPatch>(serde_json::json!({field:"removed"}))
                    .is_err()
            );
        }
        let mut config = AppConfig {
            selected_mic: Some("usb".into()),
            ..AppConfig::default()
        };
        let patch: AppConfigPatch = serde_json::from_str(r#"{"hotkey":"Super+D"}"#).unwrap();
        patch.apply_to(&mut config);
        assert_eq!(config.selected_mic.as_deref(), Some("usb"));
        let clear: AppConfigPatch = serde_json::from_str(r#"{"selectedMic":null}"#).unwrap();
        clear.apply_to(&mut config);
        assert!(config.selected_mic.is_none());
        assert_eq!(config.hotkey, "Super+D");
    }
}
