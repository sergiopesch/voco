//! Whether this processor can run the speech runtime, which is built for AVX2,
//! FMA and F16C with no fallback (`runtime/native/build.py`).
use std::sync::LazyLock;

/// The instruction sets the speech runtime needs, as `/proc/cpuinfo` names them.
const SPEECH_FEATURES: [&str; 3] = ["avx2", "fma", "f16c"];

/// Read once: the processor doesn't change while VOCO runs.
static PROBLEM: LazyLock<Option<String>> = LazyLock::new(|| {
    let problem = std::fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|cpuinfo| problem_for(&cpuinfo));
    if let Some(problem) = &problem {
        log::warn!("{problem}");
    }
    problem
});

/// Why speech recognition can't run on this processor, or None when it can.
pub(crate) fn speech_problem() -> Option<&'static str> {
    PROBLEM.as_deref()
}

/// The renderer refuses a start with this reason before opening a microphone.
#[tauri::command]
pub fn speech_processor_problem() -> Option<&'static str> {
    speech_problem()
}

/// The guided installer's wording, so both name the same fix.
fn problem_for(cpuinfo: &str) -> Option<String> {
    let missing = missing_features(cpuinfo);
    (!missing.is_empty()).then(|| {
        format!(
            "VOCO's speech recognition needs a processor with AVX2, FMA and F16C; this one lacks {}. In a virtual machine, pass the host CPU through.",
            missing.join(", ")
        )
    })
}

/// The required features the first `flags` line lacks, in upper case. Like the
/// installer, a file without that line (another architecture's format, or none
/// at all) lacks nothing, so only a list that was read and falls short refuses.
fn missing_features(cpuinfo: &str) -> Vec<String> {
    let Some(flags) = cpuinfo.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        (key.trim() == "flags").then_some(value)
    }) else {
        return Vec::new();
    };
    let present: Vec<&str> = flags.split_whitespace().collect();
    SPEECH_FEATURES
        .iter()
        .filter(|feature| !present.contains(feature))
        .map(|feature| feature.to_ascii_uppercase())
        .collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) const LACKS_F16C: &str = "VOCO's speech recognition needs a processor with AVX2, FMA and F16C; this one lacks F16C. In a virtual machine, pass the host CPU through.";

    const CAPABLE: &str = "processor\t: 0\nvendor_id\t: GenuineIntel\nflags\t\t: fpu vme sse sse2 fma avx f16c avx2 bmi2\nbugs\t\t: spectre_v1\n\nprocessor\t: 1\nflags\t\t: fpu\n";

    #[test]
    fn a_processor_with_every_feature_lacks_nothing() {
        // The second processor's short list never counts.
        assert!(missing_features(CAPABLE).is_empty());
        assert_eq!(problem_for(CAPABLE), None);
    }

    #[test]
    fn only_the_first_flags_line_counts() {
        let later =
            "processor\t: 0\nflags\t\t: fpu sse2\n\nprocessor\t: 1\nflags\t\t: avx2 fma f16c\n";
        assert_eq!(missing_features(later), ["AVX2", "FMA", "F16C"]);
    }

    #[test]
    fn missing_features_are_named_in_order() {
        let cpuinfo = "flags\t\t: fpu sse4_2 avx fma\n";
        assert_eq!(missing_features(cpuinfo), ["AVX2", "F16C"]);
        assert_eq!(
            problem_for(cpuinfo).as_deref(),
            Some("VOCO's speech recognition needs a processor with AVX2, FMA and F16C; this one lacks AVX2, F16C. In a virtual machine, pass the host CPU through.")
        );
        assert_eq!(
            problem_for("flags\t\t: avx2 fma\n").as_deref(),
            Some(LACKS_F16C)
        );
    }

    #[test]
    fn whole_flags_match_never_a_prefix_or_another_key() {
        // avx2 must not be found inside avx512f, nor fma inside fma4, nor in a
        // key that merely starts with flags.
        let cpuinfo = "vmx flags\t: avx2 fma f16c\nflags\t\t: avx512f fma4 f16c\n";
        assert_eq!(missing_features(cpuinfo), ["AVX2", "FMA"]);
    }

    #[test]
    fn the_message_is_the_guided_installers() {
        let message = problem_for("flags\t\t: fpu\n").unwrap();
        let installer = include_str!("../../../../install");
        assert!(installer.contains(&message.replace("AVX2, FMA, F16C.", "${missing}.")));
    }

    #[test]
    fn a_file_without_flags_assumes_a_capable_processor() {
        assert!(missing_features("").is_empty());
        // An ARM kernel lists Features, never flags.
        assert!(missing_features("processor\t: 0\nFeatures\t: fp asimd\n").is_empty());
        assert_eq!(problem_for("garbage without separators"), None);
    }
}
