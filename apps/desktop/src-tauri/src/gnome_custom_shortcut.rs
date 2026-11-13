//! VOCO's entry in GNOME's custom keyboard shortcuts, which holds the snap's
//! shortcut on GNOME Wayland (gnome_shortcut.rs; AGENTS.md, Shortcut). VOCO
//! adds it only when no GNOME window shortcut or other custom shortcut uses
//! the chord, and never changes another.
//!
//! GNOME's own schema for these keys isn't in the snap's runtime, so the snap
//! carries the same IDs, paths and types (packaging/snap/schemas).

use webkit2gtk::gio::{self, prelude::*};

const MEDIA_KEYS: &str = "org.gnome.settings-daemon.plugins.media-keys";
const CUSTOM: &str = "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding";
const LIST: &str = "custom-keybindings";
const VOCO_PATH: &str = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/voco/";
const WINDOW_KEYBINDINGS: &str = "org.gnome.desktop.wm.keybindings";
const NAME: &str = "VOCO";

fn schema(id: &str) -> Option<gio::SettingsSchema> {
    gio::SettingsSchemaSource::default()?.lookup(id, true)
}

fn settings(id: &str, path: Option<&str>) -> Option<gio::Settings> {
    let schema = schema(id)?;
    Some(gio::Settings::new_full(
        &schema,
        None::<&gio::SettingsBackend>,
        path,
    ))
}

/// The snap can write GNOME's custom shortcuts.
pub fn available() -> bool {
    schema(MEDIA_KEYS).is_some() && schema(CUSTOM).is_some()
}

/// What VOCO's shortcut ran before it called VOCO over D-Bus: this snap's
/// `voco --toggle`, a snap launch of about 150 ms for each press and repeat.
fn launch_command() -> String {
    let instance = std::env::var("SNAP_INSTANCE_NAME").unwrap_or_else(|_| "voco".into());
    format!("/snap/bin/{instance} --toggle")
}

/// The command GNOME runs for each press, and each repeat while the chord is
/// held: a call of the running VOCO's Toggle (panel.rs), which arrives in a
/// few milliseconds, and where that fails, `voco --toggle` as before: no
/// `dbus-send` on this system, or a VOCO from before Toggle after a revert.
/// GNOME splits the command as a shell would but runs no shell, hence `sh`.
fn command() -> String {
    format!(
        "sh -c 'dbus-send --session --print-reply --reply-timeout=2000 --dest={name} {path} {interface}.Toggle >/dev/null 2>&1 || {launch}'",
        name = crate::panel::NAME,
        path = crate::panel::PATH,
        interface = crate::panel::INTERFACE,
        launch = launch_command(),
    )
}

/// VOCO's own shortcut, added by a VOCO that launched `voco --toggle`, takes
/// the current command. Its keys, and every other shortcut, stay as they are.
pub fn update_command() {
    let Some(media_keys) = settings(MEDIA_KEYS, None) else {
        return;
    };
    if !custom_paths(&media_keys)
        .iter()
        .any(|path| path == VOCO_PATH)
    {
        return;
    }
    let Some(voco) = settings(CUSTOM, Some(VOCO_PATH)) else {
        return;
    };
    if voco.string("command") == launch_command() {
        if let Err(error) = voco.set_string("command", &command()) {
            log::warn!("Could not update the command of VOCO's GNOME shortcut: {error}");
        }
        gio::Settings::sync();
    }
}

/// GTK accelerators compare without case or modifier order: "<Super>x" and
/// "<super>X" are one chord.
fn same_chord(first: &str, second: &str) -> bool {
    fn parts(accelerator: &str) -> (Vec<String>, String) {
        let lower = accelerator.trim().to_ascii_lowercase();
        let mut modifiers = Vec::new();
        let mut rest = lower.as_str();
        while let Some(start) = rest.strip_prefix('<') {
            let Some(end) = start.find('>') else { break };
            let name = &start[..end];
            modifiers.push(match name {
                "control" | "ctrl" | "primary" => "control".to_owned(),
                other => other.to_owned(),
            });
            rest = &start[end + 1..];
        }
        modifiers.sort();
        (modifiers, rest.to_owned())
    }
    !first.trim().is_empty() && parts(first) == parts(second)
}

fn custom_paths(media_keys: &gio::Settings) -> Vec<String> {
    media_keys
        .strv(LIST)
        .iter()
        .map(|path| path.to_string())
        .collect()
}

/// What already uses `accelerator`, by its name in GNOME, if anything.
fn conflict(accelerator: &str, media_keys: &gio::Settings) -> Option<String> {
    if let Some(window) = settings(WINDOW_KEYBINDINGS, None) {
        if let Some(schema) = schema(WINDOW_KEYBINDINGS) {
            for key in schema.list_keys() {
                let value = window.value(&key);
                let Some(bindings) = value.get::<Vec<String>>() else {
                    continue;
                };
                if bindings
                    .iter()
                    .any(|binding| same_chord(binding, accelerator))
                {
                    return Some(format!("GNOME's {key} shortcut"));
                }
            }
        }
    }
    for path in custom_paths(media_keys) {
        if path == VOCO_PATH {
            continue;
        }
        let Some(custom) = settings(CUSTOM, Some(&path)) else {
            continue;
        };
        if same_chord(&custom.string("binding"), accelerator) {
            let name = custom.string("name");
            return Some(if name.is_empty() {
                "another custom shortcut".to_owned()
            } else {
                format!("your custom shortcut “{name}”")
            });
        }
    }
    None
}

/// GNOME lists VOCO's custom shortcut, whatever its keys and command.
pub fn listed() -> bool {
    settings(MEDIA_KEYS, None).is_some_and(|media_keys| {
        custom_paths(&media_keys)
            .iter()
            .any(|path| path == VOCO_PATH)
    })
}

/// VOCO's custom shortcut exists for `accelerator`.
pub fn present(accelerator: &str) -> bool {
    listed()
        && settings(CUSTOM, Some(VOCO_PATH)).is_some_and(|voco| {
            same_chord(&voco.string("binding"), accelerator) && voco.string("command") == command()
        })
}

/// The keys of VOCO's custom shortcut, as GNOME holds them: "<Super>x". None
/// when GNOME lists none, or it has no keys.
pub fn binding() -> Option<String> {
    if !listed() {
        return None;
    }
    let binding = settings(CUSTOM, Some(VOCO_PATH))?.string("binding");
    (!binding.trim().is_empty()).then(|| binding.to_string())
}

/// The command of VOCO's custom shortcut as GNOME holds it, for the portal
/// suite (portal_fixture.rs).
#[cfg(test)]
pub(crate) fn command_of_voco() -> Option<String> {
    listed()
        .then(|| settings(CUSTOM, Some(VOCO_PATH)).map(|voco| voco.string("command").to_string()))
        .flatten()
}

/// Calls `changed` with the keys of VOCO's custom shortcut whenever they
/// change while GNOME lists it, as GNOME Settings does under Keyboard. The
/// signal arrives on the calling thread's main context for as long as the
/// returned settings live.
pub fn watch(changed: impl Fn(&str) + 'static) -> Option<gio::Settings> {
    let voco = settings(CUSTOM, Some(VOCO_PATH))?;
    voco.connect_changed(Some("binding"), move |_, _| {
        if let Some(binding) = binding() {
            changed(&binding);
        }
    });
    // GSettings reports changes of a key only once it has been read.
    let _ = voco.string("binding");
    Some(voco)
}

/// Adds VOCO's custom shortcut for `accelerator` ("<Super>x"), or says what
/// already uses it.
pub fn add(accelerator: &str, label: &str) -> Result<(), String> {
    let media_keys = settings(MEDIA_KEYS, None)
        .ok_or_else(|| "VOCO can't reach GNOME's keyboard shortcuts.".to_string())?;
    if let Some(user) = conflict(accelerator, &media_keys) {
        return Err(format!(
            "{label} is already {user}. Choose another shortcut, or free {label} in GNOME Settings, under Keyboard."
        ));
    }
    let voco = settings(CUSTOM, Some(VOCO_PATH))
        .ok_or_else(|| "VOCO can't reach GNOME's keyboard shortcuts.".to_string())?;
    let written = voco
        .set_string("name", NAME)
        .and_then(|()| voco.set_string("command", &command()))
        .and_then(|()| voco.set_string("binding", accelerator));
    let mut paths = custom_paths(&media_keys);
    let listed = if paths.iter().any(|path| path == VOCO_PATH) {
        Ok(())
    } else {
        paths.push(VOCO_PATH.to_owned());
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        media_keys.set_strv(LIST, refs.as_slice())
    };
    gio::Settings::sync();
    written
        .and(listed)
        .map_err(|error| format!("GNOME didn't save VOCO's shortcut: {error}"))
}

/// For Reset: removes VOCO's custom shortcut and only it.
pub fn remove() {
    let Some(media_keys) = settings(MEDIA_KEYS, None) else {
        return;
    };
    let paths: Vec<String> = custom_paths(&media_keys)
        .into_iter()
        .filter(|path| path != VOCO_PATH)
        .collect();
    let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
    let _ = media_keys.set_strv(LIST, refs.as_slice());
    if let Some(voco) = settings(CUSTOM, Some(VOCO_PATH)) {
        for key in ["name", "command", "binding"] {
            voco.reset(key);
        }
    }
    gio::Settings::sync();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shortcut_calls_voco_and_falls_back_to_launching_it() {
        let command = command();
        // GNOME parses the command as a desktop entry's Exec: a percent sign
        // would be a field code, and the shell part must stay one argument.
        assert!(!command.contains('%'), "{command}");
        assert!(
            command.starts_with("sh -c '") && command.ends_with('\''),
            "{command}"
        );
        assert_eq!(command.matches('\'').count(), 2, "{command}");
        assert!(command.contains(
            "--dest=com.sergiopesch.voco.Panel /com/sergiopesch/voco/Panel com.sergiopesch.voco.Panel1.Toggle"
        ), "{command}");
        // Waits for VOCO's answer, so a failed call runs the launch instead.
        assert!(
            command.contains("--print-reply")
                && command.contains(&format!("|| {}", launch_command())),
            "{command}"
        );
        assert!(launch_command().ends_with(" --toggle"));
    }

    #[test]
    fn chords_compare_without_case_or_modifier_order() {
        assert!(same_chord("<Super>x", "<super>X"));
        assert!(same_chord("<Control><Alt>t", "<Alt><Primary>T"));
        assert!(!same_chord("<Super>x", "<Super><Shift>x"));
        assert!(!same_chord("<Super>x", "<Alt>x"));
        assert!(
            !same_chord("", "<Super>x"),
            "an empty binding uses no chord"
        );
    }
}
