//! Bounded supervision for optional local helpers. Spawn errors remain visible to callers,
//! since they are different from errors after a helper may have performed an action.

use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Output, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

const IO_BATCH_BYTES: usize = 16 * 1024;

pub(crate) fn command(program: &str) -> Command {
    let mut command = Command::new(program);
    command
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

// Desktop launchers may exec their application and legitimately stay alive for
// its entire lifetime. Reap them without deadline/group termination, pipe
// ownership, or one blocked thread per opened window.
static DETACHED_CHILDREN: LazyLock<Result<Arc<Mutex<Vec<Child>>>, String>> = LazyLock::new(|| {
    let children = Arc::new(Mutex::new(Vec::<Child>::new()));
    let pending = Arc::clone(&children);
    std::thread::Builder::new()
        .name("voco-desktop-reaper".to_string())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(100));
            let mut children = pending
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            children.retain_mut(|child| match child.try_wait() {
                Ok(None) => true,
                Ok(Some(_)) => false,
                Err(error) => {
                    log::warn!("Could not reap desktop launcher {}: {error}", child.id());
                    false
                }
            });
        })
        .map_err(|error| format!("Failed to start desktop process reaper: {error}"))?;
    Ok(children)
});

/// Success means the launcher was spawned, not that a desktop window appeared.
/// Output is discarded; it must not hold pipes or delay the app command.
pub(crate) fn spawn_desktop_launcher(command: &mut Command) -> Result<u32, String> {
    let children = DETACHED_CHILDREN.as_ref().map_err(Clone::clone)?;
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to launch desktop application: {error}"))?;
    let pid = child.id();
    children
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .push(child);
    Ok(pid)
}

fn nonblocking(pipe: &impl AsRawFd) -> std::io::Result<()> {
    let fd = pipe.as_raw_fd();
    // SAFETY: fcntl operates on a live, borrowed pipe descriptor. Existing flags are preserved.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags == -1 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

struct SupervisedChild {
    child: Child,
    process_group: Option<libc::pid_t>,
    completed: bool,
}

impl Drop for SupervisedChild {
    fn drop(&mut self) {
        if !self.completed {
            // Only kill the group when this child actually leads it; callers must not be
            // able to terminate VOCO's own process group by passing an ordinary child.
            if let Some(group) = self.process_group {
                // SAFETY: this group was verified before reaping the child. Keeping its ID
                // also lets us terminate descendants holding pipes after the leader exits.
                unsafe { libc::kill(-group, libc::SIGKILL) };
            }
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn drain<T: Read>(
    pipe: &mut Option<T>,
    output: &mut Vec<u8>,
    max_bytes: usize,
    stream: &str,
) -> Result<bool, String> {
    let Some(reader) = pipe else {
        return Ok(false);
    };
    let mut batch = [0_u8; IO_BATCH_BYTES];
    match reader.read(&mut batch) {
        Ok(0) => {
            *pipe = None;
            Ok(true)
        }
        Ok(count) => {
            if count > max_bytes.saturating_sub(output.len()) {
                return Err(format!(
                    "Helper {stream} exceeded the {max_bytes}-byte limit"
                ));
            }
            output.extend_from_slice(&batch[..count]);
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => Ok(true),
        Err(error) => Err(format!("Failed to read helper {stream}: {error}")),
    }
}

pub(crate) fn wait_with_output(
    child: Child,
    timeout: Duration,
    max_bytes_per_stream: usize,
) -> Result<Output, String> {
    wait_with_input_output(child, &[], timeout, max_bytes_per_stream)
}

pub(crate) fn wait_with_input_output(
    child: Child,
    input: &[u8],
    timeout: Duration,
    max_bytes_per_stream: usize,
) -> Result<Output, String> {
    let started = Instant::now();
    let pid = child.id() as libc::pid_t;
    // SAFETY: getpgid receives the unreaped child PID and does not dereference pointers.
    let process_group = (unsafe { libc::getpgid(pid) } == pid).then_some(pid);
    let mut supervised = SupervisedChild {
        child,
        process_group,
        completed: false,
    };
    let mut stdout_pipe = supervised.child.stdout.take();
    let mut stderr_pipe = supervised.child.stderr.take();
    let mut stdin_pipe = supervised.child.stdin.take();
    if input.is_empty() {
        stdin_pipe = None;
    } else if stdin_pipe.is_none() {
        return Err("Helper stdin was not piped".to_string());
    }
    if let Some(pipe) = &stdout_pipe {
        nonblocking(pipe).map_err(|error| format!("Failed to configure helper stdout: {error}"))?;
    }
    if let Some(pipe) = &stderr_pipe {
        nonblocking(pipe).map_err(|error| format!("Failed to configure helper stderr: {error}"))?;
    }
    if let Some(pipe) = &stdin_pipe {
        nonblocking(pipe).map_err(|error| format!("Failed to configure helper stdin: {error}"))?;
    }

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut written: usize = 0;
    let mut status = None;
    loop {
        if started.elapsed() >= timeout {
            return Err(format!(
                "Helper did not complete within {} ms",
                timeout.as_millis()
            ));
        }
        let mut progressed = drain(
            &mut stdout_pipe,
            &mut stdout,
            max_bytes_per_stream,
            "stdout",
        )?;
        progressed |= drain(
            &mut stderr_pipe,
            &mut stderr,
            max_bytes_per_stream,
            "stderr",
        )?;
        if let Some(pipe) = &mut stdin_pipe {
            let end = input.len().min(written.saturating_add(IO_BATCH_BYTES));
            match pipe.write(&input[written..end]) {
                Ok(0) => return Err("Helper closed stdin before receiving all input".to_string()),
                Ok(count) => {
                    written += count;
                    progressed = true;
                    if written == input.len() {
                        stdin_pipe = None;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => return Err(format!("Failed to write helper stdin: {error}")),
            }
        }
        if status.is_none() {
            status = supervised
                .child
                .try_wait()
                .map_err(|error| format!("Failed while waiting for helper: {error}"))?;
        }
        if let Some(status) = status {
            if stdout_pipe.is_none() && stderr_pipe.is_none() && stdin_pipe.is_none() {
                // A failed helper may have left children that can still mutate state.
                // Successful clipboard owners are allowed to keep their descendants.
                supervised.completed = status.success();
                return Ok(Output {
                    status,
                    stdout,
                    stderr,
                });
            }
        }
        if !progressed {
            std::thread::sleep(
                Duration::from_millis(5).min(timeout.saturating_sub(started.elapsed())),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell(script: &str) -> Child {
        command("/bin/sh").args(["-c", script]).spawn().unwrap()
    }

    #[test]
    fn desktop_launcher_returns_without_waiting_and_reaps_noisy_child() {
        let started = Instant::now();
        let pid = spawn_desktop_launcher(command("/bin/sh").args([
            "-c",
            "head -c 1048576 /dev/zero; head -c 1048576 /dev/zero >&2; sleep 0.5",
        ]))
        .unwrap();
        assert!(started.elapsed() < Duration::from_millis(400));
        let proc_path = std::path::PathBuf::from(format!("/proc/{pid}"));
        let deadline = Instant::now() + Duration::from_secs(5);
        while proc_path.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!proc_path.exists(), "desktop launcher was not reaped");
        // SAFETY: waitpid only observes our own child; the background reaper
        // must already have collected it rather than leaving a zombie.
        let result =
            unsafe { libc::waitpid(pid as libc::pid_t, std::ptr::null_mut(), libc::WNOHANG) };
        assert_eq!(result, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ECHILD)
        );
    }

    #[test]
    fn desktop_launcher_does_not_kill_application_descendants_when_launcher_exits() {
        let marker =
            std::env::temp_dir().join(format!("voco-desktop-owner-{}", std::process::id()));
        let _ = std::fs::remove_file(&marker);
        spawn_desktop_launcher(
            command("/bin/sh")
                .args([
                    "-c",
                    "(sleep 0.3; : > \"$1\"; sleep 0.1; printf survived > \"$1\") & exit 0",
                    "voco-test",
                ])
                .arg(&marker),
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        // Opening the marker precedes writing it; wait for the completion payload.
        while !std::fs::read_to_string(&marker).is_ok_and(|contents| contents == "survived")
            && Instant::now() < deadline
        {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(std::fs::read_to_string(&marker).unwrap(), "survived");
        std::fs::remove_file(marker).unwrap();
    }

    #[test]
    fn drains_large_stdout_and_stderr_without_pipe_backpressure() {
        let output = wait_with_output(
            shell("head -c 1048576 /dev/zero; head -c 1048576 /dev/zero >&2"),
            Duration::from_secs(5),
            2 * 1024 * 1024,
        )
        .unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout.len(), 1024 * 1024);
        assert_eq!(output.stderr.len(), 1024 * 1024);
    }

    #[test]
    fn interleaves_stdin_with_output_larger_than_pipe_capacity() {
        let child = command("/bin/cat").stdin(Stdio::piped()).spawn().unwrap();
        let input = vec![b'x'; 1024 * 1024];
        let output =
            wait_with_input_output(child, &input, Duration::from_secs(5), input.len()).unwrap();
        assert_eq!(output.stdout, input);
    }

    #[test]
    fn rejects_overflow_instead_of_returning_truncated_success() {
        let error = wait_with_output(
            shell("head -c 1048576 /dev/zero"),
            Duration::from_secs(5),
            1024,
        )
        .unwrap_err();
        assert!(error.contains("exceeded"));
    }

    #[test]
    fn deadline_covers_blocked_stdin_and_inherited_output_pipes() {
        let started = Instant::now();
        let child = command("/bin/sh")
            .args(["-c", "sleep 30"])
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        assert!(wait_with_input_output(
            child,
            &vec![b'x'; 1024 * 1024],
            Duration::from_millis(100),
            1024
        )
        .unwrap_err()
        .contains("within"));
        assert!(started.elapsed() < Duration::from_secs(2));

        let started = Instant::now();
        assert!(
            wait_with_output(shell("sleep 30 & exit 0"), Duration::from_millis(100), 1024).is_err()
        );
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn returns_nonzero_exit_and_supports_null_output_pipes() {
        let output = wait_with_output(
            shell("printf diagnostic >&2; exit 7"),
            Duration::from_secs(1),
            1024,
        )
        .unwrap();
        assert_eq!(output.status.code(), Some(7));
        assert_eq!(output.stderr, b"diagnostic");
        let child = command("/bin/true")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        assert!(wait_with_output(child, Duration::from_secs(1), 0)
            .unwrap()
            .status
            .success());
    }
}
