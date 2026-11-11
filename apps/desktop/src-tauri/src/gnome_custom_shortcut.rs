//! On GNOME 46, which has no GlobalShortcuts portal, the snap's shortcut is a
//! GNOME custom keyboard shortcut that runs `voco --toggle` (AGENTS.md,
//! Shortcut). Setup's button adds it, only when no GNOME window shortcut or
//! other custom shortcut uses the chord, and never changes another.
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

/// The command GNOME runs: this snap's `voco --toggle`.
fn command() -> String {
    let instance = std::env::var("SNAP_INSTANCE_NAME").unwrap_or_else(|_| "voco".into());
    format!("/snap/bin/{instance} --toggle")
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

/// VOCO's custom shortcut exists for `accelerator`.
pub fn present(accelerator: &str) -> bool {
    let Some(media_keys) = settings(MEDIA_KEYS, None) else {
        return false;
    };
    if !custom_paths(&media_keys)
        .iter()
        .any(|path| path == VOCO_PATH)
    {
        return false;
    }
    settings(CUSTOM, Some(VOCO_PATH)).is_some_and(|voco| {
        same_chord(&voco.string("binding"), accelerator) && voco.string("command") == command()
    })
}

/// Adds VOCO's custom shortcut for `accelerator` ("<Super>x"), or says what
/// already uses it.
pub fn add(accelerator: &str, label: &str) -> Result<(), String> {
    let media_keys = settings(MEDIA_KEYS, None)
        .ok_or_else(|| "VOCO can't reach GNOME's keyboard shortcuts.".to_string())?;
    if let Some(user) = conflict(accelerator, &media_keys) {
        return Err(format!(
            "{label} is already {user}. Choose another shortcut in VOCO's Settings, or free {label} in GNOME Settings, under Keyboard."
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
