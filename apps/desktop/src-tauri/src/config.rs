use log::warn;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const APP_DIR_NAME: &str = "voco";
pub const LEGACY_APP_DIR_NAME: &str = "voice";
const LEGACY_OPENCLAW_PROMPT_PREFIX: &str = "You are my electronics professor and robotics companion. Explain the answer step by step, call out Raspberry Pi wiring safety risks, and ask before any physical action that could damage hardware.";
const DEFAULT_OPENCLAW_PROMPT_PREFIX: &str = "You are a helpful local voice assistant. Answer clearly and concisely, preserve the user's intent, state uncertainty honestly, and ask before taking actions with external or irreversible effects.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    #[serde(default)]
    pub selected_mic: Option<String>,
    #[serde(default = "default_insertion_strategy")]
    pub insertion_strategy: InsertionStrategy,
    #[serde(default = "default_transcript_target")]
    pub transcript_target: TranscriptTarget,
    #[serde(default = "default_live_cursor_mode")]
    pub live_cursor_mode: LiveCursorMode,
    #[serde(default = "default_openclaw_agent")]
    pub openclaw_agent: String,
    #[serde(default = "default_openclaw_prompt_prefix")]
    pub openclaw_prompt_prefix: String,
    #[serde(default = "default_transcript_enhancement")]
    pub transcript_enhancement: TranscriptEnhancement,
    #[serde(default = "default_local_llm_endpoint")]
    pub local_llm_endpoint: String,
    #[serde(default)]
    pub local_llm_model: Option<String>,
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default = "default_update_channel")]
    pub update_channel: UpdateChannel,
    #[serde(default = "default_install_channel")]
    pub install_channel: InstallChannel,
    #[serde(default = "default_voice_profile")]
    pub voice_profile: VoiceProfile,
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
    pub insertion_strategy: PatchField<InsertionStrategy>,
    #[serde(default)]
    pub transcript_target: PatchField<TranscriptTarget>,
    #[serde(default)]
    pub live_cursor_mode: PatchField<LiveCursorMode>,
    #[serde(default)]
    pub openclaw_agent: PatchField<String>,
    #[serde(default)]
    pub openclaw_prompt_prefix: PatchField<String>,
    #[serde(default)]
    pub transcript_enhancement: PatchField<TranscriptEnhancement>,
    #[serde(default)]
    pub local_llm_endpoint: PatchField<String>,
    #[serde(default)]
    pub local_llm_model: PatchField<Option<String>>,
    #[serde(default)]
    pub onboarding_completed: PatchField<bool>,
    #[serde(default)]
    pub update_channel: PatchField<UpdateChannel>,
    #[serde(default)]
    pub install_channel: PatchField<InstallChannel>,
    #[serde(default)]
    pub voice_profile: PatchField<VoiceProfile>,
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
        if let PatchField::Set(value) = self.insertion_strategy {
            config.insertion_strategy = value;
        }
        if let PatchField::Set(value) = self.transcript_target {
            config.transcript_target = value;
        }
        if let PatchField::Set(value) = self.live_cursor_mode {
            config.live_cursor_mode = value;
        }
        if let PatchField::Set(value) = self.openclaw_agent {
            config.openclaw_agent = value;
        }
        if let PatchField::Set(value) = self.openclaw_prompt_prefix {
            config.openclaw_prompt_prefix = value;
        }
        if let PatchField::Set(value) = self.transcript_enhancement {
            config.transcript_enhancement = value;
        }
        if let PatchField::Set(value) = self.local_llm_endpoint {
            config.local_llm_endpoint = value;
        }
        if let PatchField::Set(value) = self.local_llm_model {
            config.local_llm_model = value;
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
        if let PatchField::Set(value) = self.voice_profile {
            config.voice_profile = value;
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

fn default_insertion_strategy() -> InsertionStrategy {
    InsertionStrategy::Auto
}

fn default_transcript_target() -> TranscriptTarget {
    TranscriptTarget::Cursor
}

fn default_live_cursor_mode() -> LiveCursorMode {
    LiveCursorMode::StableCursorStreaming
}

fn default_openclaw_agent() -> String {
    "main".to_string()
}

fn default_openclaw_prompt_prefix() -> String {
    DEFAULT_OPENCLAW_PROMPT_PREFIX.to_string()
}

fn default_transcript_enhancement() -> TranscriptEnhancement {
    TranscriptEnhancement::Off
}

fn default_local_llm_endpoint() -> String {
    "http://127.0.0.1:8080/v1/chat/completions".to_string()
}

fn default_update_channel() -> UpdateChannel {
    UpdateChannel::Stable
}

fn default_install_channel() -> InstallChannel {
    InstallChannel::GithubRelease
}

fn default_voice_profile() -> VoiceProfile {
    VoiceProfile::Default
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InsertionStrategy {
    #[default]
    Auto,
    Clipboard,
    TypeSimulation,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TranscriptTarget {
    #[default]
    Cursor,
    LocalAgent,
    OpenclawAgent,
    OpenclawSpeech,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LiveCursorMode {
    #[default]
    StableCursorStreaming,
    PreviewOverlayOnly,
    FinalTextOnly,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TranscriptEnhancement {
    #[default]
    Off,
    Conservative,
    CommandsOnly,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Beta,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstallChannel {
    #[default]
    GithubRelease,
    Appimage,
    Source,
    Flatpak,
    Snap,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VoiceProfile {
    #[default]
    Default,
    AccentAware,
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
            insertion_strategy: InsertionStrategy::Auto,
            transcript_target: default_transcript_target(),
            live_cursor_mode: default_live_cursor_mode(),
            openclaw_agent: default_openclaw_agent(),
            openclaw_prompt_prefix: default_openclaw_prompt_prefix(),
            transcript_enhancement: default_transcript_enhancement(),
            local_llm_endpoint: default_local_llm_endpoint(),
            local_llm_model: None,
            onboarding_completed: false,
            update_channel: default_update_channel(),
            install_channel: default_install_channel(),
            voice_profile: default_voice_profile(),
        }
    }
}

impl AppConfig {
    fn config_dir_without_migration() -> Result<PathBuf, Box<dyn std::error::Error>> {
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

    pub fn config_dir_for_recovery() -> Result<PathBuf, Box<dyn std::error::Error>> {
        Self::config_dir_without_migration()
    }

    pub fn config_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
        Ok(Self::config_dir()?.join("config.json"))
    }

    pub fn update_cache_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
        Ok(Self::config_dir()?.join("update-cache.json"))
    }

    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let path = Self::config_path()?;
        if path.exists() {
            secure_private_regular_file(&path)?;
            let content = fs::read_to_string(&path)?;
            let mut config: Self = serde_json::from_str(&content)?;
            if config.migrate_legacy_defaults() {
                if let Err(error) = config.save() {
                    warn!(
                        "Loaded legacy VOCO settings, but could not persist the optional default migration: {error}"
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
        let path = Self::config_dir_for_recovery()?.join("config.json");
        reset_config_file(&path)
    }

    fn migrate_legacy_defaults(&mut self) -> bool {
        if self.openclaw_prompt_prefix == LEGACY_OPENCLAW_PROMPT_PREFIX {
            self.openclaw_prompt_prefix = default_openclaw_prompt_prefix();
            return true;
        }
        false
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
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} must be a real directory", path.display()),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.uid() != unsafe { libc::geteuid() } {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!("{} is not owned by the current user", path.display()),
            ));
        }
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        let secured = fs::symlink_metadata(path)?;
        if secured.uid() != unsafe { libc::geteuid() } || secured.mode() & 0o777 != 0o700 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!("{} could not be secured to mode 0700", path.display()),
            ));
        }
    }
    Ok(())
}

fn secure_private_regular_file(path: &std::path::Path) -> Result<(), std::io::Error> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("{} must be a regular file", path.display()),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.uid() != unsafe { libc::geteuid() } {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!("{} is not owned by the current user", path.display()),
            ));
        }
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        let secured = fs::symlink_metadata(path)?;
        if secured.uid() != unsafe { libc::geteuid() } || secured.mode() & 0o777 != 0o600 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!("{} could not be secured to mode 0600", path.display()),
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
    fn default_config_has_expected_values() {
        let config = AppConfig::default();
        assert_eq!(config.hotkey, "Alt+D");
        assert!(config.selected_mic.is_none());
        assert!(matches!(config.insertion_strategy, InsertionStrategy::Auto));
        assert!(matches!(config.transcript_target, TranscriptTarget::Cursor));
        assert!(matches!(
            config.live_cursor_mode,
            LiveCursorMode::StableCursorStreaming
        ));
        assert_eq!(config.openclaw_agent, "main");
        assert!(config
            .openclaw_prompt_prefix
            .contains("helpful local voice assistant"));
        assert!(matches!(
            config.transcript_enhancement,
            TranscriptEnhancement::Off
        ));
        assert_eq!(
            config.local_llm_endpoint,
            "http://127.0.0.1:8080/v1/chat/completions"
        );
        assert!(config.local_llm_model.is_none());
        assert!(!config.onboarding_completed);
        assert!(matches!(config.update_channel, UpdateChannel::Stable));
        assert!(matches!(
            config.install_channel,
            InstallChannel::GithubRelease
        ));
        assert!(matches!(config.voice_profile, VoiceProfile::Default));
    }

    #[test]
    fn config_serialization_round_trip() {
        let config = AppConfig {
            hotkey: "Ctrl+Shift+V".to_string(),
            selected_mic: Some("test-mic".to_string()),
            insertion_strategy: InsertionStrategy::Clipboard,
            transcript_target: TranscriptTarget::OpenclawAgent,
            live_cursor_mode: LiveCursorMode::FinalTextOnly,
            openclaw_agent: "bench".to_string(),
            openclaw_prompt_prefix: "Teach safely.".to_string(),
            transcript_enhancement: TranscriptEnhancement::Conservative,
            local_llm_endpoint: "http://localhost:9090/v1/chat/completions".to_string(),
            local_llm_model: Some("gemma-4-12b-it-qat".to_string()),
            onboarding_completed: true,
            update_channel: UpdateChannel::Beta,
            install_channel: InstallChannel::Appimage,
            voice_profile: VoiceProfile::AccentAware,
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.hotkey, "Ctrl+Shift+V");
        assert_eq!(parsed.selected_mic, Some("test-mic".to_string()));
        assert!(matches!(
            parsed.insertion_strategy,
            InsertionStrategy::Clipboard
        ));
        assert!(matches!(
            parsed.transcript_target,
            TranscriptTarget::OpenclawAgent
        ));
        assert!(matches!(
            parsed.live_cursor_mode,
            LiveCursorMode::FinalTextOnly
        ));
        assert_eq!(parsed.openclaw_agent, "bench");
        assert_eq!(parsed.openclaw_prompt_prefix, "Teach safely.");
        assert!(matches!(
            parsed.transcript_enhancement,
            TranscriptEnhancement::Conservative
        ));
        assert_eq!(
            parsed.local_llm_endpoint,
            "http://localhost:9090/v1/chat/completions"
        );
        assert_eq!(
            parsed.local_llm_model.as_deref(),
            Some("gemma-4-12b-it-qat")
        );
        assert!(parsed.onboarding_completed);
        assert!(matches!(parsed.update_channel, UpdateChannel::Beta));
        assert!(matches!(parsed.install_channel, InstallChannel::Appimage));
        assert!(matches!(parsed.voice_profile, VoiceProfile::AccentAware));
    }

    #[test]
    fn config_deserializes_with_defaults() {
        let json = r#"{}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.hotkey, "Alt+D");
        assert!(matches!(config.insertion_strategy, InsertionStrategy::Auto));
        assert!(matches!(config.transcript_target, TranscriptTarget::Cursor));
        assert!(matches!(
            config.live_cursor_mode,
            LiveCursorMode::StableCursorStreaming
        ));
        assert_eq!(config.openclaw_agent, "main");
        assert!(config
            .openclaw_prompt_prefix
            .contains("helpful local voice assistant"));
        assert!(matches!(
            config.transcript_enhancement,
            TranscriptEnhancement::Off
        ));
        assert_eq!(
            config.local_llm_endpoint,
            "http://127.0.0.1:8080/v1/chat/completions"
        );
        assert!(config.local_llm_model.is_none());
        assert!(!config.onboarding_completed);
        assert!(matches!(config.update_channel, UpdateChannel::Stable));
        assert!(matches!(
            config.install_channel,
            InstallChannel::GithubRelease
        ));
        assert!(matches!(config.voice_profile, VoiceProfile::Default));
    }

    #[test]
    fn config_patch_changes_only_present_fields() {
        let mut config = AppConfig {
            selected_mic: Some("original-mic".to_string()),
            local_llm_model: Some("original-model".to_string()),
            ..AppConfig::default()
        };
        let patch: AppConfigPatch = serde_json::from_str(
            r#"{"hotkey":"Alt+Shift+D","transcriptEnhancement":"conservative"}"#,
        )
        .unwrap();

        patch.apply_to(&mut config);

        assert_eq!(config.hotkey, "Alt+Shift+D");
        assert!(matches!(
            config.transcript_enhancement,
            TranscriptEnhancement::Conservative
        ));
        assert_eq!(config.selected_mic.as_deref(), Some("original-mic"));
        assert_eq!(config.local_llm_model.as_deref(), Some("original-model"));
    }

    #[test]
    fn config_patch_distinguishes_missing_and_null_nullable_fields() {
        let mut config = AppConfig {
            selected_mic: Some("original-mic".to_string()),
            local_llm_model: Some("original-model".to_string()),
            ..AppConfig::default()
        };
        let patch: AppConfigPatch =
            serde_json::from_str(r#"{"selectedMic":null,"localLlmModel":"new-model"}"#).unwrap();

        patch.apply_to(&mut config);

        assert!(config.selected_mic.is_none());
        assert_eq!(config.local_llm_model.as_deref(), Some("new-model"));
    }

    #[test]
    fn config_patch_rejects_unknown_fields_and_null_non_nullable_values() {
        assert!(serde_json::from_str::<AppConfigPatch>(r#"{"unknown":true}"#).is_err());
        assert!(serde_json::from_str::<AppConfigPatch>(r#"{"hotkey":null}"#).is_err());
    }

    #[test]
    fn exact_personalized_legacy_prompt_migrates_without_overwriting_custom_prompts() {
        let mut legacy = AppConfig {
            openclaw_prompt_prefix: LEGACY_OPENCLAW_PROMPT_PREFIX.to_string(),
            ..AppConfig::default()
        };
        assert!(legacy.migrate_legacy_defaults());
        assert_eq!(
            legacy.openclaw_prompt_prefix,
            DEFAULT_OPENCLAW_PROMPT_PREFIX
        );

        let mut customized = AppConfig {
            openclaw_prompt_prefix: "Keep my custom instructions.".to_string(),
            ..AppConfig::default()
        };
        assert!(!customized.migrate_legacy_defaults());
        assert_eq!(
            customized.openclaw_prompt_prefix,
            "Keep my custom instructions."
        );
    }

    #[test]
    fn config_deserializes_legacy_show_hud_field() {
        let json = r#"{"showHud":false,"hotkey":"Alt+Shift+D"}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.hotkey, "Alt+Shift+D");
        assert!(matches!(config.insertion_strategy, InsertionStrategy::Auto));
        assert!(matches!(config.transcript_target, TranscriptTarget::Cursor));
        assert!(matches!(
            config.live_cursor_mode,
            LiveCursorMode::StableCursorStreaming
        ));
        assert_eq!(config.openclaw_agent, "main");
        assert!(matches!(
            config.transcript_enhancement,
            TranscriptEnhancement::Off
        ));
        assert_eq!(
            config.local_llm_endpoint,
            "http://127.0.0.1:8080/v1/chat/completions"
        );
        assert!(!config.onboarding_completed);
        assert!(matches!(config.update_channel, UpdateChannel::Stable));
        assert!(matches!(
            config.install_channel,
            InstallChannel::GithubRelease
        ));
        assert!(matches!(config.voice_profile, VoiceProfile::Default));
    }

    #[test]
    fn insertion_strategy_serializes_kebab_case() {
        let json = serde_json::to_string(&InsertionStrategy::TypeSimulation).unwrap();
        assert_eq!(json, r#""type-simulation""#);

        let json = serde_json::to_string(&InsertionStrategy::Auto).unwrap();
        assert_eq!(json, r#""auto""#);
    }

    #[test]
    fn transcript_target_serializes_kebab_case() {
        let json = serde_json::to_string(&TranscriptTarget::LocalAgent).unwrap();
        assert_eq!(json, r#""local-agent""#);

        let json = serde_json::to_string(&TranscriptTarget::OpenclawAgent).unwrap();
        assert_eq!(json, r#""openclaw-agent""#);

        let json = serde_json::to_string(&TranscriptTarget::OpenclawSpeech).unwrap();
        assert_eq!(json, r#""openclaw-speech""#);
    }

    #[test]
    fn live_cursor_mode_serializes_kebab_case() {
        let json = serde_json::to_string(&LiveCursorMode::StableCursorStreaming).unwrap();
        assert_eq!(json, r#""stable-cursor-streaming""#);

        let json = serde_json::to_string(&LiveCursorMode::PreviewOverlayOnly).unwrap();
        assert_eq!(json, r#""preview-overlay-only""#);

        let json = serde_json::to_string(&LiveCursorMode::FinalTextOnly).unwrap();
        assert_eq!(json, r#""final-text-only""#);
    }

    #[test]
    fn transcript_enhancement_serializes_kebab_case() {
        let json = serde_json::to_string(&TranscriptEnhancement::CommandsOnly).unwrap();
        assert_eq!(json, r#""commands-only""#);

        let json = serde_json::to_string(&TranscriptEnhancement::Conservative).unwrap();
        assert_eq!(json, r#""conservative""#);
    }

    #[test]
    fn update_channel_serializes_kebab_case() {
        let json = serde_json::to_string(&UpdateChannel::Stable).unwrap();
        assert_eq!(json, r#""stable""#);
    }

    #[test]
    fn voice_profile_serializes_kebab_case() {
        let json = serde_json::to_string(&VoiceProfile::AccentAware).unwrap();
        assert_eq!(json, r#""accent-aware""#);
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
}
