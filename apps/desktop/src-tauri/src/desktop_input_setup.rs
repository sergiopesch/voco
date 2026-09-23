//! Migrate only VOCO's packaged input service while no app can be recording.

use crate::{process_runner, single_instance::SingleInstanceGuard};
use std::path::Path;
use std::time::Duration;

pub(crate) struct SetupError {
    pub detail: String,
    pub service_may_change: bool,
}

fn failure(detail: String, service_may_change: bool) -> SetupError {
    SetupError {
        detail,
        service_may_change,
    }
}

fn migration_may_continue(exit_code: Option<i32>) -> bool {
    // Killing a systemctl client cannot cancel an already enqueued service job.
    // The launcher uses 70 for pending transitions or an unconfirmed restart.
    matches!(exit_code, None | Some(70))
}

fn is_installed_wayland_app(executable: &Path, session: &str) -> bool {
    executable == Path::new("/usr/bin/voco") && session.eq_ignore_ascii_case("wayland")
}

/// Borrow the process guard through completion: another VOCO process must not
/// start recording between service inspection and the bounded migration.
pub(crate) fn migrate(_guard: &SingleInstanceGuard) -> Result<String, SetupError> {
    let executable = std::env::current_exe().map_err(|error| {
        failure(
            format!("Could not identify the installed application: {error}"),
            false,
        )
    })?;
    let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    if !is_installed_wayland_app(&executable, &session) {
        return Ok("Input service migration is only needed by the installed Wayland app.".into());
    }

    let child = process_runner::command("/usr/bin/python3")
        .args(["-I", "/usr/libexec/voco/ydotool-launcher", "--migrate"])
        .spawn()
        .map_err(|error| {
            failure(
                format!("Could not start desktop input setup: {error}"),
                false,
            )
        })?;
    let output = process_runner::wait_with_output(child, Duration::from_secs(5), 16 * 1024)
        .map_err(|error| {
            failure(
                format!("Desktop input setup did not complete: {error}"),
                true,
            )
        })?;
    if !output.status.success() {
        return Err(failure(
            format!(
                "Desktop input setup failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
            migration_may_continue(output.status.code()),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracted_and_development_apps_never_migrate_the_owner_service() {
        for executable in ["/tmp/candidate/usr/bin/voco", "/tmp/target/debug/voco"] {
            assert!(!is_installed_wayland_app(Path::new(executable), "wayland"));
        }
        assert!(!is_installed_wayland_app(Path::new("/usr/bin/voco"), "x11"));
        assert!(!is_installed_wayland_app(Path::new("/usr/bin/voco"), ""));
        assert!(is_installed_wayland_app(
            Path::new("/usr/bin/voco"),
            "wayland"
        ));
    }

    #[test]
    fn unconfirmed_service_changes_cannot_start_a_recording_app() {
        assert!(migration_may_continue(Some(70)));
        assert!(migration_may_continue(None));
        assert!(!migration_may_continue(Some(1)));
        assert!(!migration_may_continue(Some(0)));
    }
}
