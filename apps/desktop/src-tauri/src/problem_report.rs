//! Help's Report a problem (docs/issue-process.md): VOCO's bug form on
//! GitHub, opened in the person's browser with what VOCO knows about this
//! installation filled in. VOCO sends nothing: the person reads the form,
//! finishes it and decides whether to submit it. Only the version, the kind
//! of package, the desktop's name and the session type go into the address,
//! never a name, a path, dictated words or a setting.

use std::path::Path;

const BUG_FORM: &str = "https://github.com/sergiopesch/voco/issues/new?template=bug.yml";

/// How VOCO was installed, in the words of the form's own dropdown (`options`
/// in `.github/ISSUE_TEMPLATE/bug.yml`; a test keeps the two together).
/// GitHub documents the prefill for a form's text fields only, so the text
/// field names the package too, in case the dropdown stays empty.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Install {
    Snap,
    Deb,
    Rpm,
    Source,
}

impl Install {
    #[cfg_attr(not(test), allow(dead_code))]
    const ALL: [Self; 4] = [Self::Snap, Self::Deb, Self::Rpm, Self::Source];

    fn option(self) -> &'static str {
        match self {
            Self::Snap => "Snap Store or App Center",
            Self::Deb => "The .deb (guided installer or manual)",
            Self::Rpm => "The RPM",
            Self::Source => "Built from source",
        }
    }

    fn short(self) -> &'static str {
        match self {
            Self::Snap => "snap",
            Self::Deb => ".deb",
            Self::Rpm => "RPM",
            Self::Source => "built from source",
        }
    }

    /// The snap, the installed package of this system's kind, or anything
    /// else, which is a build from source.
    fn of(
        snap: bool,
        executable: Option<&Path>,
        kind: Option<crate::update_verify::PackageKind>,
    ) -> Self {
        use crate::update_verify::PackageKind;
        if snap {
            return Self::Snap;
        }
        if executable != Some(Path::new(crate::update_install::INSTALLED_APP)) {
            return Self::Source;
        }
        match kind {
            Some(PackageKind::Deb) => Self::Deb,
            Some(PackageKind::Rpm) => Self::Rpm,
            None => Self::Source,
        }
    }
}

/// Percent-encodes everything but RFC 3986's unreserved characters.
fn encode(text: &str) -> String {
    let mut encoded = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// A desktop's name as XDG_CURRENT_DESKTOP gives it, such as "ubuntu:GNOME":
/// short, and only the characters such names use, whatever the variable held.
fn desktop_name(raw: &str) -> String {
    let name: String = raw
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, ':' | '-' | '_' | '.'))
        .take(40)
        .collect();
    if name.is_empty() {
        "an unknown desktop".to_owned()
    } else {
        name
    }
}

/// The form's address with its two fields filled in.
pub(crate) fn url(version: &str, install: Install, desktop: &str, session: &str) -> String {
    let environment = format!(
        "VOCO {version} ({}), {} on {session}. Add your distribution and the app you dictated into.",
        install.short(),
        desktop_name(desktop)
    );
    format!(
        "{BUG_FORM}&install={}&environment={}",
        encode(install.option()),
        encode(&environment)
    )
}

/// The address for this running VOCO.
pub(crate) fn url_for_this_installation(desktop: &str, session: &str) -> String {
    let executable = std::env::current_exe().ok();
    let install = Install::of(
        crate::confinement::is_snap(),
        executable.as_deref(),
        crate::update_install::package_kind(),
    );
    url(env!("CARGO_PKG_VERSION"), install, desktop, session)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update_verify::PackageKind;

    #[test]
    fn the_address_is_the_bug_form_with_two_encoded_fields() {
        let address = url("2026.0.72", Install::Snap, "ubuntu:GNOME", "Wayland");
        assert_eq!(
            address,
            "https://github.com/sergiopesch/voco/issues/new?template=bug.yml\
             &install=Snap%20Store%20or%20App%20Center\
             &environment=VOCO%202026.0.72%20%28snap%29%2C%20ubuntu%3AGNOME%20on%20Wayland.%20Add%20your%20distribution%20and%20the%20app%20you%20dictated%20into."
        );
        // Whatever the desktop variable holds, the address stays the form's
        // own, with nothing a browser or GitHub would read as more fields.
        let odd = url(
            "2026.0.72",
            Install::Deb,
            "GNOME&title=x#frag /home/sam\n",
            "X11",
        );
        let fields = odd.strip_prefix(BUG_FORM).expect("the form");
        assert_eq!(fields.matches('&').count(), 2, "{odd}");
        assert!(
            fields
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"&=%-._~".contains(&byte)),
            "{odd}"
        );
        assert!(odd.contains("GNOMEtitlexfraghomesam"), "{odd}");
        assert!(url("1", Install::Rpm, "", "X11").contains("an%20unknown%20desktop"));
    }

    #[test]
    fn the_install_names_are_the_forms_own_options() {
        let form = include_str!("../../../../.github/ISSUE_TEMPLATE/bug.yml");
        for install in Install::ALL {
            assert!(
                form.contains(&format!("        - {}\n", install.option())),
                "bug.yml has no option {:?}, so GitHub would leave the field empty",
                install.option()
            );
        }
        assert!(form.contains("    id: install\n") && form.contains("    id: environment\n"));
    }

    #[test]
    fn the_package_is_told_from_the_snap_and_from_a_build() {
        let installed = Some(Path::new("/usr/bin/voco"));
        let built = Some(Path::new("/home/sam/voco/target/release/voco"));
        assert_eq!(
            Install::of(true, installed, Some(PackageKind::Deb)),
            Install::Snap
        );
        assert_eq!(
            Install::of(false, installed, Some(PackageKind::Deb)),
            Install::Deb
        );
        assert_eq!(
            Install::of(false, installed, Some(PackageKind::Rpm)),
            Install::Rpm
        );
        assert_eq!(
            Install::of(false, built, Some(PackageKind::Deb)),
            Install::Source
        );
        assert_eq!(Install::of(false, installed, None), Install::Source);
        assert_eq!(
            Install::of(false, None, Some(PackageKind::Rpm)),
            Install::Source
        );
    }
}
