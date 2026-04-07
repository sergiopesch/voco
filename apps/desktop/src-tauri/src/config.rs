use serde::{Deserialize, Serialize};
use std::fs;
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
    #[serde(default = "default_insertion_strategy")]
    pub insertion_strategy: InsertionStrategy,
    #[serde(default = "default_show_hud")]
    pub show_hud: bool,
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default = "default_update_channel")]
    pub update_channel: UpdateChannel,
    #[serde(default = "default_install_channel")]
    pub install_channel: InstallChannel,
    #[serde(default = "default_voice_profile")]
    pub voice_profile: VoiceProfile,
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

fn default_show_hud() -> bool {
    true
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
            show_hud: default_show_hud(),
            onboarding_completed: false,
            update_channel: default_update_channel(),
            install_channel: default_install_channel(),
            voice_profile: default_voice_profile(),
        }
    }
}

impl AppConfig {
    pub fn config_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
        let base_dir =
            dirs::config_dir().ok_or("Cannot find config directory (XDG_CONFIG_HOME)")?;
        let config_dir = base_dir.join(APP_DIR_NAME);
        migrate_legacy_config(&base_dir, &config_dir)?;
        fs::create_dir_all(&config_dir)?;
        Ok(config_dir)
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
            let content = fs::read_to_string(&path)?;
            Ok(serde_json::from_str(&content)?)
        } else {
            let config = Self::default();
            config.save()?;
            Ok(config)
        }
    }

    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let path = Self::config_path()?;
        let content = serde_json::to_string_pretty(self)?;
        fs::write(&path, content)?;
        Ok(())
    }
}

pub fn load_cached_update_check() -> Result<Option<CachedUpdateCheck>, Box<dyn std::error::Error>> {
    let path = AppConfig::update_cache_path()?;
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path)?;
    Ok(Some(serde_json::from_str(&content)?))
}

pub fn save_cached_update_check(
    cache: &CachedUpdateCheck,
) -> Result<(), Box<dyn std::error::Error>> {
    let path = AppConfig::update_cache_path()?;
    let content = serde_json::to_string_pretty(cache)?;
    fs::write(path, content)?;
    Ok(())
}

fn migrate_legacy_config(
    base_dir: &std::path::Path,
    new_config_dir: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let old_config_path = base_dir.join(LEGACY_APP_DIR_NAME).join("config.json");
    let new_config_path = new_config_dir.join("config.json");

    if new_config_path.exists() || !old_config_path.exists() {
        return Ok(());
    }

    fs::create_dir_all(new_config_dir)?;
    fs::copy(&old_config_path, &new_config_path)?;
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
        assert!(config.show_hud);
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
            show_hud: false,
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
        assert!(!parsed.show_hud);
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
        assert!(config.show_hud);
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
                current_version: Some("2026.0.3".to_string()),
                latest_release: Some(ReleaseInfo {
                    version: "2026.0.4-beta.1".to_string(),
                    name: "VOCO 2026.0.4 beta 1".to_string(),
                    url:
                        "https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.4-beta.1"
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
            Some("2026.0.4-beta.1")
        );
    }
}
