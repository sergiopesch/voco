//! Install update (AGENTS.md, Installer and packages): download the release
//! into the private update folder, verify it, install it through pkexec and
//! the packaged helper, then restart.
//!
//! One install runs at a time, on its own thread. The renderer follows it
//! through `voco:update-install` events and can cancel only the download:
//! once the password prompt is up, the system owns what happens.

use crate::update_download::{self, Cancel, DownloadError, Progress};
use crate::update_verify::{self, PackageKind, VerifyError, Version};
use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

pub const EVENT: &str = "voco:update-install";
const PKEXEC: &str = "/usr/bin/pkexec";
const HELPER: &str = "/usr/libexec/voco-update-helper";
const INSTALLED_APP: &str = "/usr/bin/voco";
/// pkexec's own exit codes: the prompt dismissed, or the action not allowed.
const PKEXEC_DISMISSED: i32 = 126;
const PKEXEC_NOT_AUTHORIZED: i32 = 127;
/// The helper's, from `voco-update-helper.rs`.
const HELPER_REFUSED: i32 = 10;
const HELPER_INSTALL_FAILED: i32 = 11;
const HELPER_NOT_INSTALLED: i32 = 12;
/// The most of the helper's error output kept for the message.
const HELPER_ERROR_BYTES: u64 = 4096;
const MANUAL: &str = "You can still update with the installer command on the release page.";

/// What the renderer shows. `received` and `total` come with downloading.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "stage")]
pub enum InstallEvent {
    Downloading {
        version: String,
        file: usize,
        files: usize,
        received: u64,
        total: Option<u64>,
    },
    Verifying {
        version: String,
    },
    /// The system's password prompt is up.
    Authorizing {
        version: String,
    },
    Installing {
        version: String,
    },
    /// Installed; waiting for dictation to finish, if one started meanwhile.
    Installed {
        version: String,
    },
    Restarting {
        version: String,
    },
    Cancelled {
        version: String,
    },
    Failed {
        version: String,
        message: String,
    },
}

#[derive(Default)]
struct Job {
    running: bool,
    /// Present only while the download may still be cancelled.
    cancel: Option<Cancel>,
}

static JOB: Mutex<Job> = Mutex::new(Job {
    running: false,
    cancel: None,
});

/// Why Install update can't run here, if it can't: the snap and the source
/// build update another way.
pub fn unavailable_reason(
    is_snap: bool,
    executable: Option<&Path>,
    kind: Option<PackageKind>,
) -> Option<&'static str> {
    if is_snap {
        return Some("The Snap Store keeps VOCO up to date.");
    }
    if executable != Some(Path::new(INSTALLED_APP)) {
        return Some("This VOCO isn't the installed package, so it can't update itself.");
    }
    if kind.is_none() {
        return Some("This system has neither APT nor DNF.");
    }
    None
}

/// The guided installer's choice, as the helper makes it.
pub fn package_kind() -> Option<PackageKind> {
    let present = |path: &str| Path::new(path).is_file();
    if present("/usr/bin/apt-get") && present("/usr/bin/dpkg-query") {
        Some(PackageKind::Deb)
    } else if present("/usr/bin/dnf") && present("/usr/bin/rpm") {
        Some(PackageKind::Rpm)
    } else {
        None
    }
}

/// Only a newer release than this one is ever downloaded.
pub fn target_version(requested: &str, current: &str) -> Result<Version, &'static str> {
    let version = Version::parse(requested).ok_or("That isn't a VOCO release version.")?;
    match Version::parse(current) {
        Some(current) if version <= current => {
            Err("VOCO is already on this release or a newer one.")
        }
        _ => Ok(version),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

/// Whether Settings offers Install update on this installation.
#[tauri::command]
pub fn update_install_availability() -> Availability {
    let executable = std::env::current_exe().ok();
    let reason = unavailable_reason(
        crate::confinement::is_snap(),
        executable.as_deref(),
        package_kind(),
    );
    Availability {
        available: reason.is_none(),
        reason,
    }
}

/// Start installing `version`. Returns at once; events report the rest.
#[tauri::command]
pub fn install_update(app: tauri::AppHandle, version: String) -> Result<(), String> {
    let executable = std::env::current_exe().ok();
    let kind = package_kind();
    if let Some(reason) =
        unavailable_reason(crate::confinement::is_snap(), executable.as_deref(), kind)
    {
        return Err(reason.into());
    }
    let kind = kind.ok_or("This system has neither APT nor DNF.")?;
    let version = target_version(&version, env!("CARGO_PKG_VERSION"))?;
    if crate::tray::dictation_active(&app) {
        return Err("Finish dictating first, then install the update.".into());
    }
    let cancel = Cancel::default();
    {
        let mut job = JOB.lock().map_err(|_| "Install update is unavailable.")?;
        if job.running {
            return Err("An update is already being installed.".into());
        }
        job.running = true;
        job.cancel = Some(cancel.clone());
    }
    let spawned = std::thread::Builder::new()
        .name("voco-update-install".into())
        .spawn(move || {
            let restart = run(&app, kind, version, &cancel);
            if let Ok(mut job) = JOB.lock() {
                job.running = false;
                job.cancel = None;
            }
            if restart {
                restart_after_install(&app, version);
            }
        });
    if spawned.is_err() {
        if let Ok(mut job) = JOB.lock() {
            job.running = false;
            job.cancel = None;
        }
        return Err("VOCO couldn't start the update.".into());
    }
    Ok(())
}

/// Stop the download. Once the password prompt is up, nothing is cancelled.
#[tauri::command]
pub fn cancel_update_install() -> bool {
    JOB.lock()
        .ok()
        .and_then(|job| job.cancel.clone())
        .map(|cancel| cancel.cancel())
        .is_some()
}

fn emit(app: &tauri::AppHandle, event: InstallEvent) {
    if let Err(error) = app.emit_to("main", EVENT, &event) {
        log::warn!("Failed to report the update's progress: {error}");
    }
}

/// The whole install. True when it succeeded and VOCO should restart.
fn run(app: &tauri::AppHandle, kind: PackageKind, version: Version, cancel: &Cancel) -> bool {
    let name = version.to_string();
    let failed = |message: String| InstallEvent::Failed {
        version: name.clone(),
        message: format!("{message} Nothing was installed. {MANUAL}"),
    };
    let folder = match update_download::folder(&crate::xdg_state_home())
        .and_then(|folder| update_download::clear(&folder).map(|()| folder))
    {
        Ok(folder) => folder,
        Err(error) => {
            emit(
                app,
                failed(format!("VOCO couldn't prepare its update folder: {error}.")),
            );
            return false;
        }
    };
    let outcome = download_and_verify(app, kind, &version, &folder, cancel);
    let finish = |event: InstallEvent| {
        let _ = update_download::clear(&folder);
        emit(app, event);
        false
    };
    match outcome {
        Ok(()) => {}
        Err(Stop::Cancelled) => {
            return finish(InstallEvent::Cancelled {
                version: name.clone(),
            })
        }
        Err(Stop::Failed(message)) => return finish(failed(message)),
    }
    // From here the download can't be cancelled: the prompt is the system's.
    if let Ok(mut job) = JOB.lock() {
        job.cancel = None;
    }
    if crate::tray::dictation_active(app) {
        return finish(failed(
            "A dictation started, so VOCO didn't install the update.".into(),
        ));
    }
    emit(
        app,
        InstallEvent::Authorizing {
            version: name.clone(),
        },
    );
    let result = run_helper(&folder, &version, |line| {
        if let Some(event) = stage_event(line, &name) {
            emit(app, event);
        }
    });
    let _ = update_download::clear(&folder);
    match result {
        Ok(()) => {
            emit(app, InstallEvent::Installed { version: name });
            true
        }
        Err(message) => {
            emit(
                app,
                InstallEvent::Failed {
                    version: name,
                    message: format!("{message} {MANUAL}"),
                },
            );
            false
        }
    }
}

enum Stop {
    Cancelled,
    Failed(String),
}

fn download_and_verify(
    app: &tauri::AppHandle,
    kind: PackageKind,
    version: &Version,
    folder: &Path,
    cancel: &Cancel,
) -> Result<(), Stop> {
    let name = version.to_string();
    let assets = update_download::assets(kind, version);
    let files = assets.len();
    for (index, asset) in assets.iter().enumerate() {
        let limit = if index + 1 == files {
            update_verify::MAX_PACKAGE_BYTES
        } else {
            update_verify::MAX_MANIFEST_BYTES
        };
        let url = update_download::asset_url(version, asset);
        update_download::fetch(
            &url,
            &folder.join(asset),
            limit,
            cancel,
            |progress: Progress| {
                emit(
                    app,
                    InstallEvent::Downloading {
                        version: name.clone(),
                        file: index + 1,
                        files,
                        received: progress.received,
                        total: progress.total,
                    },
                )
            },
        )
        .map_err(|error| match error {
            DownloadError::Cancelled => Stop::Cancelled,
            error => Stop::Failed(error.to_string()),
        })?;
    }
    if cancel.is_cancelled() {
        return Err(Stop::Cancelled);
    }
    emit(app, InstallEvent::Verifying { version: name });
    verify(kind, version, folder).map_err(|error| Stop::Failed(error.to_string()))
}

/// The installer's checks, in its order, on the downloaded files.
fn verify(kind: PackageKind, version: &Version, folder: &Path) -> Result<(), VerifyError> {
    let checksums = folder.join(update_verify::CHECKSUMS);
    let package = folder.join(kind.asset_name(version));
    update_verify::verify_signature(folder, &checksums, &folder.join(update_verify::SIGNATURE))?;
    let manifest = update_verify::read_manifest(&checksums)?;
    update_verify::verify_package(&manifest, kind, version, &package)?;
    update_verify::verify_identity(kind, version, &package)
}

/// The event for one of the helper's `VOCO-UPDATE` stage lines, if it names one.
fn stage_event(line: &str, version: &str) -> Option<InstallEvent> {
    let version = version.to_string();
    match line.strip_prefix("VOCO-UPDATE ")? {
        // The helper reports verifying once the password was accepted.
        "verifying" | "installing" => Some(InstallEvent::Installing { version }),
        _ => None,
    }
}

/// What the user reads for the helper's exit, with its own words when it refused.
fn helper_failure(code: Option<i32>, detail: &str) -> String {
    let detail = detail
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix("voco-update-helper: "))
        .map(str::trim)
        .filter(|detail| !detail.is_empty());
    let with_detail = |lead: &str| match detail {
        Some(detail) => format!("{lead}: {detail}."),
        None => format!("{lead}."),
    };
    match code {
        Some(PKEXEC_DISMISSED) => {
            "The password prompt was dismissed, so nothing was installed.".into()
        }
        Some(PKEXEC_NOT_AUTHORIZED) => {
            "This account isn't allowed to install updates, so nothing was installed.".into()
        }
        Some(HELPER_REFUSED) => format!(
            "{} Nothing was installed.",
            with_detail("The update was refused")
        ),
        Some(HELPER_INSTALL_FAILED) => {
            with_detail("The package manager couldn't install the update")
        }
        Some(HELPER_NOT_INSTALLED) => with_detail("The update didn't take"),
        _ => with_detail("The update stopped"),
    }
}

/// Run the helper through pkexec, reporting each stage it prints.
fn run_helper(folder: &Path, version: &Version, mut stage: impl FnMut(&str)) -> Result<(), String> {
    run_helper_with(
        PKEXEC,
        &[
            HELPER.as_ref(),
            folder.as_os_str(),
            version.to_string().as_ref(),
        ],
        &mut stage,
    )
}

fn run_helper_with(
    program: &str,
    arguments: &[&std::ffi::OsStr],
    stage: &mut impl FnMut(&str),
) -> Result<(), String> {
    let mut child = Command::new(program)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("VOCO couldn't ask for the administrator's password: {error}."))?;
    let stderr = child.stderr.take();
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(stderr) = stderr {
            let _ = stderr.take(HELPER_ERROR_BYTES).read_to_string(&mut text);
        }
        text
    });
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            stage(&line);
        }
    }
    let status = child
        .wait()
        .map_err(|error| format!("The update stopped: {error}."))?;
    let detail = errors.join().unwrap_or_default();
    if status.success() {
        Ok(())
    } else {
        Err(helper_failure(status.code(), &detail))
    }
}

/// After an install, wait for any dictation to end, then start the new VOCO
/// once this one has gone, as the installer's detached launch does.
fn restart_after_install(app: &tauri::AppHandle, version: Version) {
    while crate::tray::dictation_active(app) {
        std::thread::sleep(Duration::from_millis(250));
    }
    let name = version.to_string();
    match spawn_relaunch(std::process::id()) {
        Ok(()) => {
            emit(app, InstallEvent::Restarting { version: name });
            // Give the renderer a moment to show it.
            std::thread::sleep(Duration::from_millis(600));
            app.exit(0);
        }
        Err(error) => {
            log::warn!("Couldn't restart VOCO after the update: {error}");
            emit(
                app,
                InstallEvent::Failed {
                    version: name.clone(),
                    message: format!(
                        "VOCO {name} is installed, but VOCO couldn't restart itself. Quit VOCO and open it again."
                    ),
                },
            );
        }
    }
}

/// A shell in its own session waits up to 10 s for `pid` to exit, then starts
/// the installed VOCO with this desktop's environment. A VOCO that's still
/// running would only take the start as a request to show itself.
fn spawn_relaunch(pid: u32) -> std::io::Result<()> {
    let mut command = relaunch_command(pid, INSTALLED_APP);
    // SAFETY: setsid is async-signal-safe and touches no memory.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    command.spawn().map(drop)
}

fn relaunch_command(pid: u32, app: &str) -> Command {
    let mut command = Command::new("/bin/sh");
    command
        .arg("-c")
        .arg(r#"i=0; while kill -0 "$1" 2>/dev/null && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done; exec "$2""#)
        .arg("voco-relaunch")
        .arg(pid.to_string())
        .arg(app)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_installed_package_updates_itself() {
        let installed = Some(Path::new("/usr/bin/voco"));
        assert_eq!(
            unavailable_reason(false, installed, Some(PackageKind::Deb)),
            None
        );
        assert_eq!(
            unavailable_reason(false, installed, Some(PackageKind::Rpm)),
            None
        );
        assert!(unavailable_reason(true, installed, Some(PackageKind::Deb))
            .unwrap()
            .contains("Snap Store"));
        for build in [Some(Path::new("/home/u/voco/target/release/voco")), None] {
            assert!(unavailable_reason(false, build, Some(PackageKind::Deb)).is_some());
        }
        assert!(unavailable_reason(false, installed, None).is_some());
    }

    #[test]
    fn only_a_newer_release_is_installed() {
        assert_eq!(
            target_version("2026.0.66", "2026.0.65")
                .unwrap()
                .to_string(),
            "2026.0.66"
        );
        assert_eq!(
            target_version("2027.0.1", "2026.0.65").unwrap().to_string(),
            "2027.0.1"
        );
        for older_or_same in ["2026.0.65", "2026.0.64", "2025.0.99"] {
            assert!(
                target_version(older_or_same, "2026.0.65").is_err(),
                "{older_or_same}"
            );
        }
        for invalid in [
            "v2026.0.66",
            "voco.2026.0.66",
            "2026.1.66",
            "2026.0.66-beta",
            "../x",
            "",
        ] {
            assert!(target_version(invalid, "2026.0.65").is_err(), "{invalid}");
        }
    }

    #[test]
    fn the_helpers_stages_and_exits_read_as_the_user_should_see_them() {
        assert_eq!(
            stage_event("VOCO-UPDATE verifying", "2026.0.66"),
            Some(InstallEvent::Installing {
                version: "2026.0.66".into()
            })
        );
        assert_eq!(
            stage_event("VOCO-UPDATE installed 2026.0.66", "2026.0.66"),
            None
        );
        assert_eq!(stage_event("Reading package lists...", "2026.0.66"), None);
        assert!(helper_failure(Some(126), "").contains("dismissed"));
        assert!(helper_failure(Some(127), "").contains("allowed"));
        assert_eq!(
            helper_failure(Some(10), "noise\nvoco-update-helper: VOCO 2026.0.66 is installed, not older than 2026.0.66\n"),
            "The update was refused: VOCO 2026.0.66 is installed, not older than 2026.0.66. Nothing was installed."
        );
        assert!(
            helper_failure(Some(11), "voco-update-helper: apt-get exited with 100")
                .ends_with("apt-get exited with 100.")
        );
        assert!(helper_failure(None, "").starts_with("The update stopped"));
    }

    #[test]
    fn the_helper_runs_and_reports_its_stages_and_failure() {
        let mut seen = Vec::new();
        let script = "echo 'VOCO-UPDATE verifying'; echo 'VOCO-UPDATE installing'; echo 'voco-update-helper: apt-get exited with 100' >&2; exit 11";
        let result = run_helper_with(
            "/bin/sh",
            &["-c".as_ref(), script.as_ref()],
            &mut |line: &str| {
                seen.push(line.to_string());
            },
        );
        assert_eq!(seen, ["VOCO-UPDATE verifying", "VOCO-UPDATE installing"]);
        assert_eq!(
            result.unwrap_err(),
            "The package manager couldn't install the update: apt-get exited with 100."
        );
        assert!(run_helper_with("/bin/true", &[], &mut |_: &str| {}).is_ok());
        assert!(run_helper_with("/nonexistent/pkexec", &[], &mut |_: &str| {}).is_err());
    }

    #[test]
    fn the_relaunch_waits_for_this_voco_to_exit() {
        let dir = std::env::temp_dir().join(format!("voco-relaunch-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("launched");
        let app = dir.join("app.sh");
        std::fs::write(&app, format!("#!/bin/sh\ntouch '{}'\n", marker.display())).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&app, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut waited_on = Command::new("/bin/sleep").arg("0.5").spawn().unwrap();
        let mut relaunch = relaunch_command(waited_on.id(), app.to_str().unwrap())
            .spawn()
            .unwrap();
        std::thread::sleep(Duration::from_millis(250));
        assert!(!marker.exists(), "launched before the old VOCO exited");
        waited_on.wait().unwrap();
        assert!(relaunch.wait().unwrap().success());
        assert!(marker.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn events_serialize_for_the_renderer() {
        let event = InstallEvent::Downloading {
            version: "2026.0.66".into(),
            file: 3,
            files: 3,
            received: 10,
            total: Some(20),
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({"stage":"downloading","version":"2026.0.66","file":3,"files":3,"received":10,"total":20})
        );
        assert_eq!(
            serde_json::to_value(InstallEvent::Failed {
                version: "2026.0.66".into(),
                message: "x".into()
            })
            .unwrap(),
            serde_json::json!({"stage":"failed","version":"2026.0.66","message":"x"})
        );
    }
}
