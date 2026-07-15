#[cfg(target_os = "linux")]
mod linux {
    use std::env;
    use std::fmt;
    use std::fs::{self, DirBuilder, File, OpenOptions};
    use std::io;
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
    use std::os::unix::io::AsRawFd;
    use std::path::{Path, PathBuf};

    const APP_RUNTIME_DIRECTORY: &str = "voco";
    const INSTANCE_LOCK_FILENAME: &str = "instance.lock";
    const FALLBACK_RUNTIME_ROOT: &str = "/tmp";

    /// Owns VOCO's process lock. The file must stay open for the full process
    /// lifetime because `flock(2)` releases the lock when this open file
    /// description is closed.
    #[derive(Debug)]
    pub struct SingleInstanceGuard {
        _lock_file: File,
    }

    #[derive(Debug)]
    pub enum SingleInstanceError {
        AlreadyRunning {
            path: PathBuf,
        },
        UnsafePath {
            path: PathBuf,
            reason: String,
        },
        Io {
            operation: &'static str,
            path: PathBuf,
            source: io::Error,
        },
    }

    impl fmt::Display for SingleInstanceError {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            match self {
                Self::AlreadyRunning { path } => write!(
                    formatter,
                    "another VOCO instance is already running (instance lock: {})",
                    path.display()
                ),
                Self::UnsafePath { path, reason } => write!(
                    formatter,
                    "refusing to use unsafe VOCO runtime path {}: {reason}",
                    path.display()
                ),
                Self::Io {
                    operation,
                    path,
                    source,
                } => write!(
                    formatter,
                    "could not {operation} {}: {source}",
                    path.display()
                ),
            }
        }
    }

    impl std::error::Error for SingleInstanceError {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            match self {
                Self::Io { source, .. } => Some(source),
                Self::AlreadyRunning { .. } | Self::UnsafePath { .. } => None,
            }
        }
    }

    pub fn acquire() -> Result<SingleInstanceGuard, SingleInstanceError> {
        let effective_uid = unsafe { libc::geteuid() };
        let runtime_dir = resolve_runtime_directory(
            env::var_os("XDG_RUNTIME_DIR").as_deref(),
            effective_uid,
            Path::new(FALLBACK_RUNTIME_ROOT),
        )?;
        acquire_at(runtime_dir.join(INSTANCE_LOCK_FILENAME), effective_uid)
    }

    fn resolve_runtime_directory(
        xdg_runtime_dir: Option<&std::ffi::OsStr>,
        effective_uid: libc::uid_t,
        fallback_root: &Path,
    ) -> Result<PathBuf, SingleInstanceError> {
        if let Some(raw_runtime_dir) = xdg_runtime_dir {
            let runtime_root = PathBuf::from(raw_runtime_dir);
            if runtime_root.is_absolute()
                && validate_private_directory(&runtime_root, effective_uid).is_ok()
            {
                let app_runtime_dir = runtime_root.join(APP_RUNTIME_DIRECTORY);
                if ensure_private_directory(&app_runtime_dir, effective_uid).is_ok() {
                    return Ok(app_runtime_dir);
                }
            }
        }

        validate_fallback_root(fallback_root, effective_uid)?;
        let fallback_dir = fallback_root.join(format!("voco-{effective_uid}"));
        ensure_private_directory(&fallback_dir, effective_uid)?;
        Ok(fallback_dir)
    }

    fn validate_fallback_root(
        path: &Path,
        effective_uid: libc::uid_t,
    ) -> Result<(), SingleInstanceError> {
        let metadata = fs::symlink_metadata(path).map_err(|source| SingleInstanceError::Io {
            operation: "inspect fallback runtime directory",
            path: path.to_path_buf(),
            source,
        })?;

        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(SingleInstanceError::UnsafePath {
                path: path.to_path_buf(),
                reason: "the fallback root is not a real directory".to_string(),
            });
        }

        let mode = metadata.mode() & 0o7777;
        let private_user_directory =
            metadata.uid() == effective_uid && mode & 0o077 == 0 && mode & 0o300 == 0o300;
        let sticky_shared_directory = mode & 0o1000 != 0 && mode & 0o002 != 0;
        if !private_user_directory && !sticky_shared_directory {
            return Err(SingleInstanceError::UnsafePath {
                path: path.to_path_buf(),
                reason: "the fallback root is neither private nor a sticky shared directory"
                    .to_string(),
            });
        }

        Ok(())
    }

    fn ensure_private_directory(
        path: &Path,
        effective_uid: libc::uid_t,
    ) -> Result<(), SingleInstanceError> {
        match DirBuilder::new().mode(0o700).create(path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(source) => {
                return Err(SingleInstanceError::Io {
                    operation: "create private runtime directory for",
                    path: path.to_path_buf(),
                    source,
                });
            }
        }

        validate_private_directory(path, effective_uid)
    }

    fn validate_private_directory(
        path: &Path,
        effective_uid: libc::uid_t,
    ) -> Result<(), SingleInstanceError> {
        let metadata = fs::symlink_metadata(path).map_err(|source| SingleInstanceError::Io {
            operation: "inspect runtime directory for",
            path: path.to_path_buf(),
            source,
        })?;

        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(SingleInstanceError::UnsafePath {
                path: path.to_path_buf(),
                reason: "the path is not a real directory".to_string(),
            });
        }
        if metadata.uid() != effective_uid {
            return Err(SingleInstanceError::UnsafePath {
                path: path.to_path_buf(),
                reason: "the directory is not owned by the current user".to_string(),
            });
        }

        let mode = metadata.mode() & 0o777;
        if mode & 0o077 != 0 || mode & 0o300 != 0o300 {
            return Err(SingleInstanceError::UnsafePath {
                path: path.to_path_buf(),
                reason: format!("expected a private, writable directory; found mode {mode:04o}"),
            });
        }

        Ok(())
    }

    fn acquire_at(
        lock_path: PathBuf,
        effective_uid: libc::uid_t,
    ) -> Result<SingleInstanceGuard, SingleInstanceError> {
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create(true)
            .mode(0o600)
            .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW);
        let lock_file = options
            .open(&lock_path)
            .map_err(|source| SingleInstanceError::Io {
                operation: "securely open",
                path: lock_path.clone(),
                source,
            })?;

        let metadata = lock_file
            .metadata()
            .map_err(|source| SingleInstanceError::Io {
                operation: "inspect",
                path: lock_path.clone(),
                source,
            })?;
        if !metadata.is_file() || metadata.uid() != effective_uid || metadata.nlink() != 1 {
            return Err(SingleInstanceError::UnsafePath {
                path: lock_path,
                reason: "the lock must be a regular, singly linked file owned by the current user"
                    .to_string(),
            });
        }

        let chmod_result = unsafe { libc::fchmod(lock_file.as_raw_fd(), 0o600) };
        if chmod_result != 0 {
            return Err(SingleInstanceError::Io {
                operation: "secure permissions on",
                path: lock_path,
                source: io::Error::last_os_error(),
            });
        }

        loop {
            let lock_result =
                unsafe { libc::flock(lock_file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
            if lock_result == 0 {
                break;
            }

            let source = io::Error::last_os_error();
            if source
                .raw_os_error()
                .is_some_and(|code| code == libc::EAGAIN || code == libc::EWOULDBLOCK)
            {
                return Err(SingleInstanceError::AlreadyRunning { path: lock_path });
            }
            if source.raw_os_error() == Some(libc::EINTR) {
                continue;
            }
            return Err(SingleInstanceError::Io {
                operation: "acquire",
                path: lock_path,
                source,
            });
        }

        Ok(SingleInstanceGuard {
            _lock_file: lock_file,
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::os::unix::fs::{symlink, PermissionsExt};
        use std::sync::atomic::{AtomicU64, Ordering};

        static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

        struct TestDirectory(PathBuf);

        impl TestDirectory {
            fn new(label: &str) -> Self {
                let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
                let path = env::temp_dir().join(format!(
                    "voco-single-instance-{label}-{}-{sequence}",
                    std::process::id()
                ));
                DirBuilder::new().mode(0o700).create(&path).unwrap();
                Self(path)
            }
        }

        impl Drop for TestDirectory {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }

        #[test]
        fn lock_is_exclusive_and_released_when_guard_drops() {
            let directory = TestDirectory::new("exclusive");
            let effective_uid = unsafe { libc::geteuid() };
            let lock_path = directory.0.join(INSTANCE_LOCK_FILENAME);

            let first = acquire_at(lock_path.clone(), effective_uid).unwrap();
            let contention_error = acquire_at(lock_path.clone(), effective_uid).unwrap_err();
            assert!(matches!(
                &contention_error,
                SingleInstanceError::AlreadyRunning { .. }
            ));
            assert!(contention_error
                .to_string()
                .contains("another VOCO instance is already running"));

            drop(first);
            acquire_at(lock_path, effective_uid).unwrap();
        }

        #[test]
        fn lock_file_is_forced_to_private_permissions() {
            let directory = TestDirectory::new("mode");
            let effective_uid = unsafe { libc::geteuid() };
            let lock_path = directory.0.join(INSTANCE_LOCK_FILENAME);
            OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o666)
                .open(&lock_path)
                .unwrap();
            fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o666)).unwrap();

            let _guard = acquire_at(lock_path.clone(), effective_uid).unwrap();
            assert_eq!(fs::metadata(lock_path).unwrap().mode() & 0o777, 0o600);
        }

        #[test]
        fn lock_file_symlinks_are_rejected() {
            let directory = TestDirectory::new("symlink");
            let effective_uid = unsafe { libc::geteuid() };
            let target = directory.0.join("target");
            File::create(&target).unwrap();
            let lock_path = directory.0.join(INSTANCE_LOCK_FILENAME);
            symlink(target, &lock_path).unwrap();

            assert!(matches!(
                acquire_at(lock_path, effective_uid),
                Err(SingleInstanceError::Io { .. })
            ));
        }

        #[test]
        fn valid_xdg_runtime_directory_is_preferred() {
            let directory = TestDirectory::new("xdg");
            let fallback = TestDirectory::new("fallback");
            let effective_uid = unsafe { libc::geteuid() };

            let selected = resolve_runtime_directory(
                Some(directory.0.as_os_str()),
                effective_uid,
                &fallback.0,
            )
            .unwrap();

            assert_eq!(selected, directory.0.join(APP_RUNTIME_DIRECTORY));
        }

        #[test]
        fn unsafe_xdg_runtime_directory_uses_private_fallback() {
            let directory = TestDirectory::new("unsafe-xdg");
            let fallback = TestDirectory::new("fallback");
            let effective_uid = unsafe { libc::geteuid() };
            fs::set_permissions(&directory.0, fs::Permissions::from_mode(0o755)).unwrap();

            let selected = resolve_runtime_directory(
                Some(directory.0.as_os_str()),
                effective_uid,
                &fallback.0,
            )
            .unwrap();

            assert_eq!(selected, fallback.0.join(format!("voco-{effective_uid}")));
            assert_eq!(fs::metadata(selected).unwrap().mode() & 0o777, 0o700);
        }
    }
}

#[cfg(target_os = "linux")]
pub use linux::acquire;

#[cfg(not(target_os = "linux"))]
#[derive(Debug)]
pub struct SingleInstanceGuard;

#[cfg(not(target_os = "linux"))]
pub fn acquire() -> Result<SingleInstanceGuard, std::convert::Infallible> {
    Ok(SingleInstanceGuard)
}
