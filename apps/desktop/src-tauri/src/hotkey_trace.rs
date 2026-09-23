//! Explicitly enabled local timing metadata. The default event path never opens a file.
use std::ffi::{CStr, OsStr};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

const FILE_LIMIT: u64 = 8 * 1024 * 1024;
#[cfg(test)]
const PREVIOUS_FILE: &str = "hotkey-trace.previous.jsonl";
const CURRENT_NAME: &[u8] = b"hotkey-trace.jsonl\0";
const PREVIOUS_NAME: &[u8] = b"hotkey-trace.previous.jsonl\0";
static FILE_LOCK: Mutex<()> = Mutex::new(());
static WRITE_DISABLED: AtomicBool = AtomicBool::new(false);

pub(super) fn append(path: &Path, line: &[u8]) -> io::Result<()> {
    append_guarded(path, line, FILE_LIMIT, Some(&WRITE_DISABLED))
}

#[cfg(test)]
fn append_with_limit(path: &Path, line: &[u8], limit: u64) -> io::Result<()> {
    append_guarded(path, line, limit, None)
}

fn append_guarded(
    path: &Path,
    line: &[u8],
    limit: u64,
    disabled: Option<&AtomicBool>,
) -> io::Result<()> {
    let _guard = FILE_LOCK.lock().map_err(|_| {
        if let Some(flag) = disabled {
            flag.store(true, Ordering::Relaxed);
        }
        io::Error::other("hotkey trace writer lock is unavailable")
    })?;
    if disabled.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return Ok(());
    }
    let result = append_locked(path, line, limit);
    if result.is_err() {
        if let Some(flag) = disabled {
            flag.store(true, Ordering::Relaxed);
        }
    }
    result
}

fn append_locked(path: &Path, line: &[u8], limit: u64) -> io::Result<()> {
    let directory = path
        .parent()
        .ok_or_else(|| io::Error::other("hotkey trace has no directory"))?;
    if path.file_name() != Some(OsStr::new("hotkey-trace.jsonl")) {
        return Err(io::Error::other("unexpected hotkey trace file name"));
    }
    // Keep this directory descriptor through open and rename, so a parent path
    // swap after validation cannot redirect a write to another directory.
    let directory = private_directory(directory)?;
    let bytes =
        line.len()
            .checked_add(1)
            .ok_or_else(|| io::Error::other("hotkey trace event length overflow"))? as u64;
    if bytes > limit {
        return Err(io::Error::other("hotkey trace event exceeds file limit"));
    }

    let mut file = private_file(&directory)?;
    let _previous = private_previous(&directory, limit)?;
    // Preserve oversized legacy diagnostics for the owner to archive or remove.
    // No new record is appended and no oversized file is rotated.
    let current_len = file.metadata()?.len();
    if current_len > limit {
        return Err(io::Error::other(
            "existing hotkey trace exceeds file limit; archive or remove it before enabling trace",
        ));
    }
    if current_len.saturating_add(bytes) > limit {
        drop(file);
        let current_name = CStr::from_bytes_with_nul(CURRENT_NAME).unwrap();
        let previous_name = CStr::from_bytes_with_nul(PREVIOUS_NAME).unwrap();
        if unsafe {
            libc::renameat(
                directory.as_raw_fd(),
                current_name.as_ptr(),
                directory.as_raw_fd(),
                previous_name.as_ptr(),
            )
        } != 0
        {
            return Err(io::Error::last_os_error());
        }
        file = private_file(&directory)?;
    }
    file.write_all(line)?;
    file.write_all(b"\n")
}

fn private_directory(path: &Path) -> io::Result<File> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)?;
    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    let metadata = directory.metadata()?;
    if !metadata.is_dir() || metadata.uid() != unsafe { libc::geteuid() } {
        return Err(io::Error::other(
            "hotkey trace directory must be an owned directory, not a symlink",
        ));
    }
    if metadata.mode() & 0o077 != 0 {
        // Existing pre-opt-in state directories may have inherited a loose umask.
        if unsafe { libc::fchmod(directory.as_raw_fd(), 0o700) } != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(directory)
}

fn private_file(directory: &File) -> io::Result<File> {
    let name = CStr::from_bytes_with_nul(CURRENT_NAME).unwrap();
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_WRONLY
                | libc::O_APPEND
                | libc::O_CREAT
                | libc::O_NOFOLLOW
                | libc::O_NONBLOCK
                | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let file = unsafe { File::from_raw_fd(fd) };
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.uid() != unsafe { libc::geteuid() } || metadata.nlink() != 1
    {
        return Err(io::Error::other(
            "hotkey trace must be an owned regular file with one link",
        ));
    }
    if metadata.mode() & 0o077 != 0 {
        // Tighten a legacy trace in place only after checking owner and link count.
        if unsafe { libc::fchmod(file.as_raw_fd(), 0o600) } != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(file)
}

fn private_previous(directory: &File, limit: u64) -> io::Result<Option<File>> {
    let name = CStr::from_bytes_with_nul(PREVIOUS_NAME).unwrap();
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_WRONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        let error = io::Error::last_os_error();
        return if error.kind() == io::ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(error)
        };
    }
    let file = unsafe { File::from_raw_fd(fd) };
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.uid() != unsafe { libc::geteuid() } || metadata.nlink() != 1
    {
        return Err(io::Error::other(
            "previous hotkey trace must be an owned regular file with one link",
        ));
    }
    if metadata.mode() & 0o077 != 0 && unsafe { libc::fchmod(file.as_raw_fd(), 0o600) } != 0 {
        return Err(io::Error::last_os_error());
    }
    if metadata.len() > limit {
        return Err(io::Error::other(
            "previous hotkey trace exceeds file limit; archive or remove it before enabling trace",
        ));
    }
    Ok(Some(file))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempRoot(PathBuf);
    impl TempRoot {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "voco-hotkey-trace-test-{}-{nonce}",
                std::process::id()
            ));
            fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            Self(root)
        }
        fn trace(&self) -> PathBuf {
            self.0.join("voco/hotkey-trace.jsonl")
        }
    }
    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn creates_private_trace_and_tightens_legacy_permissions() {
        let root = TempRoot::new();
        let path = root.trace();
        append_with_limit(&path, b"{\"event\":\"first\"}", 64).unwrap();
        assert_eq!(
            fs::metadata(path.parent().unwrap()).unwrap().mode() & 0o777,
            0o700
        );
        assert_eq!(fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
        fs::set_permissions(path.parent().unwrap(), fs::Permissions::from_mode(0o775)).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o664)).unwrap();
        append_with_limit(&path, b"{\"event\":\"second\"}", 64).unwrap();
        assert_eq!(
            fs::metadata(path.parent().unwrap()).unwrap().mode() & 0o777,
            0o700
        );
        assert_eq!(fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
    }

    #[test]
    fn rejects_symlink_and_hardlink_targets_without_mutating_them() {
        let root = TempRoot::new();
        let path = root.trace();
        fs::create_dir(path.parent().unwrap()).unwrap();
        let sentinel = root.0.join("sentinel");
        fs::write(&sentinel, b"unchanged").unwrap();
        symlink(&sentinel, &path).unwrap();
        assert!(append_with_limit(&path, b"event", 64).is_err());
        assert_eq!(fs::read(&sentinel).unwrap(), b"unchanged");
        fs::remove_file(&path).unwrap();
        fs::hard_link(&sentinel, &path).unwrap();
        assert!(append_with_limit(&path, b"event", 64).is_err());
        assert_eq!(fs::read(&sentinel).unwrap(), b"unchanged");
    }

    #[test]
    fn rejects_symlink_directory_and_previous_file() {
        let root = TempRoot::new();
        let path = root.trace();
        let outside = root.0.join("outside");
        fs::create_dir(&outside).unwrap();
        symlink(&outside, path.parent().unwrap()).unwrap();
        assert!(append_with_limit(&path, b"event", 64).is_err());
        assert!(!outside.join("hotkey-trace.jsonl").exists());
        fs::remove_file(path.parent().unwrap()).unwrap();
        append_with_limit(&path, b"123456789", 16).unwrap();
        let previous = path.parent().unwrap().join(PREVIOUS_FILE);
        symlink(&outside, &previous).unwrap();
        assert!(append_with_limit(&path, b"123456789", 16).is_err());
        fs::remove_file(&previous).unwrap();
        let sentinel = root.0.join("sentinel");
        fs::write(&sentinel, b"unchanged").unwrap();
        fs::hard_link(&sentinel, &previous).unwrap();
        assert!(append_with_limit(&path, b"123456789", 16).is_err());
        assert_eq!(fs::read(&sentinel).unwrap(), b"unchanged");
    }

    #[test]
    fn open_directory_handle_prevents_path_swap_redirection() {
        let root = TempRoot::new();
        let path = root.trace();
        let directory = private_directory(path.parent().unwrap()).unwrap();
        let moved = root.0.join("moved-voco");
        fs::rename(path.parent().unwrap(), &moved).unwrap();
        let outside = root.0.join("outside");
        fs::create_dir(&outside).unwrap();
        symlink(&outside, path.parent().unwrap()).unwrap();
        let mut file = private_file(&directory).unwrap();
        file.write_all(b"metadata\n").unwrap();
        drop(file);
        assert_eq!(
            fs::read(moved.join("hotkey-trace.jsonl")).unwrap(),
            b"metadata\n"
        );
        assert!(!outside.join("hotkey-trace.jsonl").exists());
    }

    #[test]
    fn retains_only_current_and_previous_bounded_files() {
        let root = TempRoot::new();
        let path = root.trace();
        for _ in 0..12 {
            append_with_limit(&path, b"123456789", 20).unwrap();
        }
        let previous = path.parent().unwrap().join(PREVIOUS_FILE);
        assert_eq!(fs::read(&path).unwrap(), b"123456789\n123456789\n");
        assert_eq!(fs::read(&previous).unwrap(), b"123456789\n123456789\n");
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 2);
        assert!(append_with_limit(&path, b"12345678901234567890", 20).is_err());
    }

    #[test]
    fn preserves_oversized_legacy_files_without_appending() {
        let root = TempRoot::new();
        let path = root.trace();
        fs::create_dir(path.parent().unwrap()).unwrap();
        fs::write(&path, b"1234567890123456789012345").unwrap();
        let previous = path.parent().unwrap().join(PREVIOUS_FILE);
        fs::write(&previous, b"1234567890123456789012345").unwrap();
        fs::set_permissions(&previous, fs::Permissions::from_mode(0o664)).unwrap();
        let error = append_with_limit(&path, b"new", 20).unwrap_err();
        assert!(error.to_string().contains("previous hotkey trace exceeds"));
        assert_eq!(fs::read(&path).unwrap(), b"1234567890123456789012345");
        assert_eq!(fs::read(&previous).unwrap(), b"1234567890123456789012345");
        assert_eq!(fs::metadata(&previous).unwrap().mode() & 0o777, 0o600);
        fs::remove_file(&previous).unwrap();
        let error = append_with_limit(&path, b"new", 20).unwrap_err();
        assert!(error.to_string().contains("existing hotkey trace exceeds"));
        assert_eq!(fs::read(&path).unwrap(), b"1234567890123456789012345");
    }

    #[test]
    fn optional_writer_stops_after_one_unsafe_target_error() {
        let root = TempRoot::new();
        let path = root.trace();
        fs::create_dir(path.parent().unwrap()).unwrap();
        let sentinel = root.0.join("sentinel");
        fs::write(&sentinel, b"unchanged").unwrap();
        symlink(&sentinel, &path).unwrap();
        let disabled = AtomicBool::new(false);
        assert!(append_guarded(&path, b"first", 64, Some(&disabled)).is_err());
        assert!(disabled.load(Ordering::Relaxed));
        fs::remove_file(&path).unwrap();
        assert!(append_guarded(&path, b"second", 64, Some(&disabled)).is_ok());
        assert!(!path.exists());
        assert_eq!(fs::read(&sentinel).unwrap(), b"unchanged");
    }
}
