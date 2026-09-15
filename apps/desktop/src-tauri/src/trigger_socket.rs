//! Owner-only legacy dictation triggers. Paths preserve the documented XDG/TMPDIR layout.
use std::fs::{self, DirBuilder};
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

static SOCKETS: LazyLock<SocketRegistry> = LazyLock::new(SocketRegistry::default);

fn current_uid() -> u32 {
    // SAFETY: geteuid has no preconditions.
    unsafe { libc::geteuid() }
}

fn rejected(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, message)
}

fn private_directory(path: &Path) -> io::Result<()> {
    if !path.is_absolute() {
        return Err(rejected("Trigger directory must be absolute"));
    }
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir()
        || metadata.uid() != current_uid()
        || metadata.mode() & 0o077 != 0
        || metadata.mode() & 0o300 != 0o300
    {
        return Err(rejected(
            "Trigger directory must be real, owned, private and writable",
        ));
    }
    Ok(())
}

pub fn paths() -> io::Result<[PathBuf; 2]> {
    resolve_paths(std::env::var_os("XDG_RUNTIME_DIR"), &std::env::temp_dir())
}

fn resolve_paths(
    runtime: Option<std::ffi::OsString>,
    temporary: &Path,
) -> io::Result<[PathBuf; 2]> {
    let directory = match runtime {
        Some(value) => PathBuf::from(value),
        None => {
            if !temporary.is_absolute() {
                return Err(rejected("Trigger temporary root must be absolute"));
            }
            let metadata = fs::symlink_metadata(temporary)?;
            let mode = metadata.mode();
            let private =
                metadata.uid() == current_uid() && mode & 0o077 == 0 && mode & 0o300 == 0o300;
            let shared = metadata.uid() == 0 && mode & 0o1000 != 0 && mode & 0o002 != 0;
            if !metadata.is_dir() || !(private || shared) {
                return Err(rejected(
                    "Trigger temporary root must be private or root-owned and sticky",
                ));
            }
            let directory = temporary.join(format!("voco-{}", current_uid()));
            match DirBuilder::new().mode(0o700).create(&directory) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error),
            }
            directory
        }
    };
    private_directory(&directory)?;
    Ok([directory.join("voco.sock"), directory.join("voice.sock")])
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct SocketIdentity {
    device: u64,
    inode: u64,
    owner: u32,
}

impl SocketIdentity {
    fn at(path: &Path) -> io::Result<Self> {
        let metadata = fs::symlink_metadata(path)?;
        if !metadata.file_type().is_socket() || metadata.uid() != current_uid() {
            return Err(rejected(
                "Trigger path is not an owned socket; preserving it",
            ));
        }
        Ok(Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            owner: metadata.uid(),
        })
    }
}

struct BoundSocket {
    path: PathBuf,
    identity: SocketIdentity,
}

impl BoundSocket {
    fn remove_if_unchanged(&self) -> io::Result<()> {
        // Never remove through a now-unsafe parent or unlink a replacement entry.
        private_directory(
            self.path
                .parent()
                .ok_or_else(|| rejected("Missing trigger parent"))?,
        )?;
        match SocketIdentity::at(&self.path) {
            Ok(identity) if identity == self.identity => fs::remove_file(&self.path),
            Ok(_) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

#[derive(Default)]
struct RegistryState {
    stopped: bool,
    bound: Vec<BoundSocket>,
}

#[derive(Default)]
struct SocketRegistry(Mutex<RegistryState>);

impl SocketRegistry {
    fn bind(&self, path: &Path) -> io::Result<UnixListener> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| io::Error::other("Trigger registry lock poisoned"))?;
        if state.stopped {
            return Err(io::Error::other("Trigger listener is shutting down"));
        }
        private_directory(
            path.parent()
                .ok_or_else(|| rejected("Missing trigger parent"))?,
        )?;
        match SocketIdentity::at(path) {
            Ok(identity) => BoundSocket {
                path: path.into(),
                identity,
            }
            .remove_if_unchanged()?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        let listener = UnixListener::bind(path)?;
        let entry = BoundSocket {
            path: path.into(),
            identity: SocketIdentity::at(path)?,
        };
        let secured = (|| {
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
            if SocketIdentity::at(path)? != entry.identity
                || fs::symlink_metadata(path)?.mode() & 0o777 != 0o600
            {
                return Err(rejected(
                    "Trigger socket identity or private permissions changed",
                ));
            }
            Ok(())
        })();
        if let Err(error) = secured {
            let _ = entry.remove_if_unchanged();
            return Err(error);
        }
        state.bound.retain(|previous| previous.path != path);
        state.bound.push(entry);
        Ok(listener)
    }

    fn shutdown(&self) -> io::Result<()> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| io::Error::other("Trigger registry lock poisoned"))?;
        state.stopped = true;
        let mut failure = None;
        for entry in state.bound.drain(..) {
            if let Err(error) = entry.remove_if_unchanged() {
                failure.get_or_insert(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }
}

pub fn bind(path: &Path) -> io::Result<UnixListener> {
    SOCKETS.bind(path)
}

pub fn shutdown() -> io::Result<()> {
    SOCKETS.shutdown()
}

pub fn validate_peer(stream: &UnixStream) -> io::Result<()> {
    let mut credentials = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: the live descriptor and fixed-size output buffer remain valid for getsockopt.
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut credentials as *mut libc::ucred).cast(),
            &mut length,
        )
    };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    if length as usize != std::mem::size_of::<libc::ucred>() || credentials.uid != current_uid() {
        return Err(rejected("Trigger connection is not from the current user"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "voco-trigger-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            DirBuilder::new().mode(0o700).create(&root).unwrap();
            Self(root)
        }
        fn socket(&self) -> PathBuf {
            self.0.join("voco.sock")
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn valid_xdg_and_temporary_locations_are_preserved() {
        let root = Directory::new();
        let xdg = resolve_paths(Some(root.0.as_os_str().into()), Path::new("/unused")).unwrap();
        assert_eq!(xdg, [root.socket(), root.0.join("voice.sock")]);
        let fallback = resolve_paths(None, &root.0).unwrap();
        assert_eq!(
            fallback[0],
            root.0.join(format!("voco-{}/voco.sock", current_uid()))
        );
        assert_eq!(
            fs::metadata(fallback[0].parent().unwrap()).unwrap().mode() & 0o777,
            0o700
        );
    }

    #[test]
    fn relative_unsafe_and_symlink_directories_are_rejected_without_chmod() {
        let root = Directory::new();
        assert!(resolve_paths(Some("relative".into()), &root.0).is_err());
        assert!(resolve_paths(None, Path::new("relative")).is_err());
        let public = root.0.join("public");
        DirBuilder::new().mode(0o755).create(&public).unwrap();
        fs::set_permissions(&public, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(resolve_paths(Some(public.as_os_str().into()), &root.0).is_err());
        assert!(resolve_paths(None, &public).is_err());
        assert!(SocketRegistry::default()
            .bind(&public.join("voco.sock"))
            .is_err());
        assert_eq!(fs::metadata(&public).unwrap().mode() & 0o777, 0o755);
        let alias = root.0.join("alias");
        symlink(&public, &alias).unwrap();
        assert!(resolve_paths(Some(alias.as_os_str().into()), &root.0).is_err());
        assert!(resolve_paths(None, &alias).is_err());
    }

    #[test]
    fn existing_unsafe_fallback_is_preserved_without_chmod() {
        let root = Directory::new();
        let fallback = root.0.join(format!("voco-{}", current_uid()));
        DirBuilder::new().mode(0o755).create(&fallback).unwrap();
        fs::set_permissions(&fallback, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(resolve_paths(None, &root.0).is_err());
        assert_eq!(fs::metadata(&fallback).unwrap().mode() & 0o777, 0o755);
        fs::remove_dir(&fallback).unwrap();
        let target = root.0.join("target");
        DirBuilder::new().mode(0o700).create(&target).unwrap();
        symlink(&target, &fallback).unwrap();
        assert!(resolve_paths(None, &root.0).is_err());
        assert!(fs::symlink_metadata(&fallback)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn regular_file_and_symlink_are_preserved() {
        let root = Directory::new();
        let path = root.socket();
        fs::write(&path, b"owner data").unwrap();
        assert!(SocketRegistry::default().bind(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"owner data");
        fs::remove_file(&path).unwrap();
        let target = root.0.join("target");
        fs::write(&target, b"target data").unwrap();
        symlink(&target, &path).unwrap();
        assert!(SocketRegistry::default().bind(&path).is_err());
        assert!(fs::symlink_metadata(&path)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&target).unwrap(), b"target data");
    }

    #[test]
    fn owned_stale_socket_is_replaced_and_new_socket_is_private() {
        let root = Directory::new();
        let path = root.socket();
        drop(UnixListener::bind(&path).unwrap());
        let registry = SocketRegistry::default();
        let _listener = registry.bind(&path).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
        registry.shutdown().unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn same_user_connection_is_accepted() {
        let root = Directory::new();
        let registry = SocketRegistry::default();
        let listener = registry.bind(&root.socket()).unwrap();
        let _client = UnixStream::connect(root.socket()).unwrap();
        let (peer, _) = listener.accept().unwrap();
        validate_peer(&peer).unwrap();
        registry.shutdown().unwrap();
    }

    #[test]
    fn shutdown_preserves_replacement_socket_inode() {
        let root = Directory::new();
        let registry = SocketRegistry::default();
        let _original = registry.bind(&root.socket()).unwrap();
        fs::remove_file(root.socket()).unwrap();
        let _replacement = UnixListener::bind(root.socket()).unwrap();
        let identity = SocketIdentity::at(&root.socket()).unwrap();
        registry.shutdown().unwrap();
        assert!(SocketIdentity::at(&root.socket()).unwrap() == identity);
    }

    #[test]
    fn shutdown_preserves_replacement_regular_file() {
        let root = Directory::new();
        let registry = SocketRegistry::default();
        let _listener = registry.bind(&root.socket()).unwrap();
        fs::remove_file(root.socket()).unwrap();
        fs::write(root.socket(), b"replacement").unwrap();
        assert!(registry.shutdown().is_err());
        assert_eq!(fs::read(root.socket()).unwrap(), b"replacement");
    }

    #[test]
    fn shutdown_before_bind_does_not_touch_an_existing_socket() {
        let root = Directory::new();
        let _listener = UnixListener::bind(root.socket()).unwrap();
        let registry = SocketRegistry::default();
        registry.shutdown().unwrap();
        assert!(root.socket().exists());
        assert!(registry.bind(&root.socket()).is_err());
        assert!(root.socket().exists());
    }
}
