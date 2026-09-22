//! Post-terminal private audit bundles. No capture callback calls this module.
//! A missing COMMIT.json always means incomplete evidence; partial files remain private.
use crate::digest_hex::digest_hex;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::ffi::CString;
use std::fs::File;
use std::io::Write;
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

const MAX_FILE_BYTES: u64 = 144 * 1024 * 1024;
const MAX_BUNDLE_BYTES: u64 = 384 * 1024 * 1024;
const MAX_METADATA_BYTES: usize = 1024 * 1024;
const FILE_NAMES: &[&str] = &[
    "descriptor.json",
    "journal.json",
    "packets.bin",
    "raw.s16le",
    "source.f32le",
    "renderer.json",
];

fn error(context: &str) -> String {
    format!("{context}: {}", std::io::Error::last_os_error())
}

fn name(value: &str) -> Result<CString, String> {
    CString::new(value).map_err(|_| "Audit path contains a NUL".into())
}

fn directory_at(parent: &File, component: &CString, create: bool) -> Result<File, String> {
    if create {
        let result = unsafe { libc::mkdirat(parent.as_raw_fd(), component.as_ptr(), 0o700) };
        if result != 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::EEXIST) {
            return Err(error("Create audit directory"));
        }
    }
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            component.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(error("Open audit directory without following links"));
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

fn check_directory(file: &File, private: bool, allow_root: bool) -> Result<(), String> {
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    let uid = unsafe { libc::geteuid() };
    if !metadata.is_dir()
        || (metadata.uid() != uid && !(allow_root && metadata.uid() == 0))
        || metadata.mode() & 0o022 != 0
        || (private && metadata.mode() & 0o777 != 0o700)
    {
        return Err("Audit directory must have trusted ownership and non-writable ancestors; private directories require 0700".into());
    }
    Ok(())
}

fn state_directory(path: &Path) -> Result<File, String> {
    if !path.is_absolute() {
        return Err("Audit state path must be absolute".into());
    }
    let mut current = File::open("/").map_err(|e| e.to_string())?;
    for component in path.components() {
        match component {
            Component::RootDir => (),
            Component::Normal(part) => {
                let part = CString::new(part.as_bytes()).map_err(|_| "Invalid state path")?;
                current = directory_at(&current, &part, true)?;
                check_directory(&current, false, true)?;
            }
            _ => return Err("Audit state path must not contain relative traversal".into()),
        }
    }
    check_directory(&current, false, false)?;
    Ok(current)
}

fn root_directory() -> Result<(PathBuf, File), String> {
    let state = match std::env::var_os("XDG_STATE_HOME") {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => dirs::state_dir().ok_or("No user state directory available")?,
    };
    let directory = state_directory(&state)?;
    audit_directory(state, directory)
}

fn audit_directory(state: PathBuf, mut directory: File) -> Result<(PathBuf, File), String> {
    let mut path = state;
    for component in ["voco", "debug-native-captures"] {
        directory = directory_at(&directory, &name(component)?, true)?;
        // The existing shared VOCO state parent may be 0755; do not chmod it.
        check_directory(&directory, component == "debug-native-captures", false)?;
        path.push(component);
    }
    Ok((path, directory))
}

fn nonce() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    let mut filled = 0;
    while filled < bytes.len() {
        let count = unsafe {
            libc::getrandom(bytes[filled..].as_mut_ptr().cast(), bytes.len() - filled, 0)
        };
        if count < 0 {
            if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error("Generate audit bundle identity"));
        }
        if count == 0 {
            return Err("Audit bundle identity generator returned no bytes".into());
        }
        filled += count as usize;
    }
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn verify_file(file: &File, directory: &File, filename: &str) -> Result<(), String> {
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o600
        || metadata.nlink() != 1
    {
        return Err("Audit file must be an owned 0600 regular file with exactly one link".into());
    }
    let mut entry = std::mem::MaybeUninit::<libc::stat>::uninit();
    let filename = name(filename)?;
    if unsafe {
        libc::fstatat(
            directory.as_raw_fd(),
            filename.as_ptr(),
            entry.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        return Err(error("Verify audit directory entry"));
    }
    let entry = unsafe { entry.assume_init() };
    if entry.st_ino != metadata.ino() || entry.st_dev != metadata.dev() {
        return Err("Audit directory entry was replaced".into());
    }
    Ok(())
}

pub struct BundleWriter {
    directory: File,
    files: Map<String, Value>,
    total_bytes: u64,
    failed: bool,
    handles: Vec<(String, File)>,
}

impl BundleWriter {
    fn create_file(&self, filename: &str) -> Result<File, String> {
        let filename = name(filename)?;
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                filename.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err(error("Create exclusive audit file"));
        }
        Ok(unsafe { File::from_raw_fd(fd) })
    }

    pub fn write_file(&mut self, filename: &str, bytes: &[u8]) -> Result<(), String> {
        self.write_file_chunks(filename, std::iter::once(bytes))
    }

    pub fn write_file_chunks<'a>(
        &mut self,
        filename: &str,
        chunks: impl IntoIterator<Item = &'a [u8]>,
    ) -> Result<(), String> {
        if self.failed {
            return Err("Audit bundle already failed".into());
        }
        let result = self.write_chunks_inner(filename, chunks);
        if result.is_err() {
            self.failed = true;
        }
        result
    }

    fn write_chunks_inner<'a>(
        &mut self,
        filename: &str,
        chunks: impl IntoIterator<Item = &'a [u8]>,
    ) -> Result<(), String> {
        if !FILE_NAMES.contains(&filename) || self.files.contains_key(filename) {
            return Err("Unknown or duplicate audit filename".into());
        }
        let mut file = self.create_file(filename)?;
        verify_file(&file, &self.directory, filename)?;
        let mut hash = Sha256::new();
        let mut bytes = 0u64;
        for chunk in chunks {
            bytes = bytes
                .checked_add(chunk.len() as u64)
                .ok_or("Audit file size overflow")?;
            let total = self
                .total_bytes
                .checked_add(bytes)
                .ok_or("Audit bundle size overflow")?;
            if bytes > MAX_FILE_BYTES || total > MAX_BUNDLE_BYTES {
                return Err("Audit file or bundle exceeds its bounded storage limit".into());
            }
            file.write_all(chunk)
                .map_err(|e| format!("Write audit file: {e}"))?;
            hash.update(chunk);
        }
        file.sync_all()
            .map_err(|e| format!("Sync audit file: {e}"))?;
        verify_file(&file, &self.directory, filename)?;
        self.total_bytes += bytes;
        self.files.insert(
            filename.into(),
            json!({"sha256": digest_hex(hash.finalize()), "bytes": bytes}),
        );
        self.handles.push((filename.into(), file));
        Ok(())
    }
}

fn write_at(
    root_path: &Path,
    root: &File,
    kind: &str,
    unique: &str,
    commit_metadata: Value,
    write: impl FnOnce(&mut BundleWriter) -> Result<(), String>,
) -> Result<PathBuf, String> {
    if !matches!(kind, "native" | "renderer")
        || unique.len() != 32
        || !unique.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Invalid audit bundle kind or identity".into());
    }
    let mut metadata = commit_metadata
        .as_object()
        .cloned()
        .ok_or("Audit metadata must be an object")?;
    let complete = metadata
        .remove("complete")
        .and_then(|v| v.as_bool())
        .ok_or("Audit metadata requires complete boolean")?;
    if serde_json::to_vec(&metadata)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_METADATA_BYTES
    {
        return Err("Audit commit metadata exceeds 1MiB".into());
    }
    check_directory(root, true, false)?;
    let bundle_name = format!("{kind}-{unique}");
    let component = name(&bundle_name)?;
    if unsafe { libc::mkdirat(root.as_raw_fd(), component.as_ptr(), 0o700) } != 0 {
        return Err(error("Create exclusive audit bundle"));
    }
    let directory = directory_at(root, &component, false)?;
    check_directory(&directory, true, false)?;
    let mut writer = BundleWriter {
        directory,
        files: Map::new(),
        total_bytes: 0,
        failed: false,
        handles: Vec::new(),
    };
    write(&mut writer)?;
    if writer.failed {
        return Err("Failed audit bundle cannot commit".into());
    }
    let required: &[&str] = if kind == "native" {
        &[
            "descriptor.json",
            "journal.json",
            "packets.bin",
            "raw.s16le",
        ]
    } else {
        &["source.f32le", "renderer.json"]
    };
    if required.iter().any(|key| !writer.files.contains_key(*key))
        || writer.files.keys().any(|key| {
            !(required.contains(&key.as_str()) || (kind == "renderer" && key == "descriptor.json"))
        })
    {
        return Err("Audit bundle file set does not match its kind".into());
    }
    for (filename, file) in &writer.handles {
        verify_file(file, &writer.directory, filename)?;
    }
    writer
        .directory
        .sync_all()
        .map_err(|e| format!("Sync audit payload directory: {e}"))?;
    let commit = json!({"schemaVersion":1,"kind":kind,"complete":complete,"metadata":metadata,"files":writer.files});
    let bytes = serde_json::to_vec_pretty(&commit).map_err(|e| e.to_string())?;
    root.sync_all()
        .map_err(|e| format!("Sync audit root: {e}"))?;
    let mut file = writer.create_file("COMMIT.pending")?;
    file.write_all(&bytes)
        .map_err(|e| format!("Write audit commit: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Sync audit commit: {e}"))?;
    verify_file(&file, &writer.directory, "COMMIT.pending")?;
    let pending = name("COMMIT.pending")?;
    let final_name = name("COMMIT.json")?;
    if unsafe {
        libc::renameat2(
            writer.directory.as_raw_fd(),
            pending.as_ptr(),
            writer.directory.as_raw_fd(),
            final_name.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    } != 0
    {
        return Err(error("Publish exclusive audit commit"));
    }
    let persisted = verify_file(&file, &writer.directory, "COMMIT.json").and_then(|()| {
        writer
            .directory
            .sync_all()
            .map_err(|e| format!("Sync audit bundle: {e}"))
    });
    if let Err(failure) = persisted {
        // Remove only our still-verified entry; never remove a replacement path.
        verify_file(&file, &writer.directory, "COMMIT.json")
            .map_err(|e| format!("{failure}; commit removal unsafe: {e}"))?;
        if unsafe { libc::unlinkat(writer.directory.as_raw_fd(), final_name.as_ptr(), 0) } != 0 {
            return Err(format!(
                "{failure}; {}",
                error("Remove unconfirmed audit commit")
            ));
        }
        writer
            .directory
            .sync_all()
            .map_err(|e| format!("{failure}; persist commit removal: {e}"))?;
        return Err(failure);
    }
    Ok(root_path.join(bundle_name))
}

pub fn write_bundle_streaming(
    kind: &str,
    commit_metadata: Value,
    write: impl FnOnce(&mut BundleWriter) -> Result<(), String>,
) -> Result<PathBuf, String> {
    let (path, directory) = root_directory()?;
    write_at(&path, &directory, kind, &nonce()?, commit_metadata, write)
}

pub fn write_bundle(
    kind: &str,
    files: &[(&str, &[u8])],
    commit_metadata: Value,
) -> Result<PathBuf, String> {
    write_bundle_streaming(kind, commit_metadata, |writer| {
        for (name, bytes) in files {
            writer.write_file(name, bytes)?;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, DirBuilderExt, PermissionsExt};

    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("voco-private-bundle-test-{}", nonce().unwrap()));
            std::fs::DirBuilder::new()
                .mode(0o700)
                .create(&path)
                .unwrap();
            Self(path)
        }
        fn root(&self) -> File {
            File::open(&self.0).unwrap()
        }
        fn bundle(&self) -> PathBuf {
            self.0.join(format!("renderer-{}", "a".repeat(32)))
        }
        fn run(
            &self,
            write: impl FnOnce(&mut BundleWriter) -> Result<(), String>,
        ) -> Result<PathBuf, String> {
            write_at(
                &self.0,
                &self.root(),
                "renderer",
                &"a".repeat(32),
                json!({"complete":true,"captureId":"native-test"}),
                write,
            )
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn renderer(writer: &mut BundleWriter) -> Result<(), String> {
        writer.write_file("renderer.json", b"{}")?;
        writer.write_file_chunks("source.f32le", [b"abcd".as_slice(), b"efgh".as_slice()])
    }

    #[test]
    fn streamed_files_have_exact_hashes_lengths_and_private_commit() {
        let temp = Temp::new();
        let bundle = temp.run(renderer).unwrap();
        let commit: Value =
            serde_json::from_slice(&std::fs::read(bundle.join("COMMIT.json")).unwrap()).unwrap();
        assert_eq!(commit.as_object().unwrap().len(), 5);
        assert_eq!(commit["complete"], true);
        assert_eq!(commit["metadata"]["captureId"], "native-test");
        assert_eq!(commit["files"]["source.f32le"]["bytes"], 8);
        assert_eq!(
            commit["files"]["source.f32le"]["sha256"],
            digest_hex(Sha256::digest(b"abcdefgh"))
        );
        assert_eq!(std::fs::metadata(&bundle).unwrap().mode() & 0o777, 0o700);
        for entry in std::fs::read_dir(bundle).unwrap() {
            let metadata = entry.unwrap().metadata().unwrap();
            assert_eq!(metadata.mode() & 0o777, 0o600);
            assert_eq!(metadata.nlink(), 1);
        }
    }

    #[test]
    fn directory_symlink_is_not_followed_and_writable_root_rejected() {
        let temp = Temp::new();
        let target = Temp::new();
        symlink(&target.0, temp.0.join("linked")).unwrap();
        assert!(directory_at(&temp.root(), &name("linked").unwrap(), true).is_err());
        std::fs::set_permissions(&temp.0, std::fs::Permissions::from_mode(0o770)).unwrap();
        assert!(temp.run(renderer).is_err());
        assert!(!temp.bundle().exists());
    }

    #[test]
    fn shared_state_parent_may_be_0755_but_private_audit_root_must_be_0700() {
        let temp = Temp::new();
        let shared = temp.0.join("voco");
        std::fs::create_dir(&shared).unwrap();
        std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(0o755)).unwrap();
        let (path, directory) = audit_directory(temp.0.clone(), temp.root()).unwrap();
        assert_eq!(std::fs::metadata(&shared).unwrap().mode() & 0o777, 0o755);
        assert_eq!(directory.metadata().unwrap().mode() & 0o777, 0o700);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(audit_directory(temp.0.clone(), temp.root()).is_err());
    }

    #[test]
    fn bundle_byte_limit_failure_cannot_commit() {
        let temp = Temp::new();
        assert!(temp
            .run(|writer| {
                writer.total_bytes = MAX_BUNDLE_BYTES;
                writer.write_file("renderer.json", b"x")
            })
            .is_err());
        assert!(!temp.bundle().join("COMMIT.json").exists());
    }

    #[test]
    fn collision_never_changes_existing_bundle() {
        let temp = Temp::new();
        let bundle = temp.run(renderer).unwrap();
        let before = std::fs::read(bundle.join("COMMIT.json")).unwrap();
        assert!(temp.run(renderer).is_err());
        assert_eq!(before, std::fs::read(bundle.join("COMMIT.json")).unwrap());
    }

    #[test]
    fn file_symlink_and_hardlink_are_rejected_without_commit() {
        let temp = Temp::new();
        assert!(temp
            .run(|writer| {
                symlink("/etc/passwd", temp.bundle().join("source.f32le")).unwrap();
                renderer(writer)
            })
            .is_err());
        assert!(!temp.bundle().join("COMMIT.json").exists());
        let temp = Temp::new();
        assert!(temp
            .run(|writer| {
                renderer(writer)?;
                std::fs::hard_link(temp.bundle().join("source.f32le"), temp.0.join("alias"))
                    .unwrap();
                Ok(())
            })
            .is_err());
        assert!(!temp.bundle().join("COMMIT.json").exists());
    }

    #[test]
    fn partial_callback_failure_leaves_no_commit_and_no_overwrite() {
        let temp = Temp::new();
        assert!(temp
            .run(|writer| {
                writer.write_file("renderer.json", b"original")?;
                Err("Injected writer interruption".into())
            })
            .is_err());
        assert_eq!(
            std::fs::read(temp.bundle().join("renderer.json")).unwrap(),
            b"original"
        );
        assert!(!temp.bundle().join("COMMIT.json").exists());
    }

    #[test]
    fn swallowed_duplicate_failure_still_poisons_bundle() {
        let temp = Temp::new();
        assert!(temp
            .run(|writer| {
                renderer(writer)?;
                assert!(writer.write_file("renderer.json", b"replacement").is_err());
                Ok(())
            })
            .is_err());
        assert_eq!(
            std::fs::read(temp.bundle().join("renderer.json")).unwrap(),
            b"{}"
        );
        assert!(!temp.bundle().join("COMMIT.json").exists());
    }

    #[test]
    fn path_traversal_and_missing_files_cannot_commit() {
        let temp = Temp::new();
        assert!(temp
            .run(|writer| writer.write_file("../escape", b"x"))
            .is_err());
        assert!(!temp.0.join("escape").exists());
        let temp = Temp::new();
        assert!(temp
            .run(|writer| writer.write_file("renderer.json", b"{}"))
            .is_err());
        assert!(!temp.bundle().join("COMMIT.json").exists());
    }

    #[test]
    fn changed_permissions_and_inode_replacement_reject_commit() {
        let temp = Temp::new();
        assert!(temp
            .run(|writer| {
                renderer(writer)?;
                std::fs::set_permissions(
                    temp.bundle().join("source.f32le"),
                    std::fs::Permissions::from_mode(0o644),
                )
                .unwrap();
                Ok(())
            })
            .is_err());
        assert!(!temp.bundle().join("COMMIT.json").exists());
        let temp = Temp::new();
        assert!(temp
            .run(|writer| {
                renderer(writer)?;
                std::fs::rename(
                    temp.bundle().join("source.f32le"),
                    temp.bundle().join("old"),
                )
                .unwrap();
                std::fs::write(temp.bundle().join("source.f32le"), b"different").unwrap();
                Ok(())
            })
            .is_err());
        assert!(!temp.bundle().join("COMMIT.json").exists());
    }

    #[test]
    fn incomplete_metadata_is_honest_and_missing_boolean_rejected() {
        let temp = Temp::new();
        assert!(write_at(
            &temp.0,
            &temp.root(),
            "renderer",
            &"b".repeat(32),
            json!({}),
            renderer
        )
        .is_err());
        assert_eq!(std::fs::read_dir(&temp.0).unwrap().count(), 0);
        let path = write_at(
            &temp.0,
            &temp.root(),
            "renderer",
            &"b".repeat(32),
            json!({"complete":false,"reason":"cancelled"}),
            renderer,
        )
        .unwrap();
        let commit: Value =
            serde_json::from_slice(&std::fs::read(path.join("COMMIT.json")).unwrap()).unwrap();
        assert_eq!(commit["complete"], false);
        assert_eq!(commit["metadata"]["reason"], "cancelled");
    }
}
