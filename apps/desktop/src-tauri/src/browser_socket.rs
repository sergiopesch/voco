//! Same-user, private-runtime transport. This is not a boundary against compromised user processes.
use std::fs;
use std::os::fd::AsRawFd;
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};

pub fn private_directory(path: &Path) -> Result<(), String> {
    let m = fs::symlink_metadata(path)
        .map_err(|_| "Private browser runtime directory is unavailable.")?;
    if !m.is_dir() || m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o077 != 0 {
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
        || m.uid() != unsafe { libc::geteuid() }
        || m.permissions().mode() & 0o077 != 0
    {
        return Err("Browser socket ownership or permissions rejected.".into());
    }
    Ok(())
}
pub fn validate_peer(stream: &UnixStream) -> Result<(), String> {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SO_PEERCRED writes a fixed-size credential structure to the live descriptor.
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut cred as *mut libc::ucred).cast(),
            &mut len,
        )
    };
    if rc != 0
        || len as usize != std::mem::size_of::<libc::ucred>()
        || cred.uid != unsafe { libc::geteuid() }
    {
        return Err("Browser transport peer is not the current user.".into());
    }
    Ok(())
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
    }
}
