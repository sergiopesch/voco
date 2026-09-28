//! Text-only crash journal. Normal completion deletes the active entry; only a
//! previous process's unfinished entry can appear in Review. No output replay.
use serde::{Deserialize, Serialize};
use std::ffi::CString;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::Path;
use std::sync::{LazyLock, Mutex};

const MAX_TEXT: usize = 256 * 1024;
const MAX_RECOVERIES: usize = 5;
const MAX_FILE: u64 = MAX_TEXT as u64 * 6 * MAX_RECOVERIES as u64 + 1024;
static JOURNAL: LazyLock<Mutex<Option<Journal>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub id: String,
    pub text: String,
    pub created_at: u64,
}

struct Journal {
    directory: File,
    active: Option<(Entry, u64)>,
    recovered: Vec<Entry>,
    closed: bool,
    epoch: u64,
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

fn private_child(parent: &File, name: &str) -> Result<File, String> {
    let name = CString::new(name).map_err(|_| "Invalid journal directory")?;
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
    if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o077 != 0 {
        return Err("Recovery directory must be owned by you and private (0700)".into());
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
        let parent = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY | libc::O_CLOEXEC)
            .open(root)
            .map_err(|_| "Cannot open state directory")?;
        let metadata = parent
            .metadata()
            .map_err(|_| "Cannot inspect state directory")?;
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o022 != 0 {
            return Err("State directory ownership or permissions are unsafe".into());
        }
        let app = private_child(&parent, "voco")?;
        let directory = private_child(&app, "crash-recovery")?;
        let mut journal = Self {
            directory,
            active: None,
            recovered: Vec::new(),
            closed: false,
            epoch: 0,
        };
        journal.remove("pending.tmp")?;
        if let Some(entries) = journal.read_json::<Vec<Entry>>("recovered.json")? {
            if entries.len() > MAX_RECOVERIES || entries.iter().any(|entry| !valid_entry(entry)) {
                return Err("Invalid recovery collection".into());
            }
            journal.recovered = entries;
        }
        journal.recover_active()?;
        Ok(journal)
    }

    fn recover_active(&mut self) -> Result<(), String> {
        if let Some(entry) = self.read("active.json")? {
            if !entry.text.trim().is_empty() && !self.recovered.iter().any(|old| old.id == entry.id)
            {
                let mut recovered = self.recovered.clone();
                recovered.insert(0, entry);
                recovered.truncate(MAX_RECOVERIES);
                self.save("recovered.json", &recovered)?;
                self.recovered = recovered;
            }
            self.remove("active.json")?;
        }
        self.active = None;
        Ok(())
    }

    fn check_epoch(&self, epoch: u64) -> Result<(), String> {
        if self.closed || self.epoch != epoch {
            return Err("Recovery renderer is no longer current".into());
        }
        Ok(())
    }

    fn open_file(&self, name: &str) -> Result<Option<File>, String> {
        let name = CString::new(name).map_err(|_| "Invalid recovery filename")?;
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound {
                Ok(None)
            } else {
                Err("Cannot safely open recovery file".into())
            };
        }
        let file = unsafe { File::from_raw_fd(fd) };
        let metadata = file
            .metadata()
            .map_err(|_| "Cannot inspect recovery file")?;
        if !metadata.is_file()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o077 != 0
            || metadata.nlink() != 1
            || metadata.len() > MAX_FILE
        {
            return Err("Recovery file ownership, size or permissions are unsafe".into());
        }
        Ok(Some(file))
    }

    fn read_json<T: serde::de::DeserializeOwned>(&self, name: &str) -> Result<Option<T>, String> {
        let Some(file) = self.open_file(name)? else {
            return Ok(None);
        };
        let mut bytes = Vec::new();
        file.take(MAX_FILE + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read recovery file")?;
        if bytes.len() as u64 > MAX_FILE {
            return Err("Recovery file is too large".into());
        }
        Ok(Some(
            serde_json::from_slice(&bytes).map_err(|_| "Invalid recovery file")?,
        ))
    }

    fn read(&self, name: &str) -> Result<Option<Entry>, String> {
        let entry = self.read_json::<Entry>(name)?;
        if entry.as_ref().is_some_and(|entry| !valid_entry(entry)) {
            return Err("Invalid recovery entry".into());
        }
        Ok(entry)
    }

    fn remove(&self, name: &str) -> Result<(), String> {
        if self.open_file(name)?.is_none() {
            return Ok(());
        }
        let name = CString::new(name).map_err(|_| "Invalid recovery filename")?;
        if unsafe { libc::unlinkat(self.directory.as_raw_fd(), name.as_ptr(), 0) } != 0 {
            return Err("Cannot remove recovery file".into());
        }
        self.directory
            .sync_all()
            .map_err(|_| "Cannot sync recovery directory".to_string())
    }

    fn save<T: Serialize>(&self, name: &str, entry: &T) -> Result<(), String> {
        self.open_file(name)?;
        let temp = CString::new("pending.tmp").unwrap();
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                temp.as_ptr(),
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
            let name = CString::new(name).map_err(|_| "Invalid recovery filename")?;
            if unsafe {
                libc::renameat(
                    self.directory.as_raw_fd(),
                    temp.as_ptr(),
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
            let _ = self.remove("pending.tmp");
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
        self.save("recovered.json", &recovered)?;
        self.recovered = recovered;
        Ok(())
    }

    fn begin(&mut self, id: String) -> Result<(), String> {
        if self.closed || self.active.is_some() || !safe_id(&id) {
            return Err("Crash recovery session is not available".into());
        }
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Invalid clock")?
            .as_millis() as u64;
        let entry = Entry {
            id,
            text: String::new(),
            created_at,
        };
        self.save("active.json", &entry)?;
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
        if self.closed || entry.id != id || sequence <= *previous {
            return Err("Stale recovery checkpoint".into());
        }
        let next = Entry {
            text,
            ..entry.clone()
        };
        self.save("active.json", &next)?;
        self.active = Some((next, sequence));
        Ok(())
    }

    fn finish(&mut self, id: &str) -> Result<(), String> {
        if self
            .active
            .as_ref()
            .is_some_and(|(entry, _)| entry.id == id)
        {
            self.remove("active.json")?;
            self.active = None;
        }
        Ok(())
    }
}

fn with_journal<T>(run: impl FnOnce(&mut Journal) -> Result<T, String>) -> Result<T, String> {
    let mut state = JOURNAL
        .lock()
        .map_err(|_| "Crash recovery state unavailable")?;
    run(state.as_mut().ok_or("Crash recovery is not initialized")?)
}

pub fn initialize(root: &Path) -> Result<(), String> {
    *JOURNAL
        .lock()
        .map_err(|_| "Crash recovery state unavailable")? = Some(Journal::open(root)?);
    Ok(())
}

pub fn clean_exit() {
    if let Err(error) = with_journal(|journal| {
        journal.closed = true;
        journal.remove("active.json")?;
        journal.active = None;
        Ok(())
    }) {
        log::warn!("Crash journal cleanup failed: {error}");
    }
}

pub fn renderer_restarted(epoch: u64) -> Result<(), String> {
    with_journal(|journal| {
        journal.epoch = epoch;
        journal.recover_active()
    })
}

#[tauri::command]
pub async fn get_crash_journal_epoch() -> Result<u64, String> {
    with_journal(|journal| Ok(journal.epoch))
}

#[tauri::command]
pub async fn list_crash_recovery() -> Result<Vec<Entry>, String> {
    with_journal(|journal| Ok(journal.recovered.clone()))
}
#[tauri::command]
pub async fn dismiss_crash_recovery(id: String) -> Result<(), String> {
    with_journal(|journal| journal.dismiss(&id))
}
#[tauri::command]
pub async fn begin_crash_journal(id: String, epoch: u64) -> Result<(), String> {
    with_journal(|journal| {
        journal.check_epoch(epoch)?;
        journal.begin(id)
    })
}
#[tauri::command]
pub async fn update_crash_journal(
    id: String,
    epoch: u64,
    sequence: u64,
    text: String,
) -> Result<(), String> {
    with_journal(|journal| {
        journal.check_epoch(epoch)?;
        journal.update(&id, sequence, text)
    })
}
#[tauri::command]
pub async fn finish_crash_journal(id: String, epoch: u64) -> Result<(), String> {
    with_journal(|journal| {
        journal.check_epoch(epoch)?;
        journal.finish(&id)
    })
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
        assert!(second.read("active.json").unwrap().is_none());
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
        assert_eq!(journal.read("active.json").unwrap().unwrap().id, OTHER);
        assert!(journal.update(OTHER, 1, "x".repeat(MAX_TEXT + 1)).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn private_files_reject_symlinks_hardlinks_and_public_permissions() {
        let root = root();
        let mut journal = Journal::open(&root).unwrap();
        journal.begin(ID.into()).unwrap();
        let file = root.join("voco/crash-recovery/active.json");
        assert_eq!(fs::metadata(&file).unwrap().mode() & 0o777, 0o600);
        fs::hard_link(&file, root.join("link")).unwrap();
        assert!(journal.read("active.json").is_err());
        fs::remove_file(root.join("link")).unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(journal.read("active.json").is_err());
        fs::remove_file(&file).unwrap();
        symlink(root.join("target"), &file).unwrap();
        assert!(journal
            .save(
                "active.json",
                &Entry {
                    id: ID.into(),
                    text: "x".into(),
                    created_at: 1
                }
            )
            .is_err());
        assert!(!root.join("target").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn empty_crash_is_not_review_and_clean_closed_journal_refuses_new_writes() {
        let root = root();
        let mut journal = Journal::open(&root).unwrap();
        journal.begin(ID.into()).unwrap();
        drop(journal);
        let mut journal = Journal::open(&root).unwrap();
        assert!(journal.recovered.is_empty());
        journal.closed = true;
        assert!(journal.begin(OTHER.into()).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn renderer_restart_recovers_old_capture_and_rejects_its_commands() {
        let root = root();
        let mut journal = Journal::open(&root).unwrap();
        journal.epoch = 1;
        journal.begin(ID.into()).unwrap();
        journal
            .update(ID, 1, "Renderer crash fixture".into())
            .unwrap();
        journal.epoch = 2;
        journal.recover_active().unwrap();
        assert!(journal.check_epoch(1).is_err());
        assert!(journal.check_epoch(2).is_ok());
        assert_eq!(journal.recovered[0].id, ID);
        journal.begin(OTHER.into()).unwrap();
        journal.finish(ID).unwrap();
        assert_eq!(journal.active.as_ref().unwrap().0.id, OTHER);
        journal.finish(OTHER).unwrap();
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
        let path = root.join("voco/crash-recovery/recovered.json");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(journal.dismiss(ID).is_err());
        assert_eq!(journal.recovered[0].id, ID);
        assert_eq!(journal.active.as_ref().unwrap().0.id, OTHER);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
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
        let path = root.join("voco/crash-recovery/active.json");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(journal.finish(ID).is_err());
        assert!(journal.begin(OTHER.into()).is_err());
        assert_eq!(journal.active.as_ref().unwrap().0.id, ID);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        journal.finish(ID).unwrap();
        journal.begin(OTHER.into()).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_dates_and_writable_directories_fail_closed() {
        let root = root();
        let journal = Journal::open(&root).unwrap();
        journal
            .save(
                "active.json",
                &Entry {
                    id: ID.into(),
                    text: "fixture".into(),
                    created_at: u64::MAX,
                },
            )
            .unwrap();
        assert!(Journal::open(&root).is_err());
        fs::set_permissions(&root, fs::Permissions::from_mode(0o777)).unwrap();
        assert!(Journal::open(&root).is_err());
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
        assert!(journal.read("active.json").unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
