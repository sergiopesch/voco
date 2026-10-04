//! Bounded, explicit companion setup; no package hook changes a user profile.
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

/// How long a companion check may be reused. Attach, detach, name loss and
/// explicit checks clear it sooner; the TTL catches edits on disk.
const CHECK_TTL: Duration = Duration::from_secs(20);
/// A failed check, or a Shell that did not answer, may be a slow start at
/// login, so it is retried soon; a missing python3 still isn't started every poll.
const FAILED_CHECK_TTL: Duration = Duration::from_secs(2);

type CheckResult = Result<PanelSetupStatus, String>;

#[derive(Default)]
struct CheckCache {
    generation: u64,
    /// When the result stops being reused, and the result.
    entry: Option<(Instant, CheckResult)>,
}

static CHECK_CACHE: Mutex<CheckCache> = Mutex::new(CheckCache {
    generation: 0,
    entry: None,
});

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelSetupStatus {
    pub status: String,
    pub detail: String,
    pub can_enable: bool,
}

/// On Wayland only the desktop can consume these chords: VOCO's GNOME panel,
/// or elsewhere a desktop keybinding for `voco --toggle`. Passive evdev
/// observation alone lets the focused application also act on them (Alt+D
/// focuses a browser address or deletes a terminal word), moving the cursor.
pub fn stop_shortcut_setup_detail(
    session_type: &str,
    hotkey: &str,
    status: Result<PanelSetupStatus, String>,
    attached: bool,
) -> Option<String> {
    if !session_type.eq_ignore_ascii_case("wayland")
        || !(hotkey.eq_ignore_ascii_case("Alt+D") || hotkey.eq_ignore_ascii_case("Alt+Shift+D"))
    {
        return None;
    }
    let Ok(panel) = status else {
        return Some(format!(
            "VOCO cannot confirm that GNOME keeps {hotkey} out of the app you are dictating into. Check the VOCO panel in Help."
        ));
    };
    let remedy = match panel.status.as_str() {
        "active" if attached => return None,
        "active" => "VOCO's GNOME panel is enabled but not connected yet. Reopen VOCO, or sign out and back in.".into(),
        "disabled" => "Enable the VOCO panel in Help to keep the shortcut out of other apps.".into(),
        "other-desktop" | "unsupported" => "To avoid that, choose another shortcut in VOCO and assign `voco --toggle` to it in your desktop's keyboard settings.".into(),
        _ => panel.detail,
    };
    Some(format!(
        "{hotkey} also reaches the app you are dictating into: browsers move the cursor to the address bar, so your words land there, and terminals delete a word. {remedy}"
    ))
}

pub fn check(enable: bool) -> Result<PanelSetupStatus, String> {
    let child = crate::process_runner::command("/usr/bin/python3")
        .args([
            "-I",
            "-c",
            include_str!("../resources/voco_gnome_panel.py"),
            if enable { "--enable" } else { "--check" },
        ])
        .spawn()
        .map_err(|_| "Panel status is unavailable".to_string())?;
    let output = crate::process_runner::wait_with_output(child, Duration::from_secs(4), 4096)?;
    if !output.status.success() {
        return Err("Panel status is unavailable".to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "Invalid panel setup response".to_string())
}

/// `check(false)` for the shortcut recommendation, read by the once-a-second
/// diagnostics poll, the setup input check and the once-per-launch passive
/// shortcut notice; each would otherwise start python3 and GI. Explicit setup
/// status stays uncached.
pub fn cached_check() -> CheckResult {
    cached_check_with(&CHECK_CACHE, Instant::now, || check(false))
}

/// Forget the cached check: the companion attached, detached or was enabled,
/// or an explicit check saw its current state.
pub fn invalidate_check() {
    invalidate(&CHECK_CACHE);
}

fn invalidate(cache: &Mutex<CheckCache>) {
    let mut cache = cache.lock().unwrap_or_else(PoisonError::into_inner);
    cache.generation = cache.generation.wrapping_add(1);
    cache.entry = None;
}

fn cached_check_with(
    cache: &Mutex<CheckCache>,
    now: impl Fn() -> Instant,
    check: impl FnOnce() -> CheckResult,
) -> CheckResult {
    let started = now();
    let generation = {
        let cache = cache.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some((expires, result)) = &cache.entry {
            if started < *expires {
                return result.clone();
            }
        }
        cache.generation
    };
    // The bounded check runs unlocked. Keep its result only if nothing
    // invalidated the cache meanwhile, so a stale answer cannot outlive Attach.
    let result = check();
    // A success ages from when the check began. A failure waits from when it
    // returned, so a helper that timed out is not restarted back to back.
    let expires = match &result {
        Ok(setup) if setup.status != "unavailable" => started + CHECK_TTL,
        _ => now() + FAILED_CHECK_TTL,
    };
    let mut cache = cache.lock().unwrap_or_else(PoisonError::into_inner);
    if cache.generation == generation {
        cache.entry = Some((expires, result.clone()));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn panel(status: &str) -> Result<PanelSetupStatus, String> {
        Ok(PanelSetupStatus {
            status: status.into(),
            detail: "Sign out and back in to load the shortcut.".into(),
            can_enable: false,
        })
    }

    #[test]
    fn default_wayland_shortcut_recommends_live_companion() {
        let detail = stop_shortcut_setup_detail("wayland", "Alt+D", panel("restart"), false)
            .expect("unloaded companion is recommended");
        assert!(detail.starts_with("Alt+D also reaches the app you are dictating into"));
        assert!(detail.ends_with("Sign out and back in to load the shortcut."));
        assert!(
            stop_shortcut_setup_detail("wayland", "Alt+Shift+D", panel("disabled"), false)
                .is_some_and(|detail| detail.contains("Enable the VOCO panel"))
        );
        assert!(stop_shortcut_setup_detail("wayland", "alt+d", panel("restart"), false).is_some());
        assert!(stop_shortcut_setup_detail("wayland", "Alt+D", Err("bus".into()), false).is_some());
        assert!(stop_shortcut_setup_detail("wayland", "Alt+D", panel("active"), false).is_some());
        assert!(stop_shortcut_setup_detail("wayland", "Alt+D", panel("active"), true).is_none());
        // Without a companion that can grab the chord, evdev only observes it.
        for status in ["other-desktop", "unsupported"] {
            assert!(
                stop_shortcut_setup_detail("wayland", "Alt+D", panel(status), false)
                    .is_some_and(|detail| detail.contains("voco --toggle"))
            );
        }
        // A previous companion that is still loaded attaches without grabbing Start.
        assert!(stop_shortcut_setup_detail("wayland", "Alt+D", panel("restart"), true).is_some());
        assert!(stop_shortcut_setup_detail("x11", "Alt+D", panel("restart"), false).is_none());
        assert!(
            stop_shortcut_setup_detail("wayland", "Control+Space", panel("restart"), false)
                .is_none()
        );
    }

    #[test]
    fn cached_check_is_reused_until_invalidated_or_expired() {
        let cache = Mutex::new(CheckCache::default());
        let start = Instant::now();
        let clock = Cell::new(start);
        let now = || clock.get();
        let runs = Cell::new(0);
        let check = || {
            runs.set(runs.get() + 1);
            panel("active")
        };
        let status = |result: CheckResult| result.map(|setup| setup.status);

        assert_eq!(
            status(cached_check_with(&cache, now, check)),
            Ok("active".into())
        );
        clock.set(start + CHECK_TTL / 2);
        assert_eq!(
            status(cached_check_with(&cache, now, check)),
            Ok("active".into())
        );
        assert_eq!(runs.get(), 1, "a fresh check is reused");

        invalidate(&cache);
        assert!(cached_check_with(&cache, now, check).is_ok());
        assert_eq!(
            runs.get(),
            2,
            "attach, detach and enabling force a new check"
        );

        clock.set(start + CHECK_TTL / 2 + CHECK_TTL);
        assert!(cached_check_with(&cache, now, check).is_ok());
        assert_eq!(runs.get(), 3, "the TTL catches changes on disk");

        // A check that races an invalidation is returned but never reused.
        clock.set(start + CHECK_TTL * 4);
        let raced = cached_check_with(&cache, now, || {
            invalidate(&cache);
            panel("restart")
        });
        assert_eq!(status(raced), Ok("restart".into()));
        assert_eq!(
            status(cached_check_with(&cache, now, check)),
            Ok("active".into())
        );
        assert_eq!(runs.get(), 4);

        // A failure, or a Shell that did not answer, is reused only briefly:
        // a missing python3 is not started every poll, yet a transient D-Bus
        // timeout cannot hold a false recommendation for the full TTL.
        for failure in [Err("bus".to_string()), panel("unavailable")] {
            invalidate(&cache);
            let failed = cached_check_with(&cache, now, || {
                clock.set(clock.get() + Duration::from_secs(4)); // the helper timed out
                failure.clone()
            });
            assert_eq!(status(failed), status(failure.clone()));
            let before = runs.get();
            assert_eq!(
                status(cached_check_with(&cache, now, check)),
                status(failure.clone())
            );
            assert_eq!(runs.get(), before, "reused just after the slow check");
            clock.set(clock.get() + FAILED_CHECK_TTL);
            assert_eq!(
                status(cached_check_with(&cache, now, check)),
                Ok("active".into())
            );
            assert_eq!(runs.get(), before + 1, "then checked again");
        }
    }
}
