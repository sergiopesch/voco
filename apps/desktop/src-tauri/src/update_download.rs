//! Install update's download (AGENTS.md, Installer and packages): one release
//! asset from GitHub into the user's private update folder.
//!
//! VOCO builds each address itself from the release version, never from the
//! releases API's answer, and follows a redirect only by hand, to GitHub's
//! release-asset host over HTTPS. The HTTP client is the libsoup WebKit
//! already links, with the system's TLS and certificate store.

use crate::update_verify::{PackageKind, Version};
use soup3::prelude::*;
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use webkit2gtk::gio;
use webkit2gtk::gio::prelude::*;

const RELEASES: &str = "https://github.com/sergiopesch/voco/releases/download";
/// Where github.com redirects a release asset; nowhere else is followed.
const ASSET_HOST: &str = "release-assets.githubusercontent.com";
const MAX_REDIRECTS: usize = 3;
/// A stalled connection fails rather than holding the update open.
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const CHUNK: usize = 256 * 1024;
/// How often progress is reported, at most.
const PROGRESS_EVERY: Duration = Duration::from_millis(100);
const USER_AGENT: &str = concat!("VOCO/", env!("CARGO_PKG_VERSION"), " (Install update)");

/// The three files an update needs, in the order they're fetched: the small
/// signed list first, so a release without one costs no package download.
pub fn assets(kind: PackageKind, version: &Version) -> [String; 3] {
    [
        crate::update_verify::CHECKSUMS.into(),
        crate::update_verify::SIGNATURE.into(),
        kind.asset_name(version),
    ]
}

pub fn asset_url(version: &Version, name: &str) -> String {
    format!("{RELEASES}/{}/{name}", version.tag())
}

#[derive(Debug, PartialEq, Eq)]
pub enum DownloadError {
    Cancelled,
    /// The server answered with a status other than success or a redirect.
    Status(u32),
    /// A redirect to anywhere but GitHub's asset host, or too many of them.
    Redirect,
    TooLarge,
    Network(String),
    Disk(String),
}

impl std::fmt::Display for DownloadError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => formatter.write_str("The download was cancelled."),
            Self::Status(404) => formatter.write_str("This release has no package for this system yet."),
            Self::Status(status) => write!(formatter, "GitHub answered the download with status {status}."),
            Self::Redirect => formatter.write_str("The download was sent somewhere other than GitHub."),
            Self::TooLarge => formatter.write_str("The download is larger than any VOCO release."),
            Self::Network(detail) => write!(formatter, "The download stopped: {detail}"),
            Self::Disk(detail) => write!(formatter, "VOCO couldn't save the download: {detail}"),
        }
    }
}

/// Bytes received so far and the size the server announced, if any.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    pub received: u64,
    pub total: Option<u64>,
}

/// Lets another thread stop a download between any two reads.
#[derive(Clone, Default)]
pub struct Cancel {
    cancelled: Arc<AtomicBool>,
    cancellable: Arc<std::sync::Mutex<Option<gio::Cancellable>>>,
}

impl Cancel {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(cancellable) = self.cancellable.lock() {
            if let Some(cancellable) = cancellable.as_ref() {
                cancellable.cancel();
            }
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    fn arm(&self) -> gio::Cancellable {
        let cancellable = gio::Cancellable::new();
        if let Ok(mut slot) = self.cancellable.lock() {
            *slot = Some(cancellable.clone());
        }
        if self.is_cancelled() {
            cancellable.cancel();
        }
        cancellable
    }
}

/// Whether `url` may be followed: GitHub's asset host, over HTTPS, on its
/// default port, with no user name or password.
fn allowed_redirect(url: &str) -> bool {
    let Ok(uri) = glib::Uri::parse(url, glib::UriFlags::NONE) else {
        return false;
    };
    uri.scheme().as_str() == "https"
        && uri.host().is_some_and(|host| host.as_str() == ASSET_HOST)
        && uri.port() == -1
        && uri.userinfo().is_none()
}

/// The private folder a download writes into, created owner-only, as the
/// helper requires: `$XDG_STATE_HOME/voco/update`.
pub fn folder(state_home: &Path) -> io::Result<PathBuf> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    let folder = state_home.join("voco").join("update");
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&folder)?;
    let info = std::fs::symlink_metadata(&folder)?;
    // SAFETY: getuid has no preconditions.
    if !info.is_dir() || info.uid() != unsafe { libc::getuid() } {
        return Err(io::Error::other("the update folder isn't a folder of this user's"));
    }
    std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o700))?;
    Ok(folder)
}

/// Remove every earlier download from the update folder.
pub fn clear(folder: &Path) -> io::Result<()> {
    for entry in std::fs::read_dir(folder)? {
        let path = entry?.path();
        if path.is_dir() && !path.is_symlink() {
            std::fs::remove_dir_all(&path)?;
        } else {
            std::fs::remove_file(&path)?;
        }
    }
    Ok(())
}

/// Download `url` into `target`, which must not exist, at most `limit` bytes.
/// `progress` hears about the bytes received, about ten times a second.
pub fn fetch(
    url: &str,
    target: &Path,
    limit: u64,
    cancel: &Cancel,
    mut progress: impl FnMut(Progress),
) -> Result<u64, DownloadError> {
    let cancellable = cancel.arm();
    let session = soup3::Session::new();
    session.set_user_agent(USER_AGENT);
    session.set_timeout(IDLE_TIMEOUT.as_secs() as u32);
    session.set_idle_timeout(IDLE_TIMEOUT.as_secs() as u32);
    let mut address = url.to_string();
    let mut redirects = 0;
    let (message, stream) = loop {
        let message = soup3::Message::new("GET", &address)
            .map_err(|_| DownloadError::Network("not a download address".into()))?;
        message.set_flags(soup3::MessageFlags::NO_REDIRECT);
        let stream = session
            .send(&message, Some(&cancellable))
            .map_err(|error| network_error(cancel, &error))?;
        let status = message.status().into_glib() as u32;
        if (300..400).contains(&status) {
            let location = message
                .response_headers()
                .and_then(|headers| headers.one("Location"))
                .ok_or(DownloadError::Redirect)?;
            redirects += 1;
            if redirects > MAX_REDIRECTS || !allowed_redirect(location.as_str()) {
                return Err(DownloadError::Redirect);
            }
            let _ = stream.close(gio::Cancellable::NONE);
            address = location.to_string();
            continue;
        }
        if status != 200 {
            return Err(DownloadError::Status(status));
        }
        break (message, stream);
    };
    let total = message
        .response_headers()
        .map(|headers| headers.content_length())
        .filter(|length| *length > 0)
        .map(|length| length as u64);
    if total.is_some_and(|total| total > limit) {
        return Err(DownloadError::TooLarge);
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(target)
        .map_err(|error| DownloadError::Disk(error.to_string()))?;
    let result = copy(&stream, &mut file, limit, total, cancel, &cancellable, &mut progress);
    let _ = stream.close(gio::Cancellable::NONE);
    match result {
        Ok(received) => {
            file.sync_all().map_err(|error| DownloadError::Disk(error.to_string()))?;
            Ok(received)
        }
        Err(error) => {
            drop(file);
            let _ = std::fs::remove_file(target);
            Err(error)
        }
    }
}

fn copy(
    stream: &gio::InputStream,
    file: &mut std::fs::File,
    limit: u64,
    total: Option<u64>,
    cancel: &Cancel,
    cancellable: &gio::Cancellable,
    progress: &mut impl FnMut(Progress),
) -> Result<u64, DownloadError> {
    let mut buffer = vec![0u8; CHUNK];
    let mut received: u64 = 0;
    let mut reported = Instant::now();
    progress(Progress { received, total });
    loop {
        if cancel.is_cancelled() {
            return Err(DownloadError::Cancelled);
        }
        let read = stream
            .read(&mut buffer[..], Some(cancellable))
            .map_err(|error| network_error(cancel, &error))?;
        if read == 0 {
            break;
        }
        received += read as u64;
        if received > limit {
            return Err(DownloadError::TooLarge);
        }
        file.write_all(&buffer[..read])
            .map_err(|error| DownloadError::Disk(error.to_string()))?;
        if reported.elapsed() >= PROGRESS_EVERY {
            reported = Instant::now();
            progress(Progress { received, total });
        }
    }
    // A short body is a broken download, whatever the connection said.
    if total.is_some_and(|total| total != received) {
        return Err(DownloadError::Network("the connection closed early".into()));
    }
    progress(Progress { received, total });
    Ok(received)
}

fn network_error(cancel: &Cancel, error: &glib::Error) -> DownloadError {
    if cancel.is_cancelled() || error.matches(gio::IOErrorEnum::Cancelled) {
        DownloadError::Cancelled
    } else {
        DownloadError::Network(error.message().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read};
    use std::net::TcpListener;

    #[test]
    fn addresses_are_built_from_the_version_alone() {
        let version = Version::parse("2026.0.66").unwrap();
        let [checksums, signature, package] = assets(PackageKind::Deb, &version);
        assert_eq!(
            asset_url(&version, &package),
            "https://github.com/sergiopesch/voco/releases/download/voco.2026.0.66/voco_2026.0.66_amd64.deb"
        );
        assert_eq!((checksums.as_str(), signature.as_str()), ("voco_checksums.txt", "voco_checksums.txt.asc"));
        assert_eq!(assets(PackageKind::Rpm, &version)[2], "voco-2026.0.66-1.x86_64.rpm");
    }

    #[test]
    fn only_githubs_asset_host_is_followed() {
        assert!(allowed_redirect("https://release-assets.githubusercontent.com/github-production-release-asset/1/2?x=y"));
        for refused in [
            "http://release-assets.githubusercontent.com/a",
            "https://release-assets.githubusercontent.com:8443/a",
            "https://user:pw@release-assets.githubusercontent.com/a",
            "https://release-assets.githubusercontent.com.example.com/a",
            "https://example.com/release-assets.githubusercontent.com",
            "https://objects.githubusercontent.com/a",
            "file:///etc/passwd",
            "/relative/path",
            "",
        ] {
            assert!(!allowed_redirect(refused), "{refused}");
        }
    }

    /// One HTTP/1.1 answer per connection, from a local socket.
    fn serve(responses: Vec<Vec<u8>>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for response in responses {
                let Ok((mut stream, _)) = listener.accept() else { return };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                while reader.read_line(&mut line).is_ok_and(|read| read > 2) {
                    line.clear();
                }
                let _ = stream.write_all(&response);
            }
        });
        address
    }

    fn ok(body: &[u8]) -> Vec<u8> {
        let mut response = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).into_bytes();
        response.extend_from_slice(body);
        response
    }

    struct Dir(PathBuf);
    impl Dir {
        fn new() -> Self {
            use std::sync::atomic::AtomicU64;
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "voco-download-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::SeqCst)
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_download_is_saved_owner_only_with_its_progress() {
        use std::os::unix::fs::PermissionsExt;
        let body = vec![7u8; 600 * 1024];
        let url = serve(vec![ok(&body)]);
        let dir = Dir::new();
        let target = dir.0.join("package");
        let mut seen = Vec::new();
        let received = fetch(&url, &target, 1 << 20, &Cancel::default(), |progress| seen.push(progress)).unwrap();
        assert_eq!(received, body.len() as u64);
        let mut saved = Vec::new();
        std::fs::File::open(&target).unwrap().read_to_end(&mut saved).unwrap();
        assert_eq!(saved, body);
        assert_eq!(std::fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(seen.first(), Some(&Progress { received: 0, total: Some(body.len() as u64) }));
        assert_eq!(seen.last(), Some(&Progress { received: body.len() as u64, total: Some(body.len() as u64) }));
    }

    #[test]
    fn a_download_over_its_limit_is_refused_and_removed() {
        let url = serve(vec![ok(&[1u8; 4096])]);
        let dir = Dir::new();
        let target = dir.0.join("package");
        assert_eq!(fetch(&url, &target, 1024, &Cancel::default(), |_| {}), Err(DownloadError::TooLarge));
        assert!(!target.exists());
        // Without a length announced, the limit still holds while reading.
        let url = serve(vec![b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".iter().chain([1u8; 4096].iter()).copied().collect()]);
        assert_eq!(fetch(&url, &target, 1024, &Cancel::default(), |_| {}), Err(DownloadError::TooLarge));
        assert!(!target.exists());
    }

    #[test]
    fn a_short_body_is_a_broken_download() {
        let url = serve(vec![b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\nshort".to_vec()]);
        let dir = Dir::new();
        let target = dir.0.join("package");
        assert!(matches!(fetch(&url, &target, 1024, &Cancel::default(), |_| {}), Err(DownloadError::Network(_))));
        assert!(!target.exists());
    }

    #[test]
    fn a_redirect_anywhere_else_is_refused() {
        for location in ["http://127.0.0.1:1/x", "https://example.com/x", "https://release-assets.githubusercontent.com.evil/x"] {
            let url = serve(vec![format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").into_bytes()]);
            let dir = Dir::new();
            assert_eq!(fetch(&url, &dir.0.join("p"), 1024, &Cancel::default(), |_| {}), Err(DownloadError::Redirect), "{location}");
        }
        let url = serve(vec![b"HTTP/1.1 302 Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec()]);
        let dir = Dir::new();
        assert_eq!(fetch(&url, &dir.0.join("p"), 1024, &Cancel::default(), |_| {}), Err(DownloadError::Redirect));
    }

    #[test]
    fn a_missing_asset_says_so() {
        let url = serve(vec![b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec()]);
        let dir = Dir::new();
        let error = fetch(&url, &dir.0.join("p"), 1024, &Cancel::default(), |_| {}).unwrap_err();
        assert_eq!(error, DownloadError::Status(404));
        assert_eq!(error.to_string(), "This release has no package for this system yet.");
    }

    #[test]
    fn a_cancelled_download_stops_and_leaves_nothing() {
        let url = serve(vec![ok(&vec![1u8; 4 << 20])]);
        let dir = Dir::new();
        let target = dir.0.join("package");
        let cancel = Cancel::default();
        let stop = cancel.clone();
        let result = fetch(&url, &target, 8 << 20, &cancel, move |progress| {
            if progress.received > 0 {
                stop.cancel();
            }
        });
        assert_eq!(result, Err(DownloadError::Cancelled));
        assert!(!target.exists());
        let cancel = Cancel::default();
        cancel.cancel();
        assert_eq!(fetch(&serve(vec![ok(b"x")]), &dir.0.join("again"), 8, &cancel, |_| {}), Err(DownloadError::Cancelled));
    }

    #[test]
    fn an_existing_file_is_never_overwritten() {
        let dir = Dir::new();
        let target = dir.0.join("package");
        std::fs::write(&target, b"earlier").unwrap();
        assert!(matches!(fetch(&serve(vec![ok(b"new")]), &target, 8, &Cancel::default(), |_| {}), Err(DownloadError::Disk(_))));
        assert_eq!(std::fs::read(&target).unwrap(), b"earlier");
    }

    #[test]
    fn the_update_folder_is_private_and_clears() {
        use std::os::unix::fs::PermissionsExt;
        let dir = Dir::new();
        let folder = folder(&dir.0).unwrap();
        assert_eq!(folder, dir.0.join("voco/update"));
        assert_eq!(std::fs::metadata(&folder).unwrap().permissions().mode() & 0o777, 0o700);
        std::fs::write(folder.join("old.deb"), b"x").unwrap();
        std::fs::create_dir(folder.join("partial")).unwrap();
        clear(&folder).unwrap();
        assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 0);
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o755)).unwrap();
        self::folder(&dir.0).unwrap();
        assert_eq!(std::fs::metadata(&folder).unwrap().permissions().mode() & 0o777, 0o700);
    }
}
