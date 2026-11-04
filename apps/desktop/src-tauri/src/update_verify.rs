//! Verification shared by Install update and its root helper (AGENTS.md,
//! Installer and packages). It uses only the standard library and sha2, so the
//! helper that runs as root links nothing else from VOCO.
//!
//! A release is trusted only as the guided installer trusts it: `gpgv` checks
//! `voco_checksums.txt` against the release key VOCO carries and must report a
//! valid signature by its fingerprint, and the package's SHA-256 must be the
//! one that file lists for its exact name.

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The release key's public half, as the installer embeds it
/// (`VOCO_RELEASE_KEY_BASE64`): `gpgv` reads only a binary keyring.
pub const RELEASE_KEY: &[u8] = include_bytes!("../../../../packaging/release-key.gpg");
pub const RELEASE_FINGERPRINT: &str = "B33C7C6AAEC8C20433A7A837540796453D8E3865";
pub const CHECKSUMS: &str = "voco_checksums.txt";
pub const SIGNATURE: &str = "voco_checksums.txt.asc";
/// A release's packages are about 700 MB; anything far larger isn't one.
pub const MAX_PACKAGE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// The signed manifest lists about fifteen files.
pub const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const GPGV: &str = "/usr/bin/gpgv";
const GPGV_DEADLINE: Duration = Duration::from_secs(30);

/// Which package this installation takes: the guided installer's choice,
/// the `.deb` where APT is, otherwise the RPM.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackageKind {
    Deb,
    Rpm,
}

impl PackageKind {
    /// The release asset's exact name for `version`.
    pub fn asset_name(self, version: &Version) -> String {
        match self {
            Self::Deb => format!("voco_{version}_amd64.deb"),
            Self::Rpm => format!("voco-{version}-1.x86_64.rpm"),
        }
    }
}

/// A release version, `YYYY.0.N`, the only form VOCO's tags take.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version {
    year: u16,
    number: u32,
}

impl Version {
    pub fn parse(text: &str) -> Option<Self> {
        let mut parts = text.split('.');
        let (year, zero, number) = (parts.next()?, parts.next()?, parts.next()?);
        if parts.next().is_some() || zero != "0" || !digits(year, 4, 4) || !digits(number, 1, 6) {
            return None;
        }
        let year = year.parse().ok().filter(|year| (2024..=2999).contains(year))?;
        Some(Self { year, number: number.parse().ok()? })
    }

    /// The release's Git tag, which names its assets' folder on GitHub.
    pub fn tag(&self) -> String {
        format!("voco.{self}")
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}.0.{}", self.year, self.number)
    }
}

/// ASCII digits only, without a leading zero unless the number is 0.
fn digits(text: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&text.len())
        && text.bytes().all(|byte| byte.is_ascii_digit())
        && (text == "0" || !text.starts_with('0'))
}

/// Why a downloaded release was refused. Each says what to tell the user.
#[derive(Debug, PartialEq, Eq)]
pub enum VerifyError {
    Signature,
    Manifest,
    NotListed,
    Checksum,
    PackageIdentity,
    TooLarge,
    Io(String),
}

impl std::fmt::Display for VerifyError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Signature => "The release's signature didn't verify with VOCO's release key.",
            Self::Manifest => "The release's checksum list isn't in the expected form.",
            Self::NotListed => "The release's checksum list doesn't name this package.",
            Self::Checksum => "The downloaded package doesn't match the release's checksum.",
            Self::PackageIdentity => "The downloaded package isn't the VOCO release it should be.",
            Self::TooLarge => "The download is larger than any VOCO release.",
            Self::Io(detail) => return write!(formatter, "VOCO couldn't read the download: {detail}"),
        })
    }
}

/// `gpgv` with only the release key: true only when it reports a good
/// signature made by the release key's fingerprint.
pub fn verify_signature(work: &Path, checksums: &Path, signature: &Path) -> Result<(), VerifyError> {
    let keyring = work.join("release-key.gpg");
    write_private(&keyring, RELEASE_KEY).map_err(|error| VerifyError::Io(error.to_string()))?;
    let status = run_gpgv(&keyring, signature, checksums);
    let _ = std::fs::remove_file(&keyring);
    match status {
        Some(status) if signed_by_release_key(&status) => Ok(()),
        _ => Err(VerifyError::Signature),
    }
}

fn run_gpgv(keyring: &Path, signature: &Path, data: &Path) -> Option<String> {
    let mut child = Command::new(GPGV)
        .arg("--status-fd")
        .arg("1")
        .arg("--keyring")
        .arg(keyring)
        .arg("--")
        .arg(signature)
        .arg(data)
        .env_clear()
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut output = Vec::new();
        let _ = stdout.by_ref().take(64 * 1024).read_to_end(&mut output);
        output
    });
    let deadline = Instant::now() + GPGV_DEADLINE;
    let exit = loop {
        match child.try_wait() {
            Ok(Some(exit)) => break exit,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    let output = reader.join().ok()?;
    exit.success().then(|| String::from_utf8_lossy(&output).into_owned())
}

/// gpgv's status lines: a VALIDSIG by the release key's fingerprint, with no
/// line saying a signature was bad or the key unusable.
fn signed_by_release_key(status: &str) -> bool {
    let mut valid = false;
    for line in status.lines() {
        let mut fields = line.split_ascii_whitespace();
        if fields.next() != Some("[GNUPG:]") {
            continue;
        }
        match fields.next() {
            // As the installer checks it: the release key made the signature
            // itself, not a subkey.
            Some("VALIDSIG") => valid |= fields.next() == Some(RELEASE_FINGERPRINT),
            Some("BADSIG" | "ERRSIG" | "EXPKEYSIG" | "REVKEYSIG" | "NO_PUBKEY") => return false,
            _ => {}
        }
    }
    valid
}

/// The SHA-256 the signed manifest lists for exactly `name`. The manifest is
/// `sha256sum` output: one `<64 hex>  <name>` per line, each name once.
pub fn listed_digest(manifest: &str, name: &str) -> Result<String, VerifyError> {
    let mut found = None;
    for line in manifest.lines() {
        let (digest, file) = line.split_once("  ").ok_or(VerifyError::Manifest)?;
        if digest.len() != 64 || !digest.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')) {
            return Err(VerifyError::Manifest);
        }
        if file.is_empty() || file.contains(['/', '\\', ' ', '\0']) {
            return Err(VerifyError::Manifest);
        }
        if file == name {
            if found.is_some() {
                return Err(VerifyError::Manifest);
            }
            found = Some(digest.to_string());
        }
    }
    found.ok_or(VerifyError::NotListed)
}

/// Read the manifest after its signature verified, refusing anything large.
pub fn read_manifest(path: &Path) -> Result<String, VerifyError> {
    let file = File::open(path).map_err(|error| VerifyError::Io(error.to_string()))?;
    let mut text = String::new();
    file.take(MAX_MANIFEST_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|_| VerifyError::Manifest)?;
    if text.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(VerifyError::Manifest);
    }
    Ok(text)
}

/// The file's SHA-256, refusing more than a package can be.
pub fn file_digest(path: &Path) -> Result<String, VerifyError> {
    let mut file = File::open(path).map_err(|error| VerifyError::Io(error.to_string()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    let mut total: u64 = 0;
    loop {
        let read = match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(VerifyError::Io(error.to_string())),
        };
        total += read as u64;
        if total > MAX_PACKAGE_BYTES {
            return Err(VerifyError::TooLarge);
        }
        hasher.update(&buffer[..read]);
    }
    Ok(crate::digest_hex::digest_hex(hasher.finalize()))
}

/// The package matches the signed manifest's digest for its release name.
pub fn verify_package(manifest: &str, kind: PackageKind, version: &Version, package: &Path) -> Result<(), VerifyError> {
    let expected = listed_digest(manifest, &kind.asset_name(version))?;
    if file_digest(package)? != expected {
        return Err(VerifyError::Checksum);
    }
    Ok(())
}

/// What the package itself says it is: VOCO, this version, for x86-64. The
/// checksum already binds it to the signed release; this catches a release
/// whose manifest names the wrong file.
pub fn verify_identity(kind: PackageKind, version: &Version, package: &Path) -> Result<(), VerifyError> {
    let (program, arguments, expected): (&str, Vec<&std::ffi::OsStr>, String) = match kind {
        PackageKind::Deb => (
            "/usr/bin/dpkg-deb",
            vec!["--show".as_ref(), "--showformat=${Package} ${Version} ${Architecture}".as_ref(), "--".as_ref(), package.as_os_str()],
            format!("voco {version} amd64"),
        ),
        PackageKind::Rpm => (
            "/usr/bin/rpm",
            vec!["--query".as_ref(), "--package".as_ref(), "--nosignature".as_ref(),
                 "--queryformat=%{NAME} %{VERSION} %{RELEASE} %{ARCH}".as_ref(), "--".as_ref(), package.as_os_str()],
            format!("voco {version} 1 x86_64"),
        ),
    };
    let output = Command::new(program)
        .args(arguments)
        .env_clear()
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|error| VerifyError::Io(error.to_string()))?;
    if output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == expected {
        Ok(())
    } else {
        Err(VerifyError::PackageIdentity)
    }
}

/// Create `path` readable and writable only by its owner, failing if it exists.
pub fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_take_only_the_release_form() {
        let version = Version::parse("2026.0.65").unwrap();
        assert_eq!(version.to_string(), "2026.0.65");
        assert_eq!(version.tag(), "voco.2026.0.65");
        assert!(Version::parse("2026.0.66").unwrap() > version);
        assert!(Version::parse("2027.0.1").unwrap() > Version::parse("2026.0.999").unwrap());
        for refused in ["", "2026.0", "2026.1.65", "2026.0.65.1", "2026.0.065", "v2026.0.65", "2026.0.65-rc1",
                        "2026.0.6a", "20260.0.1", "1999.0.1", "2026.0.", "2026..65", " 2026.0.65", "2026.0.1234567"] {
            assert_eq!(Version::parse(refused), None, "{refused:?}");
        }
    }

    #[test]
    fn asset_names_are_the_release_files() {
        let version = Version::parse("2026.0.65").unwrap();
        assert_eq!(PackageKind::Deb.asset_name(&version), "voco_2026.0.65_amd64.deb");
        assert_eq!(PackageKind::Rpm.asset_name(&version), "voco-2026.0.65-1.x86_64.rpm");
    }

    const A: &str = "e0d4e2ec4dc290270d69c1f4ed009f29db31332fe3c9b6c473978401eee2d9e9";
    const B: &str = "a45439d545c47ea18485056a57089c23ef22f02d77df90f6ac78a6802e451fbd";

    #[test]
    fn the_manifest_names_each_file_once_with_one_digest() {
        let manifest = format!("{A}  voco_2026.0.65_amd64.deb\n{A}  voco_latest_amd64.deb\n{B}  voco-2026.0.65-1.x86_64.rpm\n");
        assert_eq!(listed_digest(&manifest, "voco_2026.0.65_amd64.deb").unwrap(), A);
        assert_eq!(listed_digest(&manifest, "voco-2026.0.65-1.x86_64.rpm").unwrap(), B);
        assert_eq!(listed_digest(&manifest, "voco_2026.0.66_amd64.deb"), Err(VerifyError::NotListed));
        // A prefix or suffix of a listed name is not that name.
        assert_eq!(listed_digest(&manifest, "voco_2026.0.65_amd64"), Err(VerifyError::NotListed));
    }

    #[test]
    fn a_manifest_in_any_other_form_is_refused() {
        let name = "voco_2026.0.65_amd64.deb";
        for manifest in [
            format!("{A}  {name}\n{B}  {name}\n"),
            format!("{A} {name}\n"),
            format!("{}  {name}\n", A.to_uppercase()),
            format!("{}  {name}\n", &A[1..]),
            format!("{A}  ../{name}\n"),
            format!("{A}  dir/{name}\n"),
            format!("{A}  *{name} extra\n"),
            format!("{A}  \n"),
            "garbage\n".to_string(),
        ] {
            assert_eq!(listed_digest(&manifest, name), Err(VerifyError::Manifest), "{manifest:?}");
        }
    }

    #[test]
    fn only_a_good_signature_by_the_release_key_counts() {
        let good = format!("[GNUPG:] NEWSIG\n[GNUPG:] GOODSIG 540796453D8E3865 VOCO\n[GNUPG:] VALIDSIG {RELEASE_FINGERPRINT} 2026-11-04 1793794367 0 4 0 22 10 00 {RELEASE_FINGERPRINT}\n");
        assert!(signed_by_release_key(&good));
        // A subkey's signature, even one whose primary key is the release key,
        // is refused, as the installer refuses it.
        assert!(!signed_by_release_key(&format!("[GNUPG:] VALIDSIG 0123456789ABCDEF0123456789ABCDEF01234567 2026-11-04 1 0 4 0 22 10 00 {RELEASE_FINGERPRINT}\n")));
        let other = "[GNUPG:] VALIDSIG 0123456789ABCDEF0123456789ABCDEF01234567 2026-11-04 1 0 4 0 22 10 00 0123456789ABCDEF0123456789ABCDEF01234567\n";
        assert!(!signed_by_release_key(other));
        assert!(!signed_by_release_key(""));
        assert!(!signed_by_release_key(&format!("{good}[GNUPG:] BADSIG 540796453D8E3865 VOCO\n")));
        assert!(!signed_by_release_key(&format!("{good}[GNUPG:] EXPKEYSIG 540796453D8E3865 VOCO\n")));
        assert!(!signed_by_release_key(&format!("{good}[GNUPG:] REVKEYSIG 540796453D8E3865 VOCO\n")));
        assert!(!signed_by_release_key("[GNUPG:] ERRSIG 540796453D8E3865 22 10 00 1793794367 9 -\n[GNUPG:] NO_PUBKEY 540796453D8E3865\n"));
        // The fingerprint only in a field that names something else doesn't count.
        assert!(!signed_by_release_key(&format!("[GNUPG:] GOODSIG {RELEASE_FINGERPRINT} VOCO\n")));
        assert!(!signed_by_release_key(&format!("VALIDSIG {RELEASE_FINGERPRINT}\n")));
    }

    #[test]
    fn the_carried_key_is_the_installers() {
        let install = include_str!("../../../../install");
        let line = install.lines().find(|line| line.starts_with("VOCO_RELEASE_KEY_BASE64='")).unwrap();
        let encoded = line.trim_start_matches("VOCO_RELEASE_KEY_BASE64='").trim_end_matches('\'');
        assert_eq!(decode_base64(encoded), RELEASE_KEY);
        assert!(install.contains(&format!("VOCO_RELEASE_KEY_FINGERPRINT='{RELEASE_FINGERPRINT}'")));
    }

    fn decode_base64(text: &str) -> Vec<u8> {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut bits = 0u32;
        let mut count = 0;
        let mut out = Vec::new();
        for byte in text.bytes().filter(|&byte| byte != b'=') {
            bits = bits << 6 | ALPHABET.iter().position(|&a| a == byte).unwrap() as u32;
            count += 6;
            if count >= 8 {
                count -= 8;
                out.push((bits >> count) as u8);
                bits &= (1 << count) - 1;
            }
        }
        out
    }

    fn work() -> tempfile_dir::Dir {
        tempfile_dir::Dir::new()
    }

    #[test]
    fn a_package_must_match_its_listed_digest_and_size() {
        let dir = work();
        let version = Version::parse("2026.0.65").unwrap();
        let package = dir.path().join("package");
        std::fs::write(&package, b"abc").unwrap();
        let abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        let manifest = format!("{abc}  voco_2026.0.65_amd64.deb\n{A}  voco-2026.0.65-1.x86_64.rpm\n");
        assert_eq!(verify_package(&manifest, PackageKind::Deb, &version, &package), Ok(()));
        assert_eq!(verify_package(&manifest, PackageKind::Rpm, &version, &package), Err(VerifyError::Checksum));
        std::fs::write(&package, b"abd").unwrap();
        assert_eq!(verify_package(&manifest, PackageKind::Deb, &version, &package), Err(VerifyError::Checksum));
        let later = Version::parse("2026.0.66").unwrap();
        assert_eq!(verify_package(&manifest, PackageKind::Deb, &later, &package), Err(VerifyError::NotListed));
    }

    #[test]
    fn a_large_manifest_is_refused() {
        let dir = work();
        let path = dir.path().join(CHECKSUMS);
        std::fs::write(&path, vec![b'a'; MAX_MANIFEST_BYTES as usize + 1]).unwrap();
        assert_eq!(read_manifest(&path), Err(VerifyError::Manifest));
        std::fs::write(&path, format!("{A}  voco_2026.0.65_amd64.deb\n")).unwrap();
        assert!(read_manifest(&path).is_ok());
    }

    #[test]
    fn private_files_are_owner_only_and_never_overwritten() {
        use std::os::unix::fs::PermissionsExt;
        let dir = work();
        let path = dir.path().join("key");
        write_private(&path, b"key").unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert!(write_private(&path, b"other").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"key");
    }

    /// A private temporary folder, removed with its contents, without a crate.
    mod tempfile_dir {
        pub struct Dir(std::path::PathBuf);
        impl Dir {
            pub fn new() -> Self {
                use std::sync::atomic::{AtomicU64, Ordering};
                static NEXT: AtomicU64 = AtomicU64::new(0);
                let path = std::env::temp_dir().join(format!(
                    "voco-update-test-{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::SeqCst)
                ));
                std::fs::create_dir(&path).unwrap();
                Self(path)
            }
            pub fn path(&self) -> &std::path::Path {
                &self.0
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    /// The real gpgv and the real 0.65 manifest, where both are present.
    #[test]
    #[ignore = "needs /usr/bin/gpgv and VOCO_UPDATE_TEST_RELEASE, a folder with a release's signed manifest"]
    fn a_real_release_manifest_verifies_and_a_changed_one_does_not() {
        let release = std::path::PathBuf::from(std::env::var("VOCO_UPDATE_TEST_RELEASE").unwrap());
        let dir = work();
        let checksums = dir.path().join(CHECKSUMS);
        let signature = dir.path().join(SIGNATURE);
        std::fs::copy(release.join(CHECKSUMS), &checksums).unwrap();
        std::fs::copy(release.join(SIGNATURE), &signature).unwrap();
        assert_eq!(verify_signature(dir.path(), &checksums, &signature), Ok(()));
        let mut changed = std::fs::read(&checksums).unwrap();
        changed[0] ^= 1;
        std::fs::write(&checksums, changed).unwrap();
        assert_eq!(verify_signature(dir.path(), &checksums, &signature), Err(VerifyError::Signature));
    }
}
