fn main() {
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    match arguments.as_slice() {
        [] => {}
        [arg] if arg == "--toggle" => {
            if let Err(error) = voco_lib::toggle_running_application() {
                eprintln!("{error}");
                std::process::exit(1);
            }
            return;
        }
        [arg] if arg == "--check-desktop-input" => {
            match voco_lib::check_desktop_input() {
                Ok(detail) => println!("{detail}"),
                Err(detail) => {
                    eprintln!("{detail}");
                    std::process::exit(1);
                }
            }
            return;
        }
        [arg] if arg == "--version" => {
            println!("VOCO {}", env!("CARGO_PKG_VERSION"));
            return;
        }
        [arg] if arg == "--help" || arg == "-h" => {
            println!("Usage: voco [--toggle | --check-desktop-input | --version | --help]\n\nWithout arguments, launch VOCO.\n--toggle  Request Start/Stop from VOCO already running in this desktop session.\n          Does not change focus, launch VOCO, or confirm recording state.\n--check-desktop-input  Check input helpers without launching VOCO or sending keys.");
            return;
        }
        _ => {
            eprintln!("Unknown arguments. Run voco --help for usage.");
            std::process::exit(2);
        }
    }
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
