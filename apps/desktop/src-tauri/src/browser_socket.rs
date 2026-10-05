//! Same-user, private-runtime transport. This is not a boundary against compromised user processes.
use std::fs;
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};

pub fn private_directory(path: &Path) -> Result<(), String> {
    let m = fs::symlink_metadata(path)
        .map_err(|_| "Private browser runtime directory is unavailable.")?;
    if !m.is_dir() || m.uid() != effective_uid() || m.mode() & 0o077 != 0 {
        return Err(
            "Browser runtime directory must be a private directory owned by this user.".into(),
        );
    }
    Ok(())
}
pub fn socket_path(create: bool) -> Result<PathBuf, String> {
    let runtime = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .ok_or("Private desktop runtime directory is unavailable.")?;
    private_directory(&runtime)?;
    let directory = runtime.join("voco-browser");
    if create {
        use std::os::unix::fs::DirBuilderExt;
        match fs::DirBuilder::new().mode(0o700).create(&directory) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err("Cannot create browser runtime directory.".into()),
        }
    }
    private_directory(&directory)?;
    Ok(directory.join("exact-field.sock"))
}
pub fn validate_socket(path: &Path) -> Result<(), String> {
    private_directory(path.parent().ok_or("Invalid browser socket path.")?)?;
    let m = fs::symlink_metadata(path).map_err(|_| "VOCO browser integration is not running.")?;
    if !m.file_type().is_socket()
        || m.uid() != effective_uid()
        || m.permissions().mode() & 0o077 != 0
    {
        return Err("Browser socket ownership or permissions rejected.".into());
    }
    Ok(())
}
pub fn validate_peer(stream: &UnixStream) -> Result<(), String> {
    match peer_uid(stream) {
        Ok(uid) if uid == effective_uid() => Ok(()),
        _ => Err("Browser transport peer is not the current user.".into()),
    }
}
/// This process's effective user ID, the owner every private file and socket must have.
pub fn effective_uid() -> u32 {
    // SAFETY: geteuid has no preconditions.
    unsafe { libc::geteuid() }
}
/// The peer's user ID as the kernel recorded it. The trigger, activation and IBus
/// sockets share this one SO_PEERCRED check; each keeps its own messages.
pub fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
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
    if length as usize != std::mem::size_of::<libc::ucred>() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Peer credentials were truncated",
        ));
    }
    Ok(credentials.uid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::{fs::symlink, net::UnixListener};
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    #[test]
    fn rejects_public_directory_symlink_regular_file_and_public_socket() {
        let root = std::env::temp_dir().join(format!(
            "voco-browser-socket-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(private_directory(&root).is_ok());
        let alias = root.join("alias");
        symlink(&root, &alias).unwrap();
        assert!(private_directory(&alias).is_err());
        let path = root.join("peer.sock");
        fs::write(&path, b"not a socket").unwrap();
        assert!(validate_socket(&path).is_err());
        fs::remove_file(&path).unwrap();
        let listener = UnixListener::bind(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(validate_socket(&path).is_ok());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();
        assert!(validate_socket(&path).is_err());
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(private_directory(&root).is_err());
        drop(listener);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn accepts_verified_same_user_kernel_peer() {
        let (one, two) = UnixStream::pair().unwrap();
        assert!(validate_peer(&one).is_ok());
        assert!(validate_peer(&two).is_ok());
        assert_eq!(peer_uid(&one).unwrap(), effective_uid());
    }
    #[test]
    fn unverifiable_peer_is_rejected_with_its_os_error() {
        // getsockopt fails with ENOTSOCK on a descriptor that isn't a socket.
        let file = UnixStream::from(std::os::fd::OwnedFd::from(
            fs::File::open("/dev/null").unwrap(),
        ));
        assert_eq!(
            peer_uid(&file).unwrap_err().raw_os_error(),
            Some(libc::ENOTSOCK)
        );
        assert_eq!(
            validate_peer(&file).unwrap_err(),
            "Browser transport peer is not the current user."
        );
    }
}
