//! Chromium Native Messaging executable. stdout contains framed protocol data only.
#[cfg(test)]
#[path = "../browser_broker.rs"]
#[allow(dead_code)]
mod browser_broker;
#[path = "../browser_protocol.rs"]
#[allow(dead_code)]
mod browser_protocol;
#[path = "../browser_socket.rs"]
mod browser_socket;
use browser_protocol::{allowed_origin, read_frame, write_frame};
use std::io;
use std::net::Shutdown;
use std::os::unix::net::UnixStream;

fn run() -> Result<(), String> {
    let origin = std::env::args().nth(1).ok_or("Missing browser origin.")?;
    if !allowed_origin(&origin) {
        return Err("Browser origin is not allowed.".into());
    }
    let path = browser_socket::socket_path(false)?;
    browser_socket::validate_socket(&path)?;
    let mut stream =
        UnixStream::connect(path).map_err(|_| "VOCO browser integration is not available.")?;
    browser_socket::validate_peer(&stream)?;
    let mut incoming = stream
        .try_clone()
        .map_err(|_| "Cannot clone browser transport.")?;
    let output = std::thread::spawn(move || {
        let mut stdout = io::stdout().lock();
        while let Ok(frame) = read_frame(&mut incoming) {
            if write_frame(&mut stdout, &frame).is_err() {
                break;
            }
        }
        let _ = incoming.shutdown(Shutdown::Both);
        // A browser stdin can remain open after broker loss; end the native host
        // so Chromium observes disconnection and invalidates every target token.
        std::process::exit(0);
    });
    let mut stdin = io::stdin().lock();
    while let Ok(frame) = read_frame(&mut stdin) {
        if write_frame(&mut stream, &frame).is_err() {
            break;
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
    let _ = output.join();
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
