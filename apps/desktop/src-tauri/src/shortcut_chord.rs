//! A VOCO shortcut in the spelling GNOME's keyboard shortcuts take
//! (AGENTS.md, Shortcut): a GTK accelerator ("<Control><Alt>d"), and back
//! from one to VOCO's own "Ctrl+Alt+D". Both name the key by its X keysym.

use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

/// VOCO's name for a key, as Settings records it, and the key's X keysym.
/// Letters, digits and F1 to F24 follow a rule instead (`keysym`).
const NAMED_KEYS: [(Code, &str, &str); 30] = [
    (Code::Space, "Space", "space"),
    (Code::Enter, "Enter", "Return"),
    (Code::Tab, "Tab", "Tab"),
    (Code::Backspace, "Backspace", "BackSpace"),
    (Code::Insert, "Insert", "Insert"),
    (Code::Delete, "Delete", "Delete"),
    (Code::Home, "Home", "Home"),
    (Code::End, "End", "End"),
    (Code::PageUp, "PageUp", "Page_Up"),
    (Code::PageDown, "PageDown", "Page_Down"),
    (Code::ArrowUp, "ArrowUp", "Up"),
    (Code::ArrowDown, "ArrowDown", "Down"),
    (Code::ArrowLeft, "ArrowLeft", "Left"),
    (Code::ArrowRight, "ArrowRight", "Right"),
    (Code::Comma, "Comma", "comma"),
    (Code::Period, "Period", "period"),
    (Code::Slash, "Slash", "slash"),
    (Code::Semicolon, "Semicolon", "semicolon"),
    (Code::Quote, "Quote", "apostrophe"),
    (Code::BracketLeft, "BracketLeft", "bracketleft"),
    (Code::BracketRight, "BracketRight", "bracketright"),
    (Code::Backslash, "Backslash", "backslash"),
    (Code::Minus, "Minus", "minus"),
    (Code::Equal, "Equal", "equal"),
    (Code::Backquote, "Backquote", "grave"),
    (Code::Pause, "Pause", "Pause"),
    (Code::ScrollLock, "ScrollLock", "Scroll_Lock"),
    (Code::PrintScreen, "PrintScreen", "Print"),
    (Code::CapsLock, "CapsLock", "Caps_Lock"),
    (Code::NumLock, "NumLock", "Num_Lock"),
];

/// The key's X keysym name: "d" for KeyD, "1" for Digit1, "F8", "space".
/// None for a key GNOME's shortcuts can't name from here.
fn keysym(code: Code) -> Option<String> {
    let name = format!("{code:?}");
    if let Some(letter) = name.strip_prefix("Key").filter(|rest| rest.len() == 1) {
        return Some(letter.to_ascii_lowercase());
    }
    if let Some(digit) = name.strip_prefix("Digit").filter(|rest| rest.len() == 1) {
        return Some(digit.to_owned());
    }
    if is_function_key(&name) {
        return Some(name);
    }
    NAMED_KEYS
        .iter()
        .find(|(known, _, _)| *known == code)
        .map(|(_, _, keysym)| (*keysym).to_owned())
}

fn is_function_key(name: &str) -> bool {
    name.strip_prefix('F')
        .and_then(|number| number.parse::<u8>().ok())
        .is_some_and(|number| (1..=24).contains(&number))
}

/// A shortcut GNOME can hold: its modifiers and its key's keysym.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Chord {
    control: bool,
    alt: bool,
    shift: bool,
    logo: bool,
    keysym: String,
}

impl Chord {
    /// None for a shortcut VOCO's parser refuses, or whose key has no keysym
    /// here.
    pub(crate) fn of(hotkey: &str) -> Option<Self> {
        let shortcut = hotkey.parse::<Shortcut>().ok()?;
        Some(Self {
            control: shortcut.mods.contains(Modifiers::CONTROL),
            alt: shortcut.mods.contains(Modifiers::ALT),
            shift: shortcut.mods.contains(Modifiers::SHIFT),
            logo: shortcut.mods.intersects(Modifiers::SUPER | Modifiers::META),
            keysym: keysym(shortcut.key)?,
        })
    }

    /// GTK's spelling, for a GNOME custom shortcut: "<Control><Alt>d".
    pub(crate) fn gtk_accelerator(&self) -> String {
        let mut accelerator = String::new();
        for (held, name) in [
            (self.control, "<Control>"),
            (self.alt, "<Alt>"),
            (self.shift, "<Shift>"),
            (self.logo, "<Super>"),
        ] {
            if held {
                accelerator.push_str(name);
            }
        }
        accelerator.push_str(&self.keysym);
        accelerator
    }
}

/// VOCO's name for the key GNOME names by `keysym`: "D", "F8", "Space".
fn key_label(keysym: &str) -> Option<String> {
    let mut letters = keysym.chars();
    if let (Some(only), None) = (letters.next(), letters.next()) {
        return only
            .is_ascii_alphanumeric()
            .then(|| only.to_ascii_uppercase().to_string());
    }
    if is_function_key(keysym) {
        return Some(keysym.to_owned());
    }
    NAMED_KEYS
        .iter()
        .find(|(_, _, known)| known.eq_ignore_ascii_case(keysym))
        .map(|(_, label, _)| (*label).to_owned())
}

/// "Ctrl+Alt+D" from the keys GNOME holds, such as "<Control><Alt>d":
/// VOCO's own spelling, for its config and labels. None for keys VOCO can't
/// take: no modifier, or a key it has no name for.
pub(crate) fn hotkey_from_accelerator(accelerator: &str) -> Option<String> {
    let (mut control, mut alt, mut shift, mut logo) = (false, false, false, false);
    let mut rest = accelerator.trim();
    while let Some(start) = rest.strip_prefix('<') {
        let end = start.find('>')?;
        match start[..end].to_ascii_lowercase().as_str() {
            "control" | "primary" | "ctrl" => control = true,
            "alt" => alt = true,
            "shift" => shift = true,
            "super" => logo = true,
            _ => return None,
        }
        rest = &start[end + 1..];
    }
    // A global shortcut always holds a modifier; a bare key isn't one VOCO takes.
    if !(control || alt || logo) {
        return None;
    }
    let key = key_label(rest.trim())?;
    // VOCO's own order, as Settings records a chord.
    let mut parts = Vec::new();
    for (held, name) in [
        (control, "Ctrl"),
        (alt, "Alt"),
        (shift, "Shift"),
        (logo, "Super"),
    ] {
        if held {
            parts.push(name.to_owned());
        }
    }
    parts.push(key);
    Some(parts.join("+"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_shortcut_is_spelled_for_gtk() {
        for (hotkey, accelerator) in [
            ("Super+X", "<Super>x"),
            ("Alt+D", "<Alt>d"),
            ("Alt+Shift+D", "<Alt><Shift>d"),
            ("Ctrl+Alt+D", "<Control><Alt>d"),
            ("Ctrl+Shift+F8", "<Control><Shift>F8"),
            ("Super+Space", "<Super>space"),
            ("Ctrl+ArrowUp", "<Control>Up"),
            ("Ctrl+Alt+1", "<Control><Alt>1"),
            ("Ctrl+Comma", "<Control>comma"),
            ("Ctrl+Alt+Shift+Super+K", "<Control><Alt><Shift><Super>k"),
        ] {
            let chord = Chord::of(hotkey).unwrap_or_else(|| panic!("{hotkey}"));
            assert_eq!(chord.gtk_accelerator(), accelerator, "{hotkey}");
        }
        assert_eq!(Chord::of("not a shortcut"), None);
    }

    #[test]
    fn gnomes_keys_read_back_as_vocos_shortcut() {
        for (accelerator, hotkey) in [
            ("<Super>x", "Super+X"),
            ("<Alt><Shift>d", "Alt+Shift+D"),
            ("<Shift><Control>F8", "Ctrl+Shift+F8"),
            ("<Control><Alt>d", "Ctrl+Alt+D"),
            ("<Primary>space", "Ctrl+Space"),
            (" <Super>Up ", "Super+ArrowUp"),
            ("<Control>1", "Ctrl+1"),
            ("<Control>apostrophe", "Ctrl+Quote"),
        ] {
            assert_eq!(
                hotkey_from_accelerator(accelerator).as_deref(),
                Some(hotkey),
                "{accelerator}"
            );
        }
        // No modifier, an unknown modifier, or a key VOCO has no name for.
        for accelerator in ["x", "<Shift>x", "<Hyper>x", "<Super>XF86AudioPlay", ""] {
            assert_eq!(hotkey_from_accelerator(accelerator), None, "{accelerator}");
        }
    }

    #[test]
    fn every_spelling_round_trips_through_vocos_parser() {
        // The keys GNOME holds for a shortcut VOCO gave it must be ones VOCO
        // can save, and must name the same chord.
        let mut hotkeys = vec![
            "Super+X".to_owned(),
            "Ctrl+Alt+D".to_owned(),
            "Ctrl+Shift+F12".to_owned(),
            "Alt+0".to_owned(),
        ];
        hotkeys.extend(
            NAMED_KEYS
                .iter()
                .map(|(_, label, _)| format!("Ctrl+{label}")),
        );
        for hotkey in hotkeys {
            let chord = Chord::of(&hotkey).unwrap_or_else(|| panic!("{hotkey}"));
            let accelerator = chord.gtk_accelerator();
            let back =
                hotkey_from_accelerator(&accelerator).unwrap_or_else(|| panic!("{accelerator}"));
            assert_eq!(
                Chord::of(&back),
                Some(chord),
                "{hotkey} came back as {back}"
            );
        }
    }
}
