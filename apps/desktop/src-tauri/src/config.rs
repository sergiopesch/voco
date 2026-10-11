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
    /// Check GitHub's public release list at startup. Off, VOCO checks only
    /// when you choose Check for updates.
    #[serde(default = "default_automatic_update_checks")]
    pub automatic_update_checks: bool,
    #[serde(default)]
    pub install_channel: InstallChannel,
    /// None until someone chooses, in setup or Settings; dictation then
    /// spells British.
    #[serde(default)]
    pub english_spelling: Option<EnglishSpelling>,
    /// Names and terms that dictation writes as listed
    /// (`runtime/speech/mywords.py`). Empty until the user adds one.
    #[serde(default)]
    pub my_words: Vec<String>,
    /// The versions of My words entries the user taught VOCO, the way the
    /// recognizer heard them. A separate key, so an earlier VOCO still reads
    /// this config.
    #[serde(default)]
    pub my_words_heard: Vec<HeardVersion>,
}

/// What the recognizer wrote when the user said a My words entry, and the
/// entry, or the one word of it, that dictation writes instead. Like the
/// config itself, it ignores fields it doesn't know, so a hand edit or a later
/// VOCO's field can't make the file unreadable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeardVersion {
    pub heard: String,
    pub writes: String,
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
    pub automatic_update_checks: PatchField<bool>,
    #[serde(default)]
    pub install_channel: PatchField<InstallChannel>,
    /// A choice, once made, can change but not be cleared.
    #[serde(default)]
    pub english_spelling: PatchField<EnglishSpelling>,
    /// The whole list, replacing the saved one; `validate_my_words` checks it.
    #[serde(default)]
    pub my_words: PatchField<Vec<String>>,
    /// Every taught version, replacing the saved ones;
    /// `validate_my_words_heard` checks them against the list.
    #[serde(default)]
    pub my_words_heard: PatchField<Vec<HeardVersion>>,
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
        if let PatchField::Set(value) = self.automatic_update_checks {
            config.automatic_update_checks = value;
        }
        if let PatchField::Set(value) = self.install_channel {
            config.install_channel = value;
        }
        if let PatchField::Set(value) = self.english_spelling {
            config.english_spelling = Some(value);
        }
        if let PatchField::Set(value) = self.my_words {
            config.my_words = value;
        }
        if let PatchField::Set(value) = self.my_words_heard {
            config.my_words_heard = value;
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

fn default_automatic_update_checks() -> bool {
    true
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

/// How the speech worker spells words that British and American English spell
/// differently (`runtime/speech/spelling.py`). It changes spelling only.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EnglishSpelling {
    #[default]
    British,
    American,
    AsRecognised,
}

impl EnglishSpelling {
    /// The worker protocol's name for this spelling.
    pub fn protocol_name(self) -> &'static str {
        match self {
            Self::British => "british",
            Self::American => "american",
            Self::AsRecognised => "as-recognised",
        }
    }
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
            automatic_update_checks: default_automatic_update_checks(),
            install_channel: InstallChannel::default(),
            english_spelling: None,
            my_words: Vec::new(),
            my_words_heard: Vec::new(),
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

    /// The spelling a new dictation uses. It takes no lock and never saves:
    /// every write replaces the file atomically, so a read sees one whole
    /// version. A file VOCO can't read spells British, like a new one.
    pub fn english_spelling_for_dictation() -> EnglishSpelling {
        Self::config_dir_without_migration()
            .map(|directory| english_spelling_at(&directory.join("config.json")))
            .unwrap_or_default()
    }

    /// The My words list and its taught versions a new dictation uses, read
    /// the same way as its spelling. A file VOCO can't read gives neither.
    pub fn my_words_for_dictation() -> (Vec<String>, Vec<HeardVersion>) {
        Self::config_dir_without_migration()
            .map(|directory| my_words_at(&directory.join("config.json")))
            .unwrap_or_default()
    }
}

/// The most entries My words holds, the most words and characters in one,
/// as `runtime/speech/mywords.py` reads them.
pub const MY_WORDS_MAX_TERMS: usize = 100;
pub const MY_WORDS_MAX_WORDS: usize = 4;
pub const MY_WORDS_MAX_CHARS: usize = 40;
/// The most taught versions an entry keeps.
pub const MY_WORDS_MAX_HEARD: usize = 5;

/// Checks a My words list before it is saved. The worker skips an entry
/// that breaks these rules rather than failing dictation, so a hand-edited
/// config can't stop it.
pub fn validate_my_words(words: &[String]) -> Result<(), String> {
    if words.len() > MY_WORDS_MAX_TERMS {
        return Err(format!(
            "My words holds at most {MY_WORDS_MAX_TERMS} entries."
        ));
    }
    let mut seen = std::collections::HashSet::new();
    for term in words {
        if listable_word_count(term).is_none() {
            return Err(format!(
                "\u{201c}{term}\u{201d} can use letters, digits, single spaces, hyphens, \
                 apostrophes and full stops, and must start with a letter or digit."
            ));
        }
        if !listable(term) {
            return Err(format!(
                "\u{201c}{term}\u{201d} is too long: an entry has at most \
                 {MY_WORDS_MAX_WORDS} words and {MY_WORDS_MAX_CHARS} characters."
            ));
        }
        if !seen.insert(my_words_key(term)) {
            return Err(format!("\u{201c}{term}\u{201d} is already in My words."));
        }
    }
    Ok(())
}

/// Checks the taught versions against the list they belong to before they are
/// saved, by the rules the worker reads them with: each writes an entry, or one
/// word of it, that it doesn't already match, matches no entry or other
/// version, and an entry keeps at most `MY_WORDS_MAX_HEARD`.
pub fn validate_my_words_heard(words: &[String], heard: &[HeardVersion]) -> Result<(), String> {
    let mut taken: std::collections::HashSet<String> =
        words.iter().map(|term| my_words_key(term)).collect();
    let mut counts = std::collections::HashMap::new();
    for version in heard {
        if !heard_listable(&version.heard) {
            return Err(format!(
                "VOCO can't learn \u{201c}{}\u{201d}: a version is up to {MY_WORDS_MAX_WORDS} words \
                 and {MY_WORDS_MAX_CHARS} characters, of letters, digits, apostrophes, single \
                 spaces and hyphens.",
                version.heard
            ));
        }
        // A version belongs to the entry it writes whole, or else to the first
        // entry with that word, as the worker reads it.
        let entry = words
            .iter()
            .position(|term| *term == version.writes)
            .or_else(|| {
                words
                    .iter()
                    .position(|term| term_words(term).any(|word| word == version.writes))
            })
            .ok_or_else(|| format!("\u{201c}{}\u{201d} isn't in My words.", version.writes))?;
        let key = my_words_key(&version.heard);
        if key == my_words_key(&version.writes) {
            return Err(format!(
                "VOCO already writes \u{201c}{}\u{201d} for it.",
                version.writes
            ));
        }
        if !taken.insert(key) {
            return Err(format!(
                "\u{201c}{}\u{201d} already writes one of your words.",
                version.heard
            ));
        }
        let count = counts.entry(entry).or_insert(0);
        *count += 1;
        if *count > MY_WORDS_MAX_HEARD {
            return Err(format!(
                "VOCO keeps up to {MY_WORDS_MAX_HEARD} versions of \u{201c}{}\u{201d}.",
                words[entry]
            ));
        }
    }
    // A version of one word also stands for it inside each entry with that
    // word. Such a match may repeat one that writes the same entry, but must
    // not clash with one that writes anything else.
    let mut writes: std::collections::HashMap<String, &str> = words
        .iter()
        .map(|term| (my_words_key(term), term.as_str()))
        .collect();
    for version in heard {
        writes.insert(my_words_key(&version.heard), version.writes.as_str());
    }
    for version in heard {
        let heard_key = my_words_key(&version.heard);
        for term in words.iter().filter(|term| {
            **term != version.writes && term_words(term).any(|word| word == version.writes)
        }) {
            let whole = key_with(term, &version.writes, &heard_key);
            if *writes.entry(whole).or_insert(term.as_str()) != term.as_str() {
                return Err(format!(
                    "\u{201c}{}\u{201d} would make another of your words write differently.",
                    version.heard
                ));
            }
        }
    }
    Ok(())
}

/// A term's key with the first of its words that is `word` heard as `heard_key`.
fn key_with(term: &str, word: &str, heard_key: &str) -> String {
    let mut swapped = false;
    term_words(term)
        .map(|each| {
            if !swapped && each == word {
                swapped = true;
                heard_key.to_string()
            } else {
                my_words_key(each)
            }
        })
        .collect()
}

/// An account's full name as a My words entry: None when GLib had none to
/// give ("Unknown"), it is only the login name, or it isn't listable. A name
/// written all in lower case gets capitals, or the worker would keep it in
/// lower case mid-sentence like an ordinary word.
pub fn account_name_entry(name: &str, login: &str) -> Option<String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() || name == "Unknown" || name.eq_ignore_ascii_case(login) || !listable(&name)
    {
        return None;
    }
    if name.chars().any(char::is_uppercase) {
        return Some(name);
    }
    let capitalised: Vec<String> = name
        .split(' ')
        .map(|word| {
            let mut letters = word.chars();
            letters
                .next()
                .map(|first| first.to_uppercase().chain(letters).collect())
                .unwrap_or_default()
        })
        .collect();
    Some(capitalised.join(" "))
}

/// A term's words, as the worker splits them.
fn term_words(term: &str) -> impl Iterator<Item = &str> {
    term.split(|c: char| !(c.is_alphanumeric() || matches!(c, '\'' | '\u{2019}')))
        .filter(|word| !word.is_empty())
}

/// A taught version is listable like a term, but full stops never join its words.
fn heard_listable(heard: &str) -> bool {
    !heard.contains('.') && listable(heard)
}

fn listable(term: &str) -> bool {
    term.chars().count() <= MY_WORDS_MAX_CHARS
        && listable_word_count(term).is_some_and(|count| count <= MY_WORDS_MAX_WORDS)
}

/// Two entries the worker would match alike, apart from accents, which
/// Settings compares too; case compares as the worker's casefold does. Of
/// two that slip through, the worker writes the first one's spelling.
fn my_words_key(term: &str) -> String {
    let mut key = String::new();
    let letters = term
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '\'' | '\u{2019}'))
        .flat_map(char::to_lowercase);
    for letter in letters {
        match letter {
            'ß' => key.push_str("ss"),
            'ς' => key.push('σ'),
            '\u{1c80}' => key.push('в'),
            '\u{1c81}' => key.push('д'),
            '\u{1c82}' => key.push('о'),
            '\u{1c83}' => key.push('с'),
            '\u{1c84}' | '\u{1c85}' => key.push('т'),
            '\u{1c86}' => key.push('ъ'),
            '\u{1c87}' => key.push('ѣ'),
            '\u{1c88}' => key.push('ꙋ'),
            '\u{2019}' => key.push('\''),
            other => key.push(other),
        }
    }
    key
}

/// Normalizes to NFC (precomposed Unicode form).
pub(crate) fn normalize_nfc(text: &str) -> String {
    use icu_normalizer::ComposingNormalizer;
    let normalizer = ComposingNormalizer::new_nfc();
    normalizer.normalize(text).into_owned()
}

/// Normalizes My words entries and versions to NFC at config boundaries.
pub(crate) fn normalize_my_words(config: &mut AppConfig) {
    config.my_words = config
        .my_words
        .iter()
        .map(|term| normalize_nfc(term))
        .collect();
    config.my_words_heard = config
        .my_words_heard
        .iter()
        .map(|version| HeardVersion {
            heard: normalize_nfc(&version.heard),
            writes: normalize_nfc(&version.writes),
        })
        .collect();
}

/// The number of words in a listable term, or None when it isn't one: words
/// of letters and digits, perhaps joined by apostrophes, separated by one
/// space, one hyphen, or a full stop and at most one space, with an optional
/// final full stop.
fn listable_word_count(term: &str) -> Option<usize> {
    let chars: Vec<char> = term.chars().collect();
    let (mut index, mut words) = (0, 0);
    loop {
        let start = index;
        while index < chars.len() && chars[index].is_alphanumeric() {
            index += 1;
        }
        if index == start {
            return None;
        }
        while index + 1 < chars.len()
            && matches!(chars[index], '\'' | '\u{2019}')
            && chars[index + 1].is_alphanumeric()
        {
            index += 1;
            while index < chars.len() && chars[index].is_alphanumeric() {
                index += 1;
            }
        }
        words += 1;
        match chars.get(index) {
            None => return Some(words),
            Some(' ' | '-') => index += 1,
            Some('.') => {
                index += 1;
                if index == chars.len() {
                    return Some(words);
                }
                if chars[index] == ' ' {
                    index += 1;
                }
            }
            Some(_) => return None,
        }
    }
}

fn english_spelling_at(path: &std::path::Path) -> EnglishSpelling {
    let read = || -> Result<Option<EnglishSpelling>, Box<dyn std::error::Error>> {
        secure_private_regular_file(path)?;
        Ok(serde_json::from_str::<AppConfig>(&fs::read_to_string(path)?)?.english_spelling)
    };
    read().ok().flatten().unwrap_or_default()
}

fn my_words_at(path: &std::path::Path) -> (Vec<String>, Vec<HeardVersion>) {
    let read = || -> Result<AppConfig, Box<dyn std::error::Error>> {
        secure_private_regular_file(path)?;
        Ok(serde_json::from_str::<AppConfig>(&fs::read_to_string(
            path,
        )?)?)
    };
    let Ok(mut config) = read() else {
        return Default::default();
    };
    // Normalize to NFC at the boundary where config is loaded
    normalize_my_words(&mut config);
    // A hand-edited config can't send the worker more, or longer, entries or
    // versions than Settings can save; the worker checks the rest.
    let words = config
        .my_words
        .into_iter()
        .filter(|term| listable(term))
        .take(MY_WORDS_MAX_TERMS)
        .collect();
    let heard = config
        .my_words_heard
        .into_iter()
        .filter(|version| heard_listable(&version.heard) && listable(&version.writes))
        .take(MY_WORDS_MAX_TERMS * MY_WORDS_MAX_HEARD)
        .collect();
    (words, heard)
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

    // The guided installer leaves settings to VOCO, so this copy is the only one.
    #[cfg(unix)]
    #[test]
    fn legacy_migration_copies_a_regular_config_privately_and_never_replaces_one() {
        use std::os::unix::fs::PermissionsExt;

        let test_root = std::env::temp_dir().join(format!(
            "voco-config-migration-test-{}-{}",
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
        let legacy = legacy_dir.join("config.json");
        let legacy_settings = r#"{"hotkey":"Super+F12","selectedMic":"legacy-device"}"#;
        fs::write(&legacy, legacy_settings).unwrap();
        fs::set_permissions(&legacy, fs::Permissions::from_mode(0o644)).unwrap();

        migrate_legacy_config(&test_root, &config_dir).unwrap();

        let destination = config_dir.join("config.json");
        assert_eq!(fs::read_to_string(&destination).unwrap(), legacy_settings);
        assert_eq!(
            fs::symlink_metadata(&destination)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(fs::read_to_string(&legacy).unwrap(), legacy_settings);

        // Settings VOCO already has always win over a legacy file.
        fs::write(&legacy, r#"{"hotkey":"Ctrl+Shift+V"}"#).unwrap();
        migrate_legacy_config(&test_root, &config_dir).unwrap();
        assert_eq!(fs::read_to_string(&destination).unwrap(), legacy_settings);
        let _ = fs::remove_dir_all(test_root);
    }

    #[cfg(unix)]
    #[test]
    fn legacy_migration_refuses_a_linked_or_special_legacy_config_without_opening_it() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let test_root = std::env::temp_dir().join(format!(
            "voco-config-migration-refusal-test-{}-{}",
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
        let legacy = legacy_dir.join("config.json");
        let destination = config_dir.join("config.json");

        let target = test_root.join("linked-settings.json");
        fs::write(&target, r#"{"hotkey":"Super+F12"}"#).unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o644)).unwrap();
        symlink(&target, &legacy).unwrap();
        assert!(migrate_legacy_config(&test_root, &config_dir).is_err());
        assert!(fs::symlink_metadata(&destination).is_err());
        assert_eq!(
            fs::read_to_string(&target).unwrap(),
            r#"{"hotkey":"Super+F12"}"#
        );
        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o644
        );

        // Opening a FIFO would wait for a writer; the check must reject it first.
        fs::remove_file(&legacy).unwrap();
        assert!(std::process::Command::new("mkfifo")
            .arg(&legacy)
            .status()
            .unwrap()
            .success());
        let (sender, receiver) = std::sync::mpsc::channel();
        let (root, directory) = (test_root.clone(), config_dir.clone());
        std::thread::spawn(move || {
            let _ = sender.send(migrate_legacy_config(&root, &directory).is_err());
        });
        assert_eq!(
            receiver.recv_timeout(std::time::Duration::from_secs(5)),
            Ok(true)
        );
        assert!(fs::symlink_metadata(&destination).is_err());
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
                "automaticUpdateChecks": true,
                "installChannel": "github-release",
                "englishSpelling": null,
                "myWords": [],
                "myWordsHeard": [],
            })
        );
    }

    #[test]
    fn english_spelling_round_trips_and_an_earlier_config_spells_british() {
        let mut config: AppConfig =
            serde_json::from_str(r#"{"hotkey":"Alt+D","onboardingCompleted":true}"#).unwrap();
        assert_eq!(config.english_spelling, None);
        assert_eq!(
            config.english_spelling.unwrap_or_default(),
            EnglishSpelling::British
        );
        for (name, spelling) in [
            ("american", EnglishSpelling::American),
            ("as-recognised", EnglishSpelling::AsRecognised),
            ("british", EnglishSpelling::British),
        ] {
            let patch: AppConfigPatch =
                serde_json::from_value(serde_json::json!({"englishSpelling": name})).unwrap();
            patch.apply_to(&mut config);
            assert_eq!(config.english_spelling, Some(spelling));
            assert_eq!(spelling.protocol_name(), name);
            let saved = serde_json::to_string(&config).unwrap();
            let loaded: AppConfig = serde_json::from_str(&saved).unwrap();
            assert_eq!(loaded.english_spelling, Some(spelling));
            assert_eq!(
                serde_json::to_value(&loaded).unwrap()["englishSpelling"],
                name
            );
        }
        let unrelated: AppConfigPatch = serde_json::from_str(r#"{"hotkey":"Super+D"}"#).unwrap();
        unrelated.apply_to(&mut config);
        assert_eq!(config.english_spelling, Some(EnglishSpelling::British));
        for rejected in [
            r#"{"englishSpelling":null}"#,
            r#"{"englishSpelling":"canadian"}"#,
        ] {
            assert!(serde_json::from_str::<AppConfigPatch>(rejected).is_err());
        }
    }

    #[test]
    fn my_words_round_trip_and_an_earlier_config_has_none() {
        let mut config: AppConfig =
            serde_json::from_str(r#"{"hotkey":"Alt+D","onboardingCompleted":true}"#).unwrap();
        assert!(config.my_words.is_empty());
        let patch: AppConfigPatch = serde_json::from_value(
            serde_json::json!({"myWords": ["GitHub", "New Zealand", "Málaga"]}),
        )
        .unwrap();
        patch.apply_to(&mut config);
        let loaded: AppConfig =
            serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
        assert_eq!(loaded.my_words, ["GitHub", "New Zealand", "Málaga"]);
        let unrelated: AppConfigPatch = serde_json::from_str(r#"{"hotkey":"Super+D"}"#).unwrap();
        unrelated.apply_to(&mut config);
        assert_eq!(config.my_words.len(), 3);
        let cleared: AppConfigPatch = serde_json::from_str(r#"{"myWords":[]}"#).unwrap();
        cleared.apply_to(&mut config);
        assert!(config.my_words.is_empty());
        for rejected in [
            r#"{"myWords":null}"#,
            r#"{"myWords":"GitHub"}"#,
            r#"{"myWords":[3]}"#,
        ] {
            assert!(serde_json::from_str::<AppConfigPatch>(rejected).is_err());
        }
    }

    #[test]
    fn taught_versions_round_trip_in_their_own_key() {
        let mut config: AppConfig =
            serde_json::from_str(r#"{"hotkey":"Alt+D","myWords":["Siobhán"]}"#).unwrap();
        assert!(config.my_words_heard.is_empty());
        let patch: AppConfigPatch = serde_json::from_value(serde_json::json!({
            "myWordsHeard": [{"heard": "Shivon", "writes": "Siobhán"}]}))
        .unwrap();
        patch.apply_to(&mut config);
        let saved = serde_json::to_value(&config).unwrap();
        assert_eq!(saved["myWords"], serde_json::json!(["Siobhán"]));
        assert_eq!(
            saved["myWordsHeard"],
            serde_json::json!([{"heard": "Shivon", "writes": "Siobhán"}])
        );
        let loaded: AppConfig = serde_json::from_value(saved).unwrap();
        assert_eq!(loaded.my_words_heard, config.my_words_heard);
        for rejected in [
            r#"{"myWordsHeard":null}"#,
            r#"{"myWordsHeard":["Shivon"]}"#,
            r#"{"myWordsHeard":[{"heard":"Shivon"}]}"#,
        ] {
            assert!(
                serde_json::from_str::<AppConfigPatch>(rejected).is_err(),
                "{rejected}"
            );
        }
        // A field VOCO doesn't know is dropped, never kept or fatal.
        let extra: AppConfig = serde_json::from_str(
            r#"{"myWords":["Siobhán"],"myWordsHeard":[{"heard":"Shivon","writes":"Siobhán","later":1}]}"#,
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&extra.my_words_heard).unwrap(),
            serde_json::json!([{"heard": "Shivon", "writes": "Siobhán"}])
        );
    }

    #[test]
    fn an_account_name_is_offered_only_when_it_could_be_an_entry() {
        assert_eq!(
            account_name_entry("Siobhán  Kelly", "skelly").as_deref(),
            Some("Siobhán Kelly")
        );
        assert_eq!(
            account_name_entry("Jean-Luc O'Neill", "jl").as_deref(),
            Some("Jean-Luc O'Neill")
        );
        assert_eq!(
            account_name_entry("siobhán kelly", "sk").as_deref(),
            Some("Siobhán Kelly")
        );
        assert_eq!(
            account_name_entry("Siobhán de Kelly", "sk").as_deref(),
            Some("Siobhán de Kelly")
        );
        for unusable in [
            "",
            "Unknown",
            "skelly",
            "SKelly",
            "Ops (on call)",
            "a b c d e",
            &"x".repeat(41),
        ] {
            assert_eq!(account_name_entry(unusable, "skelly"), None, "{unusable:?}");
        }
    }

    #[test]
    fn taught_version_validation_matches_the_worker_rules() {
        let version = |heard: &str, writes: &str| HeardVersion {
            heard: heard.into(),
            writes: writes.into(),
        };
        let words: Vec<String> = ["Siobhán Kelly", "GitHub", "Jean-Luc"]
            .map(String::from)
            .to_vec();
        let valid = [
            version("Shivon Kelly", "Siobhán Kelly"),
            version("Shivon", "Siobhán"),
            version("get hub", "GitHub"),
            version("Shaun-Luke", "Jean-Luc"),
            version("Luke", "Luc"),
            version("o'neill's", "GitHub"),
        ];
        assert_eq!(validate_my_words_heard(&words, &valid), Ok(()));
        assert_eq!(validate_my_words_heard(&words, &[]), Ok(()));
        for invalid in [
            version("Shi. Von", "Siobhán"),
            version("Shi, von", "Siobhán"),
            version("", "Siobhán"),
            version("one two three four five", "Siobhán"),
            version(&"x".repeat(MY_WORDS_MAX_CHARS + 1), "Siobhán"),
            version("Shivon", "Nobody"),
            version("Shivon", "siobhán"),
            version("git hub", "Siobhán"),
            version("SIOBHÁN", "Siobhán"),
        ] {
            assert!(
                validate_my_words_heard(&words, std::slice::from_ref(&invalid)).is_err(),
                "{invalid:?}"
            );
        }
        assert!(validate_my_words_heard(
            &words,
            &[version("Shivon", "Siobhán"), version("shi von", "Kelly")]
        )
        .is_err());
        let five: Vec<HeardVersion> = (0..MY_WORDS_MAX_HEARD)
            .map(|index| version(&format!("version{index}"), "Siobhán"))
            .collect();
        assert_eq!(validate_my_words_heard(&words, &five), Ok(()));
        let mut six = five.clone();
        six.push(version("Shivonne", "Kelly"));
        assert!(validate_my_words_heard(&words, &six).is_err());
        // A version of one word mustn't make another entry, said in full,
        // match two ways. (Accents compare in Settings and the worker.)
        let names: Vec<String> = ["Foo", "José Garcia", "José Kelly"]
            .map(String::from)
            .to_vec();
        assert!(validate_my_words_heard(
            &names,
            &[version("Hosay Garcia", "Foo"), version("Hosay", "José")]
        )
        .is_err());
        assert!(validate_my_words_heard(
            &names,
            &[version("Hosay", "José"), version("Hosay Garcia", "Foo")]
        )
        .is_err());
        assert_eq!(
            validate_my_words_heard(&names, &[version("Hosay", "José")]),
            Ok(())
        );
        let clash: Vec<String> = ["José Garcia", "Hosay Garcia"].map(String::from).to_vec();
        assert!(validate_my_words_heard(&clash, &[version("Hosay", "José")]).is_err());
        // A match that writes the same entry another way is no clash.
        assert_eq!(
            validate_my_words_heard(
                &["Siobhán Kelly".into()],
                &[
                    version("Shivon Kelly", "Siobhán Kelly"),
                    version("Shivon", "Siobhán")
                ]
            ),
            Ok(())
        );
        // A version belongs to the entry it writes whole, so it counts there.
        let both: Vec<String> = ["Siobhán Kelly", "Siobhán"].map(String::from).to_vec();
        let mut whole = five.clone();
        whole.push(version("Kellie", "Kelly"));
        assert_eq!(validate_my_words_heard(&both, &whole), Ok(()));
    }

    #[test]
    fn my_words_validation_matches_the_worker_rules() {
        let valid: Vec<String> = [
            "GitHub",
            "New Zealand",
            "O'Neill",
            "O\u{2019}Neill Ltd",
            "St. Ives",
            "Jean-Luc",
            "GTK",
            "Málaga",
            "R2D2",
            "Acme Inc.",
            "one two three four",
        ]
        .map(String::from)
        .to_vec();
        assert_eq!(validate_my_words(&valid), Ok(()));
        assert_eq!(validate_my_words(&["x".repeat(MY_WORDS_MAX_CHARS)]), Ok(()));
        let full: Vec<String> = (0..MY_WORDS_MAX_TERMS)
            .map(|index| format!("term{index}"))
            .collect();
        assert_eq!(validate_my_words(&full), Ok(()));
        for invalid in [
            "",
            " GitHub",
            "GitHub ",
            "two  spaces",
            "one two three four five",
            "C++",
            "a_b",
            "tab\there",
            "-dash",
            "end-",
            "end'",
            "St..Ives",
        ] {
            assert!(
                validate_my_words(&[invalid.to_string()]).is_err(),
                "{invalid:?}"
            );
        }
        assert!(validate_my_words(&["x".repeat(MY_WORDS_MAX_CHARS + 1)]).is_err());
        let over: Vec<String> = (0..=MY_WORDS_MAX_TERMS)
            .map(|index| format!("term{index}"))
            .collect();
        assert!(validate_my_words(&over).is_err());
        assert!(validate_my_words(&["Git Hub".into(), "github".into()]).is_err());
        assert!(validate_my_words(&["Straße".into(), "STRASSE".into()]).is_err());
        assert!(validate_my_words(&["O'Neill".into(), "O\u{2019}Neill".into()]).is_err());
    }

    #[test]
    fn shared_fixture_validates_nfc_and_nfd_alike() {
        use serde::Deserialize;
        #[derive(Deserialize)]
        struct FixtureCase {
            label: String,
            input: String,
            #[serde(rename = "expectedVerdict")]
            expected_verdict: String,
            #[serde(rename = "expectedWordCount")]
            expected_word_count: Option<usize>,
        }
        let fixture_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../tests/fixtures/mywords/entries.json");
        let fixture = std::fs::read_to_string(&fixture_path).expect("fixture exists");
        let cases: Vec<FixtureCase> = serde_json::from_str(&fixture).expect("valid JSON");

        let test_dir = std::env::temp_dir().join(format!(
            "voco-config-fixture-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&test_dir).unwrap();
        let config_path = test_dir.join("config.json");

        for case in cases {
            // Write the fixture input into a temp config and read through my_words_at boundary
            let config_json = serde_json::json!({
                "hotkey": "Alt+D",
                "myWords": [case.input.clone()]
            });
            atomic_write(&config_path, &config_json.to_string()).unwrap();
            let (words, _) = my_words_at(&config_path);

            if case.expected_verdict == "accept" {
                assert_eq!(
                    words.len(),
                    1,
                    "{}: expected accept but got {} words",
                    case.label,
                    words.len()
                );
                if let Some(expected_count) = case.expected_word_count {
                    let actual = listable_word_count(&words[0]);
                    assert_eq!(
                        actual,
                        Some(expected_count),
                        "{}: expected {} words but got {:?}",
                        case.label,
                        expected_count,
                        actual
                    );
                }
            } else {
                assert_eq!(
                    words.len(),
                    0,
                    "{}: expected reject but got {} words",
                    case.label,
                    words.len()
                );
            }
        }

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn persist_config_patch_normalizes_nfd_to_nfc() {
        let nfd_input = "Siobha\u{0301}n Kelly"; // NFD (decomposed)
        let nfc_expected = "Siobhán Kelly"; // NFC (precomposed)

        // Create a config with NFD input
        let mut config = AppConfig {
            my_words: vec![nfd_input.to_string()],
            my_words_heard: vec![HeardVersion {
                heard: nfd_input.to_string(),
                writes: nfd_input.to_string(),
            }],
            ..Default::default()
        };

        // Normalize as persist_config_patch does
        normalize_my_words(&mut config);

        // Verify NFD was normalized to NFC
        assert_eq!(config.my_words, vec![nfc_expected]);
        assert_eq!(config.my_words_heard[0].heard, nfc_expected);
        assert_eq!(config.my_words_heard[0].writes, nfc_expected);
    }

    #[test]
    fn dictation_reads_only_entries_settings_could_save() {
        let test_dir = std::env::temp_dir().join(format!(
            "voco-config-my-words-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&test_dir).unwrap();
        let path = test_dir.join("config.json");
        assert_eq!(my_words_at(&path), (Vec::new(), Vec::new()));
        let edited = serde_json::json!({"hotkey": "Alt+D", "myWords": [
            "GitHub", "C++", "github", "x".repeat(5000), "New Zealand"],
            "myWordsHeard": [{"heard": "get hub", "writes": "GitHub"},
                {"heard": "St. Hub", "writes": "GitHub"}, {"heard": "x".repeat(5000), "writes": "GitHub"}]});
        atomic_write(&path, &edited.to_string()).unwrap();
        let (words, heard) = my_words_at(&path);
        assert_eq!(words, ["GitHub", "github", "New Zealand"]);
        assert_eq!(
            heard,
            [HeardVersion {
                heard: "get hub".into(),
                writes: "GitHub".into()
            }]
        );
        let many: Vec<String> = (0..MY_WORDS_MAX_TERMS + 20)
            .map(|index| format!("term{index}"))
            .collect();
        let versions: Vec<serde_json::Value> = (0..MY_WORDS_MAX_TERMS * MY_WORDS_MAX_HEARD + 20)
            .map(|index| serde_json::json!({"heard": format!("v{index}"), "writes": "term0"}))
            .collect();
        atomic_write(
            &path,
            &serde_json::json!({"hotkey": "Alt+D", "myWords": many, "myWordsHeard": versions})
                .to_string(),
        )
        .unwrap();
        let (words, heard) = my_words_at(&path);
        assert_eq!(words.len(), MY_WORDS_MAX_TERMS);
        assert_eq!(heard.len(), MY_WORDS_MAX_TERMS * MY_WORDS_MAX_HEARD);
        atomic_write(&path, "{not valid json").unwrap();
        assert_eq!(my_words_at(&path), (Vec::new(), Vec::new()));

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn dictation_reads_the_saved_spelling_and_otherwise_spells_british() {
        let test_dir = std::env::temp_dir().join(format!(
            "voco-config-spelling-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&test_dir).unwrap();
        let path = test_dir.join("config.json");
        assert_eq!(english_spelling_at(&path), EnglishSpelling::British);
        atomic_write(&path, r#"{"hotkey":"Alt+D","englishSpelling":"american"}"#).unwrap();
        assert_eq!(english_spelling_at(&path), EnglishSpelling::American);
        atomic_write(&path, r#"{"hotkey":"Alt+D"}"#).unwrap();
        assert_eq!(english_spelling_at(&path), EnglishSpelling::British);
        atomic_write(&path, "{not valid json").unwrap();
        assert_eq!(english_spelling_at(&path), EnglishSpelling::British);
        assert_eq!(fs::read_to_string(&path).unwrap(), "{not valid json");

        let _ = fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn update_checks_start_on_and_only_a_patch_that_names_them_turns_them_off() {
        let mut config: AppConfig = serde_json::from_str(r#"{"hotkey":"Super+D"}"#).unwrap();
        assert!(config.automatic_update_checks);
        assert!(AppConfig::default().automatic_update_checks);
        let off: AppConfigPatch =
            serde_json::from_str(r#"{"automaticUpdateChecks":false}"#).unwrap();
        off.apply_to(&mut config);
        let other: AppConfigPatch = serde_json::from_str(r#"{"hotkey":"Alt+D"}"#).unwrap();
        other.apply_to(&mut config);
        assert!(!config.automatic_update_checks);
        assert_eq!(
            serde_json::to_value(&config).unwrap()["automaticUpdateChecks"],
            false
        );
        assert!(
            serde_json::from_str::<AppConfigPatch>(r#"{"automaticUpdateChecks":null}"#).is_err()
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
