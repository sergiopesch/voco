fn main() {
    if let Err(error) = voco_lib::run() {
        eprintln!("VOCO could not start: {error}");
        #[cfg(target_os = "linux")]
        {
            let summary = if error.contains("another VOCO instance is already running") {
                "VOCO is already running"
            } else {
                "VOCO could not start"
            };
            let _ = std::process::Command::new("notify-send")
                .arg("--app-name=VOCO")
                .arg("--icon=audio-input-microphone")
                .arg("--")
                .arg(summary)
                .arg(&error)
                .spawn();
        }
        std::process::exit(1);
    }
}
