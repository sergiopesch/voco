//! Text-only crash journal. Normal completion deletes the active entry; Review
//! shows a previous process's unfinished entry, or a Stop that could neither
//! paste nor copy its text. No output replay. Best effort: damaged files are
//! skipped, and no earlier session or failure can block a new one.
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::ffi::CStr;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

const MAX_TEXT: usize = 256 * 1024;
const MAX_RECOVERIES: usize = 5;
const MAX_FILE: u64 = MAX_TEXT as u64 * 6 * MAX_RECOVERIES as u64 + 1024;
const ACTIVE: &CStr = c"active.json";
const RECOVERED: &CStr = c"recovered.json";
const PENDING: &CStr = c"pending.tmp";
static STATE: Mutex<State> = Mutex::new(State::new());

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub id: String,
    pub text: String,
    pub created_at: u64,
}

struct State {
    root: Option<PathBuf>,
    journal: Option<Journal>,
    epoch: u64,
    closed: bool,
}

struct Journal {
    directory: File,
    active: Option<(Entry, u64)>,
    recovered: Vec<Entry>,
}

fn safe_id(id: &str) -> bool {
    id.len() == 36
        && id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

fn valid_entry(entry: &Entry) -> bool {
    safe_id(&entry.id) && entry.text.len() <= MAX_TEXT && entry.created_at <= 8_640_000_000_000_000
}

fn private_child(parent: &File, name: &CStr) -> Result<File, String> {
    // All child operations stay anchored to an open directory and never follow links.
    let made = unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) };
    if made < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists {
        return Err("Cannot create private recovery directory".into());
    }
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err("Cannot open private recovery directory".into());
    }
    let file = unsafe { File::from_raw_fd(fd) };
    let metadata = file
        .metadata()
        .map_err(|_| "Cannot inspect recovery directory")?;
    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err("Recovery directory must be owned by you".into());
    }
    // A directory we own may have inherited a loose umask; repair it in place.
    if metadata.mode() & 0o077 != 0 && unsafe { libc::fchmod(file.as_raw_fd(), 0o700) } != 0 {
        return Err("Cannot make recovery directory private (0700)".into());
    }
    Ok(file)
}

impl Journal {
    fn open(root: &Path) -> Result<Self, String> {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(root)
            .map_err(|_| "Cannot create state directory")?;
        // The state root is only an anchor: it may be shared or group-writable
        // (umask 002 is common). Privacy rests on the children, which are opened
        // through their parent's descriptor without following links, must be ours
        // and are kept 0700; another writer can only remove or replace one, and a
        // replacement is refused.
        let parent = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY | libc::O_CLOEXEC)
            .open(root)
            .map_err(|_| "Cannot open state directory")?;
        let app = private_child(&parent, c"voco")?;
        let directory = private_child(&app, c"crash-recovery")?;
        let mut journal = Self {
            directory,
            active: None,
            recovered: Vec::new(),
        };
        let _ = journal.remove(PENDING);
        // Keep every valid entry of a damaged collection.
        let entries: Vec<serde_json::Value> = journal.read_json(RECOVERED).unwrap_or_default();
        journal.recovered = entries
            .into_iter()
            .filter_map(|entry| serde_json::from_value(entry).ok())
            .filter(valid_entry)
            .take(MAX_RECOVERIES)
            .collect();
        if let Err(error) = journal.recover_active() {
            log::warn!("Interrupted dictation could not be moved to Review: {error}");
        }
        Ok(journal)
    }

    /// Moves an unfinished session's text into Review. The active slot is always
    /// released, so a failure here cannot block the next session.
    fn recover_active(&mut self) -> Result<(), String> {
        self.active = None;
        if let Some(entry) = self.read(ACTIVE) {
            if !entry.text.trim().is_empty() && !self.recovered.iter().any(|old| old.id == entry.id)
            {
                let mut recovered = self.recovered.clone();
                recovered.insert(0, entry);
                recovered.truncate(MAX_RECOVERIES);
                // The checkpoint is removed only once its text is safely in Review.
                self.save(RECOVERED, &recovered)?;
                self.recovered = recovered;
            }
        }
        self.remove(ACTIVE)
    }

    /// Opens a file we own for reading and tightens a loose mode. Anything else
    /// (link, special or foreign file, unreadable, oversized) reads as absent;
    /// a save replaces it atomically and a removal deletes it.
    fn open_file(&self, name: &CStr) -> Option<File> {
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return None;
        }
        let file = unsafe { File::from_raw_fd(fd) };
        let metadata = file.metadata().ok()?;
        if !metadata.is_file()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.nlink() != 1
            || metadata.len() > MAX_FILE
        {
            return None;
        }
        if metadata.mode() & 0o077 != 0 && unsafe { libc::fchmod(file.as_raw_fd(), 0o600) } != 0 {
            return None;
        }
        Some(file)
    }

    fn read_json<T: DeserializeOwned>(&self, name: &CStr) -> Option<T> {
        let mut bytes = Vec::new();
        self.open_file(name)?
            .take(MAX_FILE)
            .read_to_end(&mut bytes)
            .ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    fn read(&self, name: &CStr) -> Option<Entry> {
        self.read_json(name).filter(valid_entry)
    }

    fn remove(&self, name: &CStr) -> Result<(), String> {
        if unsafe { libc::unlinkat(self.directory.as_raw_fd(), name.as_ptr(), 0) } != 0 {
            return if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound {
                Ok(())
            } else {
                Err("Cannot remove recovery file".into())
            };
        }
        self.directory
            .sync_all()
            .map_err(|_| "Cannot sync recovery directory".to_string())
    }

    fn save<T: Serialize>(&self, name: &CStr, entry: &T) -> Result<(), String> {
        // A leftover from an interrupted save must not block this one.
        let _ = self.remove(PENDING);
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                PENDING.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err("Cannot create private recovery checkpoint".into());
        }
        let mut file = unsafe { File::from_raw_fd(fd) };
        let result = (|| {
            let bytes =
                serde_json::to_vec(entry).map_err(|_| "Cannot encode recovery checkpoint")?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "Cannot save recovery checkpoint")?;
            // renameat replaces the name itself, so a damaged or linked target is
            // replaced, never written through.
            if unsafe {
                libc::renameat(
                    self.directory.as_raw_fd(),
                    PENDING.as_ptr(),
                    self.directory.as_raw_fd(),
                    name.as_ptr(),
                )
            } != 0
            {
                return Err("Cannot commit recovery checkpoint".into());
            }
            self.directory
                .sync_all()
                .map_err(|_| "Cannot sync recovery checkpoint".into())
        })();
        if result.is_err() {
            let _ = self.remove(PENDING);
        }
        result
    }

    fn dismiss(&mut self, id: &str) -> Result<(), String> {
        let recovered: Vec<_> = self
            .recovered
            .iter()
            .filter(|entry| entry.id != id)
            .cloned()
            .collect();
        if recovered.len() == self.recovered.len() {
            return Ok(());
        }
        self.save(RECOVERED, &recovered)?;
        self.recovered = recovered;
        Ok(())
    }

    fn begin(&mut self, id: String) -> Result<(), String> {
        if !safe_id(&id) {
            return Err("Invalid crash recovery session".into());
        }
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as u64);
        let entry = Entry {
            id,
            text: String::new(),
            created_at,
        };
        // An unfinished session of this process was handled or abandoned, not a
        // crash: its checkpoint is replaced rather than moved to Review.
        self.save(ACTIVE, &entry)?;
        self.active = Some((entry, 0));
        Ok(())
    }

    fn update(&mut self, id: &str, sequence: u64, text: String) -> Result<(), String> {
        if text.len() > MAX_TEXT {
            return Err("Crash recovery text limit reached".into());
        }
        let Some((entry, previous)) = self.active.as_ref() else {
            return Err("Recovery session is closed".into());
        };
        if entry.id != id || sequence <= *previous {
            return Err("Stale recovery checkpoint".into());
        }
        let next = Entry {
            text,
            ..entry.clone()
        };
        self.save(ACTIVE, &next)?;
        self.active = Some((next, sequence));
        Ok(())
    }

    fn finish(&mut self, id: &str) -> Result<(), String> {
        if self
            .active
            .as_ref()
            .is_some_and(|(entry, _)| entry.id == id)
        {
            self.remove(ACTIVE)?;
            self.active = None;
        }
        Ok(())
    }

    /// Ends the session like `finish`, but moves its text into Review.
    fn keep(&mut self, id: &str) -> Result<(), String> {
        if self
            .active
            .as_ref()
            .is_some_and(|(entry, _)| entry.id == id)
        {
            self.recover_active()?;
        }
        Ok(())
    }
}

impl State {
    const fn new() -> Self {
        Self {
            root: None,
            journal: None,
            epoch: 0,
            closed: false,
        }
    }

    /// Opens the journal on first use, so a failed start is retried later.
    fn journal(&mut self) -> Result<&mut Journal, String> {
        let journal = match self.journal.take() {
            Some(journal) => journal,
            None => Journal::open(
                self.root
                    .as_deref()
                    .ok_or("Crash recovery is not initialized")?,
            )?,
        };
        Ok(self.journal.insert(journal))
    }

    /// Only the current renderer may write, and nothing after a clean exit.
    fn current(&mut self, epoch: u64) -> Result<&mut Journal, String> {
        if self.closed || self.epoch != epoch {
            return Err("Recovery renderer is no longer current".into());
        }
        self.journal()
    }

    fn initialize(&mut self, root: &Path) -> Result<(), String> {
        self.root = Some(root.into());
        self.journal()?;
        Ok(())
    }

    fn close(&mut self) {
        self.closed = true;
        if let Some(journal) = self.journal.as_mut() {
            journal.active = None;
            if let Err(error) = journal.remove(ACTIVE) {
                log::warn!("Crash journal cleanup failed: {error}");
            }
        }
    }

    fn renderer_restarted(&mut self, epoch: u64) -> Result<(), String> {
        self.epoch = epoch;
        // The replaced renderer cannot finish its session; keep its text for Review.
        match self.journal.as_mut() {
            Some(journal) => journal.recover_active(),
            None => Ok(()),
        }
    }

    /// Idempotent and session-bound: a repeated, superseded or stale-renderer
    /// finish has nothing of its own left to delete.
    fn finish(&mut self, id: &str, epoch: u64) -> Result<(), String> {
        match self.journal.as_mut() {
            Some(journal) if epoch == self.epoch => journal.finish(id),
            _ => Ok(()),
        }
    }

    fn keep(&mut self, id: &str, epoch: u64) -> Result<(), String> {
        match self.journal.as_mut() {
            Some(journal) if epoch == self.epoch => journal.keep(id),
            _ => Ok(()),
        }
    }
}

fn state() -> MutexGuard<'static, State> {
    // A panic elsewhere must not disable recovery for the rest of the process.
    STATE.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn initialize(root: &Path) -> Result<(), String> {
    state().initialize(root)
}

pub fn clean_exit() {
    state().close();
}

pub fn renderer_restarted(epoch: u64) -> Result<(), String> {
    state().renderer_restarted(epoch)
}

#[tauri::command]
pub async fn get_crash_journal_epoch() -> Result<u64, String> {
    Ok(state().epoch)
}

#[tauri::command]
pub async fn list_crash_recovery() -> Result<Vec<Entry>, String> {
    Ok(state().journal()?.recovered.clone())
}
#[tauri::command]
pub async fn dismiss_crash_recovery(id: String) -> Result<(), String> {
    state().journal()?.dismiss(&id)
}
#[tauri::command]
pub async fn begin_crash_journal(id: String, epoch: u64) -> Result<(), String> {
    state().current(epoch)?.begin(id)
}
#[tauri::command]
pub async fn update_crash_journal(
    id: String,
    epoch: u64,
    sequence: u64,
    text: String,
) -> Result<(), String> {
    state().current(epoch)?.update(&id, sequence, text)
}
#[tauri::command]
pub async fn finish_crash_journal(id: String, epoch: u64) -> Result<(), String> {
    state().finish(&id, epoch)
}
#[tauri::command]
pub async fn keep_crash_journal(id: String, epoch: u64) -> Result<(), String> {
    state().keep(&id, epoch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    const ID: &str = "11111111-1111-1111-1111-111111111111";
    const OTHER: &str = "22222222-2222-2222-2222-222222222222";
    fn root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "voco-crash-journal-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        root
    }
    fn opened(root: &Path) -> State {
        let mut state = State::new();
        state.initialize(root).unwrap();
        state
    }
    #[test]
    fn crash_only_text_survives_and_clean_capture_keeps_previous_crash() {
        let root = root();
        let mut first = Journal::open(&root).unwrap();
        first.begin(ID.into()).unwrap();
        first.update(ID, 1, "Private fixture text".into()).unwrap();
        assert!(first.recovered.is_empty());
        drop(first);
        let mut second = Journal::open(&root).unwrap();
        assert_eq!(second.recovered[0].text, "Private fixture text");
        second.begin(OTHER.into()).unwrap();
        second.update(OTHER, 1, "Normal".into()).unwrap();
        second.finish(OTHER).unwrap();
        assert!(second.read(ACTIVE).is_none());
        drop(second);
        assert_eq!(Journal::open(&root).unwrap().recovered.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn stale_updates_and_finish_cannot_mutate_a_new_capture() {
        let root = root();
        let mut journal = Journal::open(&root).unwrap();
        journal.begin(ID.into()).unwrap();
        journal.update(ID, 2, "New".into()).unwrap();
        assert!(journal.update(ID, 1, "Old".into()).is_err());
        journal.finish(ID).unwrap();
        journal.begin(OTHER.into()).unwrap();
        journal.finish(ID).unwrap();
        assert!(journal.update(ID, 3, "Late".into()).is_err());
        assert_eq!(journal.read(ACTIVE).unwrap().id, OTHER);
        assert!(journal.update(OTHER, 1, "x".repeat(MAX_TEXT + 1)).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unsafe_files_are_skipped_repaired_or_replaced_never_written_through() {
        let root = root();
        let mut journal = Journal::open(&root).unwrap();
        journal.begin(ID.into()).unwrap();
        let file = root.join("voco/crash-recovery/active.json");
        assert_eq!(fs::metadata(&file).unwrap().mode() & 0o777, 0o600);
        fs::hard_link(&file, root.join("link")).unwrap();
        assert!(journal.read(ACTIVE).is_none());
        fs::remove_file(root.join("link")).unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(journal.read(ACTIVE).unwrap().id, ID);
        assert_eq!(fs::metadata(&file).unwrap().mode() & 0o777, 0o600);
        fs::remove_file(&file).unwrap();
        symlink(root.join("target"), &file).unwrap();
        assert!(journal.read(ACTIVE).is_none());
        journal.update(ID, 1, "Replaces the link".into()).unwrap();
        assert!(!root.join("target").exists());
        assert!(fs::symlink_metadata(&file).unwrap().is_file());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn empty_crash_is_not_review_and_clean_closed_journal_refuses_new_writes() {
        let root = root();
        let mut journal = Journal::open(&root).unwrap();
        journal.begin(ID.into()).unwrap();
        drop(journal);
        let mut state = opened(&root);
        let journal = state.current(0).unwrap();
        assert!(journal.recovered.is_empty());
        journal.begin(OTHER.into()).unwrap();
        journal
            .update(OTHER, 1, "Clean exit fixture".into())
            .unwrap();
        state.close();
        assert!(state.current(0).is_err());
        assert!(Journal::open(&root).unwrap().recovered.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn renderer_restart_recovers_old_capture_and_rejects_its_commands() {
        let root = root();
        let mut state = opened(&root);
        state.renderer_restarted(1).unwrap();
        let journal = state.current(1).unwrap();
        journal.begin(ID.into()).unwrap();
        journal
            .update(ID, 1, "Renderer crash fixture".into())
            .unwrap();
        state.renderer_restarted(2).unwrap();
        assert!(state.current(1).is_err());
        let journal = state.current(2).unwrap();
        assert_eq!(journal.recovered[0].id, ID);
        journal.begin(OTHER.into()).unwrap();
        state.finish(ID, 2).unwrap();
        state.finish(OTHER, 1).unwrap();
        assert_eq!(
            state.journal().unwrap().active.as_ref().unwrap().0.id,
            OTHER
        );
        state.finish(OTHER, 2).unwrap();
        assert_eq!(Journal::open(&root).unwrap().recovered[0].id, ID);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_dismiss_does_not_change_visible_recovery_or_current_capture() {
        let root = root();
        let mut journal = Journal::open(&root).unwrap();
        journal.begin(ID.into()).unwrap();
        journal.update(ID, 1, "Prior crash".into()).unwrap();
        journal.recover_active().unwrap();
        journal.begin(OTHER.into()).unwrap();
        // A directory in the staging slot makes the next save fail, even for root.
        let blocker = root.join("voco/crash-recovery/pending.tmp");
        fs::create_dir(&blocker).unwrap();
        assert!(journal.dismiss(ID).is_err());
        assert_eq!(journal.recovered[0].id, ID);
        assert_eq!(journal.active.as_ref().unwrap().0.id, OTHER);
        fs::remove_dir(&blocker).unwrap();
        journal.dismiss(ID).unwrap();
        assert!(journal.recovered.is_empty());
        assert_eq!(journal.active.as_ref().unwrap().0.id, OTHER);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_delete_keeps_current_identity_for_a_safe_retry() {
        let root = root();
        let mut journal = Journal::open(&root).unwrap();
        journal.begin(ID.into()).unwrap();
        // A directory in its place makes the delete fail, even for root.
        let path = root.join("voco/crash-recovery/active.json");
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(journal.finish(ID).is_err());
        assert_eq!(journal.active.as_ref().unwrap().0.id, ID);
        fs::remove_dir(&path).unwrap();
        journal.finish(ID).unwrap();
        assert!(journal.active.is_none());
        journal.begin(OTHER.into()).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn damaged_entries_are_skipped_and_valid_crashes_kept() {
        let root = root();
        let directory = root.join("voco/crash-recovery");
        let mut journal = Journal::open(&root).unwrap();
        journal.begin(ID.into()).unwrap();
        journal.update(ID, 1, "Kept crash fixture".into()).unwrap();
        journal.recover_active().unwrap();
        let kept = serde_json::to_string(&journal.recovered[0]).unwrap();
        drop(journal);
        let invalid = format!(
            r#"{{"id":"{OTHER}","text":"Invalid date fixture","createdAt":{}}}"#,
            u64::MAX
        );
        let collection = format!(r#"[{kept},{invalid},{{"id":"../escape"}},7]"#);
        fs::write(directory.join("recovered.json"), collection).unwrap();
        fs::write(directory.join("active.json"), invalid).unwrap();
        let mut journal = Journal::open(&root).unwrap();
        assert_eq!(journal.recovered.len(), 1);
        assert_eq!(journal.recovered[0].text, "Kept crash fixture");
        assert!(!directory.join("active.json").exists());
        journal.begin(OTHER.into()).unwrap();
        drop(journal);
        fs::write(directory.join("recovered.json"), b"{truncated").unwrap();
        assert!(Journal::open(&root).unwrap().recovered.is_empty());
        let oversized = File::create(directory.join("recovered.json")).unwrap();
        oversized.set_len(MAX_FILE + 1).unwrap();
        let mut journal = Journal::open(&root).unwrap();
        assert!(journal.recovered.is_empty());
        journal.begin(ID.into()).unwrap();
        journal.update(ID, 1, "Later crash".into()).unwrap();
        drop(journal);
        assert_eq!(
            Journal::open(&root).unwrap().recovered[0].text,
            "Later crash"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn loose_directories_are_repaired_but_links_and_files_refused() {
        let root = root();
        let app = root.join("voco");
        let directory = app.join("crash-recovery");
        fs::create_dir_all(&directory).unwrap();
        fs::set_permissions(&app, fs::Permissions::from_mode(0o755)).unwrap();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o775)).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o777)).unwrap();
        Journal::open(&root).unwrap();
        for path in [&app, &directory] {
            assert_eq!(fs::metadata(path).unwrap().mode() & 0o777, 0o700);
        }
        fs::rename(&directory, root.join("elsewhere")).unwrap();
        symlink(root.join("elsewhere"), &directory).unwrap();
        assert!(Journal::open(&root).is_err());
        fs::remove_file(&directory).unwrap();
        fs::write(&directory, b"").unwrap();
        assert!(Journal::open(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn abandoned_session_never_blocks_the_next_begin() {
        let root = root();
        let mut journal = Journal::open(&root).unwrap();
        journal.begin(ID.into()).unwrap();
        journal
            .update(ID, 1, "Handled failure fixture".into())
            .unwrap();
        // No finish, as after a failed delete or an abandoned session.
        journal.begin(OTHER.into()).unwrap();
        let saved = journal.read(ACTIVE).unwrap();
        assert_eq!((saved.id.as_str(), saved.text.as_str()), (OTHER, ""));
        assert!(journal.update(ID, 2, "Late".into()).is_err());
        fs::write(root.join("voco/crash-recovery/pending.tmp"), b"stale").unwrap();
        journal.update(OTHER, 1, "Current".into()).unwrap();
        drop(journal);
        let journal = Journal::open(&root).unwrap();
        assert_eq!(journal.recovered.len(), 1);
        assert_eq!(journal.recovered[0].id, OTHER);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn finish_and_dismiss_are_idempotent() {
        let root = root();
        let mut state = State::new();
        state.root = Some(root.clone());
        state.finish(ID, 0).unwrap();
        state.current(0).unwrap().begin(ID.into()).unwrap();
        state.finish(OTHER, 0).unwrap();
        state.finish(ID, 9).unwrap();
        assert_eq!(state.journal().unwrap().active.as_ref().unwrap().0.id, ID);
        state.finish(ID, 0).unwrap();
        state.finish(ID, 0).unwrap();
        assert!(state.journal().unwrap().active.is_none());
        assert!(!root.join("voco/crash-recovery/active.json").exists());
        state.journal().unwrap().dismiss(ID).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn kept_session_moves_to_review_and_stale_keeps_change_nothing() {
        let root = root();
        let mut state = opened(&root);
        let journal = state.current(0).unwrap();
        journal.begin(ID.into()).unwrap();
        journal.update(ID, 1, "Undelivered fixture".into()).unwrap();
        state.keep(OTHER, 0).unwrap();
        state.keep(ID, 9).unwrap();
        assert!(state.journal().unwrap().recovered.is_empty());
        state.keep(ID, 0).unwrap();
        let journal = state.journal().unwrap();
        assert!(journal.active.is_none() && journal.read(ACTIVE).is_none());
        assert_eq!(journal.recovered[0].text, "Undelivered fixture");
        state.keep(ID, 0).unwrap();
        assert_eq!(Journal::open(&root).unwrap().recovered.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_start_is_retried_by_later_commands() {
        let root = root();
        fs::write(root.join("voco"), b"").unwrap();
        let mut state = State::new();
        assert!(state.initialize(&root).is_err());
        state.renderer_restarted(2).unwrap();
        state.finish(ID, 2).unwrap();
        fs::remove_file(root.join("voco")).unwrap();
        state.current(2).unwrap().begin(ID.into()).unwrap();
        state.finish(ID, 2).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sixth_crash_evicts_only_the_oldest() {
        let root = root();
        for crash in 0..6 {
            let id = format!("{crash:08}-1111-1111-1111-111111111111");
            let mut journal = Journal::open(&root).unwrap();
            journal.begin(id.clone()).unwrap();
            journal.update(&id, 1, format!("Crash {crash}")).unwrap();
        }
        let journal = Journal::open(&root).unwrap();
        let texts: Vec<_> = journal
            .recovered
            .iter()
            .map(|entry| entry.text.as_str())
            .collect();
        assert_eq!(
            texts,
            ["Crash 5", "Crash 4", "Crash 3", "Crash 2", "Crash 1"]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn crash_child() {
        let Some(root) = std::env::var_os("VOCO_JOURNAL_CRASH_FIXTURE") else {
            return;
        };
        let root = std::path::PathBuf::from(root);
        let mut journal = Journal::open(&root).unwrap();
        journal.begin(ID.into()).unwrap();
        journal
            .update(ID, 1, "Synthetic crash recovery fixture.".into())
            .unwrap();
        fs::write(root.join("ready"), b"ready").unwrap();
        loop {
            std::thread::park();
        }
    }

    #[test]
    fn killed_process_reopens_only_its_last_committed_text() {
        let root = root();
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "crash_recovery::tests::crash_child",
                "--nocapture",
            ])
            .env("VOCO_JOURNAL_CRASH_FIXTURE", &root)
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !root.join("ready").exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let ready = root.join("ready").exists();
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(
            ready,
            "isolated crash child did not commit its synthetic checkpoint"
        );
        let journal = Journal::open(&root).unwrap();
        assert_eq!(journal.recovered.len(), 1);
        assert_eq!(
            journal.recovered[0].text,
            "Synthetic crash recovery fixture."
        );
        assert!(journal.read(ACTIVE).is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
