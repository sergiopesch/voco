//! Installs a VOCO release that Install update downloaded (AGENTS.md,
//! Installer and packages). Only pkexec runs it, through VOCO's own polkit
//! action, which always asks for an administrator's password.
//!
//! It takes two arguments from VOCO, the user's download folder and the release
//! version, and nothing else. It copies the release's three files out of that
//! folder into one only root can change, verifies them there exactly as VOCO
//! and the guided installer do, installs that copy with the system's package
//! manager, and checks that the package manager then reports that release.
//! Each line it prints on stdout starting with `VOCO-UPDATE ` names a stage.
#[path = "../digest_hex.rs"]
mod digest_hex;
#[allow(dead_code)]
#[path = "../update_verify.rs"]
mod update_verify;

use std::ffi::{CString, OsStr};
use std::fs::File;
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use update_verify::{PackageKind, Version, CHECKSUMS, MAX_MANIFEST_BYTES, MAX_PACKAGE_BYTES, SIGNATURE};

/// Root's own staging folder, on disk rather than in memory: a package is
/// about 700 MB. Removed again, once empty, after every run.
const STAGING: &str = "/var/cache/voco-update";
const SYSTEM_PATH: &str = "/usr/sbin:/usr/bin:/sbin:/bin";

/// Exit codes VOCO reads. pkexec itself exits 126 when the password prompt is
/// dismissed and 127 when it isn't allowed, so these stay below them.
const REFUSED: i32 = 10;
const INSTALL_FAILED: i32 = 11;
const NOT_INSTALLED: i32 = 12;

fn main() {
    let code = match run(std::env::args_os().skip(1).collect()) {
        Ok(()) => 0,
        Err((code, message)) => {
            eprintln!("voco-update-helper: {message}");
            code
        }
    };
    std::process::exit(code);
}

type Outcome = Result<(), (i32, String)>;

fn refuse(message: impl Into<String>) -> (i32, String) {
    (REFUSED, message.into())
}

fn stage(name: &str) {
    let mut stdout = io::stdout().lock();
    let _ = writeln!(stdout, "VOCO-UPDATE {name}");
    let _ = stdout.flush();
}

fn run(arguments: Vec<std::ffi::OsString>) -> Outcome {
    let [folder, version] = arguments.as_slice() else {
        return Err(refuse("expected the download folder and the release version"));
    };
    // SAFETY: geteuid has no preconditions.
    if unsafe { libc::geteuid() } != 0 {
        return Err(refuse("runs only as root, through pkexec"));
    }
    let owner: libc::uid_t = std::env::var("PKEXEC_UID")
        .ok()
        .and_then(|uid| uid.parse().ok())
        .ok_or_else(|| refuse("runs only through pkexec"))?;
    let version = version
        .to_str()
        .and_then(Version::parse)
        .ok_or_else(|| refuse("not a VOCO release version"))?;
    let folder = Path::new(folder);
    if !folder.is_absolute() {
        return Err(refuse("the download folder must be an absolute path"));
    }
    let kind = package_kind().ok_or_else(|| refuse("this system has neither APT nor DNF"))?;
    // A release older than or equal to the installed one is never installed, so
    // an old signed release can't be put back over a newer one.
    match installed_version(kind) {
        Installed::Release(installed) if installed >= version => {
            return Err(refuse(format!("VOCO {installed} is installed, not older than {version}")))
        }
        Installed::Release(_) => {}
        Installed::Other => return Err(refuse("the installed VOCO isn't a release; reinstall it with the installer")),
        Installed::Missing => return Err(refuse("VOCO isn't installed by the package manager")),
    }

    stage("verifying");
    let staging = Staging::create().map_err(|error| refuse(format!("can't prepare {STAGING}: {error}")))?;
    let package_name = kind.asset_name(&version);
    let source = UserFolder::open(folder, owner).map_err(refuse)?;
    for (name, limit) in [
        (CHECKSUMS, MAX_MANIFEST_BYTES),
        (SIGNATURE, MAX_MANIFEST_BYTES),
        (package_name.as_str(), MAX_PACKAGE_BYTES),
    ] {
        source
            .copy(name, limit, &staging.path.join(name))
            .map_err(|error| refuse(format!("can't copy {name}: {error}")))?;
    }
    let checksums = staging.path.join(CHECKSUMS);
    let package = staging.path.join(&package_name);
    update_verify::verify_signature(&staging.path, &checksums, &staging.path.join(SIGNATURE))
        .and_then(|()| update_verify::read_manifest(&checksums))
        .and_then(|manifest| update_verify::verify_package(&manifest, kind, &version, &package))
        .and_then(|()| update_verify::verify_identity(kind, &version, &package))
        .map_err(|error| refuse(error.to_string()))?;

    stage("installing");
    let installed = install(kind, &package);
    drop(staging);
    installed?;
    match installed_version(kind) {
        Installed::Release(installed) if installed == version => {
            stage(&format!("installed {version}"));
            Ok(())
        }
        Installed::Release(installed) => Err((NOT_INSTALLED, format!("the package manager reports VOCO {installed}"))),
        Installed::Other | Installed::Missing => Err((NOT_INSTALLED, "the package manager reports no VOCO release".into())),
    }
}

/// The guided installer's choice: APT where it and dpkg-query exist,
/// otherwise DNF with rpm.
fn package_kind() -> Option<PackageKind> {
    let present = |path: &str| Path::new(path).is_file();
    if present("/usr/bin/apt-get") && present("/usr/bin/dpkg-query") {
        Some(PackageKind::Deb)
    } else if present("/usr/bin/dnf") && present("/usr/bin/rpm") {
        Some(PackageKind::Rpm)
    } else {
        None
    }
}

fn system_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command
        .env_clear()
        .env("PATH", SYSTEM_PATH)
        .env("LC_ALL", "C")
        .stdin(Stdio::null());
    command
}

enum Installed {
    Release(Version),
    /// Installed, with a version no release has, such as a local build's.
    Other,
    Missing,
}

/// The installed VOCO's version, as the package manager reports it.
fn installed_version(kind: PackageKind) -> Installed {
    match installed_text(kind) {
        Some(text) => Version::parse(&text).map_or(Installed::Other, Installed::Release),
        None => Installed::Missing,
    }
}

fn installed_text(kind: PackageKind) -> Option<String> {
    let output = match kind {
        PackageKind::Deb => system_command("/usr/bin/dpkg-query")
            .args(["--show", "--showformat=${db:Status-Abbrev} ${Version}", "--", "voco"])
            .stderr(Stdio::null())
            .output(),
        PackageKind::Rpm => system_command("/usr/bin/rpm")
            .args(["--query", "--queryformat=ii %{VERSION}", "--", "voco"])
            .stderr(Stdio::null())
            .output(),
    }
    .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    // dpkg's "ii " is an installed package; anything else, such as one removed
    // with its configuration kept, isn't.
    let version = text.trim_end().strip_prefix("ii ")?.trim();
    (output.status.success() && !version.is_empty()).then(|| version.to_string())
}

/// Exactly `apt-get install` or `dnf install` on the staged copy. APT waits up
/// to two minutes for another program's lock, such as an automatic update's.
fn install(kind: PackageKind, package: &Path) -> Outcome {
    let mut command = match kind {
        PackageKind::Deb => {
            let mut command = system_command("/usr/bin/apt-get");
            command.env("DEBIAN_FRONTEND", "noninteractive").args([
                "-o",
                "DPkg::Lock::Timeout=120",
                "-o",
                "Dpkg::Options::=--force-confdef",
                "-o",
                "Dpkg::Options::=--force-confold",
                "install",
                "--yes",
                "--",
            ]);
            command
        }
        PackageKind::Rpm => {
            let mut command = system_command("/usr/bin/dnf");
            command.args(["install", "--assumeyes", "--"]);
            command
        }
    };
    // The package manager's own output goes to VOCO's log, never to stdout,
    // which carries only the stages.
    let status = command
        .arg(package)
        .stdout(Stdio::from(io::stderr()))
        .status()
        .map_err(|error| (INSTALL_FAILED, format!("can't run the package manager: {error}")))?;
    if status.success() {
        Ok(())
    } else {
        Err((INSTALL_FAILED, format!("the package manager exited with {status}")))
    }
}

/// A fresh folder under STAGING, which only root can change. Dropping it
/// removes the folder and, once empty, STAGING itself.
struct Staging {
    path: PathBuf,
}

impl Staging {
    fn create() -> io::Result<Self> {
        let root = Path::new(STAGING);
        match std::fs::create_dir(root) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
        let info = std::fs::symlink_metadata(root)?;
        if !info.is_dir() || info.uid() != 0 || info.mode() & 0o022 != 0 {
            return Err(io::Error::other("not a folder only root can change"));
        }
        // Readable by everyone, as the release files are public: APT's
        // sandboxed download user can then read the package.
        std::fs::set_permissions(root, std::os::unix::fs::PermissionsExt::from_mode(0o755))?;
        // Leftovers of a run that was killed.
        for entry in std::fs::read_dir(root)? {
            let _ = std::fs::remove_dir_all(entry?.path());
        }
        let path = root.join(format!("{}", std::process::id()));
        std::fs::create_dir(&path)?;
        std::fs::set_permissions(&path, std::os::unix::fs::PermissionsExt::from_mode(0o755))?;
        Ok(Self { path })
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
        let _ = std::fs::remove_dir(STAGING);
    }
}

/// The download folder, opened without following a link at its last step and
/// held open, so each file is read relative to the folder that was checked.
struct UserFolder {
    fd: OwnedFd,
    owner: libc::uid_t,
}

impl UserFolder {
    fn open(path: &Path, owner: libc::uid_t) -> Result<Self, String> {
        let fd = open_at(libc::AT_FDCWD, path.as_os_str(), libc::O_DIRECTORY)
            .map_err(|error| format!("can't open the download folder: {error}"))?;
        let info = fd_stat(&fd).map_err(|error| error.to_string())?;
        if info.st_mode & libc::S_IFMT != libc::S_IFDIR || info.st_uid != owner || info.st_mode & 0o077 != 0 {
            return Err("the download folder isn't private to the user who asked".into());
        }
        Ok(Self { fd, owner })
    }

    /// Copy `name` into `target`, which must not exist: a regular file the
    /// user owns, at most `limit` bytes, never through a link.
    fn copy(&self, name: &str, limit: u64, target: &Path) -> io::Result<()> {
        if name.contains('/') || name.starts_with('.') {
            return Err(io::Error::other("not a release file name"));
        }
        let fd = open_at(self.fd.as_raw_fd(), OsStr::new(name), libc::O_NONBLOCK)?;
        let info = fd_stat(&fd)?;
        if info.st_mode & libc::S_IFMT != libc::S_IFREG || info.st_uid != self.owner || info.st_nlink != 1 {
            return Err(io::Error::other("not a regular file of the user's"));
        }
        if info.st_size < 0 || info.st_size as u64 > limit {
            return Err(io::Error::other("larger than a release file"));
        }
        let mut source = File::from(fd).take(limit + 1);
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o644)
            .custom_flags(libc::O_NOFOLLOW)
            .open(target)?;
        let copied = io::copy(&mut source, &mut output)?;
        if copied > limit || copied != info.st_size as u64 {
            return Err(io::Error::other("the file changed while it was copied"));
        }
        output.sync_all()
    }
}

fn open_at(directory: libc::c_int, name: &OsStr, flags: libc::c_int) -> io::Result<OwnedFd> {
    let name = CString::new(name.as_bytes()).map_err(|_| io::Error::other("a path with a NUL byte"))?;
    // SAFETY: name is a valid C string; the returned descriptor is checked.
    let fd = unsafe {
        libc::openat(directory, name.as_ptr(), libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | flags)
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: openat returned a new descriptor this value now owns.
    Ok(unsafe { OwnedFd::from_raw_fd(fd) })
}

fn fd_stat(fd: &OwnedFd) -> io::Result<libc::stat> {
    // SAFETY: stat is plain data, filled in by fstat on success.
    let mut info: libc::stat = unsafe { std::mem::zeroed() };
    // SAFETY: fd is open and info is a valid stat buffer.
    if unsafe { libc::fstat(fd.as_raw_fd(), &mut info) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arguments(values: &[&str]) -> Vec<std::ffi::OsString> {
        values.iter().map(Into::into).collect()
    }

    #[test]
    fn it_takes_exactly_a_folder_and_a_version() {
        for refused in [&[][..], &["/tmp"], &["/tmp", "2026.0.66", "extra"]] {
            let (code, _) = run(arguments(refused)).unwrap_err();
            assert_eq!(code, REFUSED);
        }
    }

    #[test]
    fn it_refuses_to_run_as_anyone_but_root() {
        // SAFETY: geteuid has no preconditions.
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let (code, message) = run(arguments(&["/tmp", "2026.0.66"])).unwrap_err();
        assert_eq!((code, message.as_str()), (REFUSED, "runs only as root, through pkexec"));
    }

    struct Dir(PathBuf);
    impl Dir {
        fn new(mode: u32) -> Self {
            use std::os::unix::fs::PermissionsExt;
            use std::sync::atomic::{AtomicU64, Ordering};
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "voco-update-helper-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::SeqCst)
            ));
            std::fs::create_dir(&path).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
            Self(path)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn me() -> libc::uid_t {
        // SAFETY: getuid has no preconditions.
        unsafe { libc::getuid() }
    }

    #[test]
    fn the_download_folder_must_be_private_and_the_users() {
        let private = Dir::new(0o700);
        assert!(UserFolder::open(&private.0, me()).is_ok());
        assert!(UserFolder::open(&private.0, me() + 1).is_err());
        let shared = Dir::new(0o755);
        assert!(UserFolder::open(&shared.0, me()).is_err());
        let link = private.0.join("link");
        std::os::unix::fs::symlink(&private.0, &link).unwrap();
        assert!(UserFolder::open(&link, me()).is_err(), "a link as the folder");
    }

    #[test]
    fn only_a_regular_unlinked_file_within_its_limit_is_copied() {
        let source = Dir::new(0o700);
        let target = Dir::new(0o755);
        let folder = UserFolder::open(&source.0, me()).unwrap();
        std::fs::write(source.0.join("voco_checksums.txt"), b"manifest").unwrap();
        folder.copy("voco_checksums.txt", 64, &target.0.join("a")).unwrap();
        assert_eq!(std::fs::read(target.0.join("a")).unwrap(), b"manifest");
        assert!(folder.copy("voco_checksums.txt", 64, &target.0.join("a")).is_err(), "never overwrites");
        assert!(folder.copy("voco_checksums.txt", 4, &target.0.join("b")).is_err(), "over its limit");
        std::os::unix::fs::symlink("/etc/hostname", source.0.join("linked")).unwrap();
        assert!(folder.copy("linked", 64, &target.0.join("c")).is_err(), "a link");
        std::fs::hard_link(source.0.join("voco_checksums.txt"), source.0.join("hard")).unwrap();
        assert!(folder.copy("hard", 64, &target.0.join("d")).is_err(), "a second hard link");
        std::fs::create_dir(source.0.join("folder")).unwrap();
        assert!(folder.copy("folder", 64, &target.0.join("e")).is_err(), "a folder");
        for name in ["../x", ".hidden", "a/b"] {
            assert!(folder.copy(name, 64, &target.0.join("f")).is_err(), "{name}");
        }
    }
}
