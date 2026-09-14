fn main() {
    println!("cargo:rerun-if-changed=native/native_capture_pulse.c");
    println!("cargo:rerun-if-changed=native/native_capture_pulse.h");
    if std::env::var_os("CARGO_FEATURE_NATIVE_CAPTURE_DEV").is_some()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux")
    {
        let pulse = pkg_config::Config::new()
            .atleast_version("13.0")
            .probe("libpulse")
            .expect("native-capture-dev requires the libpulse development headers and library");
        let mut build = cc::Build::new();
        build
            .file("native/native_capture_pulse.c")
            .include("native")
            .std("c11")
            .warnings(true)
            .extra_warnings(true);
        for path in pulse.include_paths {
            build.include(path);
        }
        build.compile("voco_native_capture_pulse");
    }
    tauri_build::build();
}
