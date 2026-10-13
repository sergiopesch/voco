//! Clipboard helpers that report what they serve. In the foreground, xclip
//! prints a line each time it has answered a request for its selection's
//! contents; TARGETS queries, which list formats, don't count. On GNOME this
//! tells VOCO when the focused app has read a paste.
//!
//! Each helper keeps its selection until another owner takes it, as a forked
//! xclip does, and outlives VOCO: it ignores SIGPIPE, so a request after VOCO
//! has gone still gets the text. A thread per helper writes its text, reads its
//! reports to the end and reaps it.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::process::CommandExt;
use std::process::{Child, Stdio};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::process_runner;

/// Answered requests remembered per helper. Later ones don't matter: a paste
/// waits for the first read after its keys.
const TRACKED_REQUESTS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Selection {
    Clipboard,
    Primary,
}

impl Selection {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Clipboard => "clipboard",
            Self::Primary => "primary",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum OwnerError {
    /// The helper never started, so the selection didn't change.
    Spawn(String),
    /// The helper started; it may have taken the selection.
    Failed(String),
}

impl std::fmt::Display for OwnerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Spawn(message) | Self::Failed(message) => formatter.write_str(message),
        }
    }
}

/// A read VOCO saw after a paste's Insert press, and how long after it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SelectionRead {
    pub selection: Selection,
    pub after: Duration,
}

#[derive(Default)]
struct Progress {
    owned: bool,
    /// The helper closed its reports, so it has exited or is about to.
    finished: bool,
    /// When VOCO saw each of the first answered requests.
    served: Vec<Instant>,
}

struct Helper {
    selection: Selection,
    pid: libc::pid_t,
}

struct Shared {
    progress: Mutex<Vec<Progress>>,
    changed: Condvar,
}

/// The helpers of one paste, CLIPBOARD first, then PRIMARY.
pub(crate) struct SelectionOwners {
    shared: Arc<Shared>,
    helpers: Vec<Helper>,
}

impl SelectionOwners {
    pub(crate) fn new() -> Self {
        Self {
            shared: Arc::new(Shared {
                progress: Mutex::new(Vec::new()),
                changed: Condvar::new(),
            }),
            helpers: Vec::new(),
        }
    }

    fn progress(&self) -> MutexGuard<'_, Vec<Progress>> {
        // The guarded data is plain bookkeeping a panicked reader can't corrupt.
        self.shared
            .progress
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Starts `program`, an xclip, owning `selection` with `text`, and returns
    /// once it owns the selection.
    pub(crate) fn own(
        &mut self,
        program: &str,
        selection: Selection,
        text: &[u8],
        timeout: Duration,
    ) -> Result<(), OwnerError> {
        let mut command = process_runner::command(program);
        command
            .args(["-verbose", "-selection", selection.as_str(), "-in"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        // SAFETY: between fork and exec the closure only sets a signal's
        // disposition, with a struct on its own stack.
        unsafe {
            command.pre_exec(|| {
                let mut ignore: libc::sigaction = std::mem::zeroed();
                ignore.sa_sigaction = libc::SIG_IGN;
                if libc::sigaction(libc::SIGPIPE, &raw const ignore, std::ptr::null_mut()) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut child = command.spawn().map_err(|error| {
            OwnerError::Spawn(format!("Could not start the input helper: {error}"))
        })?;
        let index = {
            let mut progress = self.progress();
            progress.push(Progress::default());
            progress.len() - 1
        };
        let pid = child.id() as libc::pid_t;
        self.helpers.push(Helper { selection, pid });
        let (input, reports) = (child.stdin.take(), child.stderr.take());
        let child = Arc::new(Mutex::new(Some(child)));
        let shared = Arc::clone(&self.shared);
        let owned_child = Arc::clone(&child);
        let text = text.to_vec();
        let started = std::thread::Builder::new()
            .name("voco-selection-owner".to_string())
            .spawn(move || serve(shared, index, input, reports, text, owned_child));
        if let Err(error) = started {
            if let Some(mut child) = child
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take()
            {
                let _ = child.kill();
                let _ = child.wait();
            }
            self.progress()[index].finished = true;
            return Err(OwnerError::Failed(format!(
                "Could not watch the input helper: {error}"
            )));
        }
        self.wait_owned(index, timeout)
    }

    fn wait_owned(&self, index: usize, timeout: Duration) -> Result<(), OwnerError> {
        let deadline = Instant::now() + timeout;
        let mut progress = self.progress();
        loop {
            if progress[index].owned {
                return Ok(());
            }
            if progress[index].finished {
                return Err(OwnerError::Failed(
                    "The input helper exited before it owned the selection.".into(),
                ));
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                // Unreaped until `finished` is set, which needs this lock, so
                // the group can't be another process's.
                // SAFETY: kill only signals the helper's own process group.
                unsafe { libc::kill(-self.helpers[index].pid, libc::SIGKILL) };
                return Err(OwnerError::Failed(format!(
                    "The input helper didn't own the selection within {} ms.",
                    timeout.as_millis()
                )));
            }
            progress = self
                .shared
                .changed
                .wait_timeout(progress, left)
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .0;
        }
    }

    /// Requests the CLIPBOARD helper had answered by `at`.
    pub(crate) fn clipboard_served_by(&self, at: Instant) -> usize {
        let progress = self.progress();
        self.helpers
            .iter()
            .zip(progress.iter())
            .filter(|(helper, _)| helper.selection == Selection::Clipboard)
            .map(|(_, progress)| progress.served.iter().filter(|&&t| t <= at).count())
            .sum()
    }

    /// Waits up to `timeout` until the CLIPBOARD helper has answered a request,
    /// and returns how long that took, or None if it didn't in time.
    pub(crate) fn wait_clipboard_served(&self, timeout: Duration) -> Option<Duration> {
        let started = Instant::now();
        let deadline = started + timeout;
        let mut progress = self.progress();
        loop {
            let served = self
                .helpers
                .iter()
                .zip(progress.iter())
                .any(|(helper, progress)| {
                    helper.selection == Selection::Clipboard && !progress.served.is_empty()
                });
            if served {
                return Some(started.elapsed());
            }
            let left = deadline.saturating_duration_since(Instant::now());
            let clipboard_gone =
                self.helpers
                    .iter()
                    .zip(progress.iter())
                    .all(|(helper, progress)| {
                        helper.selection != Selection::Clipboard || progress.finished
                    });
            if left.is_zero() || clipboard_gone {
                return None;
            }
            progress = self
                .shared
                .changed
                .wait_timeout(progress, left)
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .0;
        }
    }

    /// The first request either helper answered after `inserted`, the Insert
    /// press, waiting up to `timeout` from then.
    pub(crate) fn read_after(&self, inserted: Instant, timeout: Duration) -> Option<SelectionRead> {
        let deadline = inserted + timeout;
        let mut progress = self.progress();
        loop {
            let first = self
                .helpers
                .iter()
                .zip(progress.iter())
                .filter_map(|(helper, progress)| {
                    let served = progress.served.iter().find(|&&t| t > inserted)?;
                    Some((*served, helper.selection))
                })
                .min_by_key(|(served, _)| *served);
            if let Some((served, selection)) = first {
                return Some(SelectionRead {
                    selection,
                    after: served - inserted,
                });
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() || progress.iter().all(|progress| progress.finished) {
                return None;
            }
            progress = self
                .shared
                .changed
                .wait_timeout(progress, left)
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .0;
        }
    }
}

/// Writes the text, then reads the helper's reports until it exits, and reaps it.
fn serve(
    shared: Arc<Shared>,
    index: usize,
    input: Option<std::process::ChildStdin>,
    reports: Option<std::process::ChildStderr>,
    text: Vec<u8>,
    child: Arc<Mutex<Option<Child>>>,
) {
    // xclip reads all of its input before it takes the selection. A helper that
    // fails first closes its end; the error then shows as an early exit.
    if let Some(mut input) = input {
        let _ = input.write_all(&text);
    }
    if let Some(reports) = reports {
        for line in BufReader::new(reports).split(b'\n') {
            let Ok(line) = line else { break };
            // "  Waiting for selection request number N" follows answer N-1.
            let Some(number) = std::str::from_utf8(&line)
                .ok()
                .and_then(|line| {
                    line.trim()
                        .strip_prefix("Waiting for selection request number ")
                })
                .and_then(|number| number.parse::<u64>().ok())
            else {
                continue;
            };
            let now = Instant::now();
            let mut progress = shared
                .progress
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let helper = &mut progress[index];
            if number == 1 {
                helper.owned = true;
            } else if helper.served.len() < TRACKED_REQUESTS {
                helper.served.push(now);
            }
            drop(progress);
            shared.changed.notify_all();
        }
    }
    let mut progress = shared
        .progress
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    progress[index].finished = true;
    drop(progress);
    shared.changed.notify_all();
    if let Some(mut child) = child
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take()
    {
        let _ = child.wait();
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    /// A stand-in for `xclip -verbose -selection S -in`: it adds S to `order`,
    /// keeps its input in `S.text`, reports that it owns S, then answers one
    /// request each time `S.serve` appears, and exits when `S.clear` appears, as
    /// on SelectionClear.
    /// It also exits once its folder is gone or after about 10 s, so a stand-in
    /// never outlives its test: one left polling would load the whole machine.
    pub(crate) fn fake_xclip(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "voco-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let program = directory.join("xclip");
        write_program(
            &program,
            r#"#!/bin/sh
dir=${0%/*} selection=$3
echo "$selection" >> "$dir/order"
cat > "$dir/$selection.text" || exit 1
[ -e "$dir/$selection.fail" ] && exit 1
# Leaves the next helper unable to start, once this one has the text.
[ -e "$dir/$selection.unexec" ] && chmod -x "$0"

echo "Waiting for selection requests, Control-C to quit" >&2
number=1 polls=0
echo "  Waiting for selection request number $number" >&2
while [ -d "$dir" ] && [ ! -e "$dir/$selection.clear" ] && [ "$polls" -lt 5000 ]; do
  if [ -e "$dir/$selection.serve" ]; then
    rm -f "$dir/$selection.serve"
    number=$((number + 1))
    echo "  Waiting for selection request number $number" >&2
  fi
  polls=$((polls + 1))
  sleep 0.002
done
"#,
        );
        program
    }

    /// Writes an executable that this process never holds open for writing.
    /// Tests run in parallel threads, and a thread that forks while another
    /// writes the file gives its child that descriptor until the child execs;
    /// the kernel won't run a file open for writing, so spawning the stand-in
    /// would fail with ETXTBSY. A child process writes it instead.
    fn write_program(path: &Path, contents: &str) {
        let mut writer = std::process::Command::new("/bin/sh")
            .args(["-c", "cat > \"$1\" && chmod 755 \"$1\"", "write-program"])
            .arg(path)
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        writer
            .stdin
            .take()
            .unwrap()
            .write_all(contents.as_bytes())
            .unwrap();
        assert!(writer.wait().unwrap().success());
    }

    pub(crate) fn signal(program: &Path, selection: Selection, what: &str) {
        std::fs::write(
            program.with_file_name(format!("{}.{what}", selection.as_str())),
            b"",
        )
        .unwrap();
    }

    fn wait_until(mut done: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !done() {
            assert!(Instant::now() < deadline, "timed out");
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    fn own_both(program: &Path, text: &[u8]) -> SelectionOwners {
        let mut owners = SelectionOwners::new();
        for selection in [Selection::Clipboard, Selection::Primary] {
            owners
                .own(
                    program.to_str().unwrap(),
                    selection,
                    text,
                    Duration::from_secs(5),
                )
                .unwrap();
        }
        owners
    }

    fn release(program: &Path) {
        for selection in [Selection::Clipboard, Selection::Primary] {
            signal(program, selection, "clear");
        }
    }

    /// Releases both selections, waits until every helper has exited, then
    /// removes the stand-in's folder.
    fn finish(owners: &SelectionOwners, program: &Path) {
        release(program);
        for helper in &owners.helpers {
            let proc_path = PathBuf::from(format!("/proc/{}", helper.pid));
            wait_until(|| !proc_path.exists());
        }
        std::fs::remove_dir_all(program.parent().unwrap()).unwrap();
    }

    #[test]
    fn the_app_read_is_the_first_answer_after_the_insert_press_not_the_earlier_one() {
        let program = fake_xclip("selection-read");
        let owners = own_both(&program, b"Synthetic phrase.");
        assert_eq!(
            std::fs::read(program.with_file_name("clipboard.text")).unwrap(),
            b"Synthetic phrase."
        );
        // Mutter's clipboard manager reads each new CLIPBOARD once.
        signal(&program, Selection::Clipboard, "serve");
        wait_until(|| owners.clipboard_served_by(Instant::now()) == 1);
        let inserted = Instant::now();
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(owners.read_after(inserted, Duration::from_millis(15)), None);
        signal(&program, Selection::Clipboard, "serve");
        let read = owners.read_after(inserted, Duration::from_secs(5)).unwrap();
        assert_eq!(read.selection, Selection::Clipboard);
        assert!(read.after >= Duration::from_millis(20));
        finish(&owners, &program);
    }

    #[test]
    fn a_terminal_reads_primary() {
        let program = fake_xclip("primary-read");
        let owners = own_both(&program, b"ls -la");
        signal(&program, Selection::Clipboard, "serve");
        wait_until(|| owners.clipboard_served_by(Instant::now()) == 1);
        let inserted = Instant::now();
        signal(&program, Selection::Primary, "serve");
        let read = owners.read_after(inserted, Duration::from_secs(5)).unwrap();
        assert_eq!(read.selection, Selection::Primary);
        assert_eq!(
            std::fs::read(program.with_file_name("primary.text")).unwrap(),
            b"ls -la"
        );
        finish(&owners, &program);
    }

    #[test]
    fn a_helper_that_fails_or_never_starts_reports_which() {
        let program = fake_xclip("selection-fail");
        signal(&program, Selection::Clipboard, "fail");
        let mut owners = SelectionOwners::new();
        let error = owners
            .own(
                program.to_str().unwrap(),
                Selection::Clipboard,
                b"text",
                Duration::from_secs(5),
            )
            .unwrap_err();
        assert!(matches!(error, OwnerError::Failed(_)), "{error:?}");
        let error = owners
            .own(
                "/definitely-missing-voco-test-helper",
                Selection::Primary,
                b"text",
                Duration::from_secs(5),
            )
            .unwrap_err();
        assert!(matches!(error, OwnerError::Spawn(_)), "{error:?}");
        std::fs::remove_dir_all(program.parent().unwrap()).unwrap();
    }

    /// Its forks also hold other tests' descriptors, such as a socket they
    /// just closed, so it runs alone: `cargo test --lib -- --ignored
    /// stand_ins_start_while_other_threads_fork`.
    #[test]
    #[ignore = "Forks without pause; run it on its own"]
    fn stand_ins_start_while_other_threads_fork() {
        use std::sync::atomic::{AtomicBool, Ordering};
        // Other tests fork all the time, as this thread does: a stand-in
        // written while a fork held its descriptor couldn't start.
        let stop = Arc::new(AtomicBool::new(false));
        let forker = {
            let stop = Arc::clone(&stop);
            std::thread::spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    let mut child = std::process::Command::new("/bin/true");
                    // SAFETY: an empty closure; it makes the spawn fork, as
                    // VOCO's helpers do, rather than use posix_spawn.
                    unsafe { child.pre_exec(|| Ok(())) };
                    let _ = child.status();
                }
            })
        };
        for _ in 0..40 {
            let program = fake_xclip("fork-race");
            let mut stand_in = std::process::Command::new(&program)
                .args(["-verbose", "-selection", "clipboard", "-in"])
                .stdin(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("the stand-in must start");
            signal(&program, Selection::Clipboard, "clear");
            assert!(stand_in.wait().unwrap().success());
            std::fs::remove_dir_all(program.parent().unwrap()).unwrap();
        }
        stop.store(true, Ordering::Relaxed);
        forker.join().unwrap();
    }

    /// Removes a stand-in's folder when the test ends, by panic too: its
    /// helpers exit once the folder is gone, so none outlives the test.
    struct Folder(PathBuf);

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn the_wait_for_a_clipboard_answer_is_bounded() {
        let program = fake_xclip("clipboard-wait");
        let _folder = Folder(program.parent().unwrap().to_path_buf());
        let owners = own_both(&program, b"text");
        let started = Instant::now();
        assert_eq!(
            owners.wait_clipboard_served(Duration::from_millis(30)),
            None
        );
        assert!(started.elapsed() >= Duration::from_millis(30));
        // An answer on PRIMARY isn't Mutter's read of the new CLIPBOARD.
        signal(&program, Selection::Primary, "serve");
        assert_eq!(
            owners.wait_clipboard_served(Duration::from_millis(30)),
            None
        );
        let answer = program.clone();
        let mutter = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            signal(&answer, Selection::Clipboard, "serve");
        });
        let waited = owners
            .wait_clipboard_served(Duration::from_secs(5))
            .unwrap();
        assert!(waited >= Duration::from_millis(20), "{waited:?}");
        mutter.join().unwrap();
        finish(&owners, &program);
    }

    #[test]
    fn the_wait_ends_when_the_clipboard_helper_is_gone() {
        let program = fake_xclip("clipboard-gone");
        let _folder = Folder(program.parent().unwrap().to_path_buf());
        let owners = own_both(&program, b"text");
        signal(&program, Selection::Clipboard, "clear");
        let started = Instant::now();
        assert_eq!(owners.wait_clipboard_served(Duration::from_secs(5)), None);
        assert!(started.elapsed() < Duration::from_secs(2));
        finish(&owners, &program);
    }

    #[test]
    fn a_stand_in_never_outlives_its_folder() {
        let program = fake_xclip("selection-orphan");
        let owners = own_both(&program, b"text");
        std::fs::remove_dir_all(program.parent().unwrap()).unwrap();
        for helper in &owners.helpers {
            let proc_path = PathBuf::from(format!("/proc/{}", helper.pid));
            wait_until(|| !proc_path.exists());
        }
    }

    #[test]
    fn helpers_ignore_broken_pipes_and_are_reaped_when_they_lose_the_selection() {
        let program = fake_xclip("selection-reap");
        let owners = own_both(&program, b"text");
        for helper in &owners.helpers {
            let status = std::fs::read_to_string(format!("/proc/{}/status", helper.pid)).unwrap();
            let ignored = status
                .lines()
                .find_map(|line| line.strip_prefix("SigIgn:"))
                .map(|mask| u64::from_str_radix(mask.trim(), 16).unwrap())
                .unwrap();
            assert_ne!(
                ignored & (1 << (libc::SIGPIPE - 1)),
                0,
                "SIGPIPE must be ignored"
            );
        }
        release(&program);
        for helper in &owners.helpers {
            let proc_path = PathBuf::from(format!("/proc/{}", helper.pid));
            wait_until(|| !proc_path.exists());
            // SAFETY: waitpid only observes our own child, which the helper's
            // thread must already have reaped.
            let result = unsafe { libc::waitpid(helper.pid, std::ptr::null_mut(), libc::WNOHANG) };
            assert_eq!(result, -1);
        }
        assert_eq!(
            owners.read_after(Instant::now(), Duration::from_secs(5)),
            None
        );
        std::fs::remove_dir_all(program.parent().unwrap()).unwrap();
    }
}
