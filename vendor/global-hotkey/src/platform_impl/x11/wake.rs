// Copyright 2026 VOCO Contributors
// SPDX-License-Identifier: Apache-2.0 OR MIT
//! Wait on X11 and actor commands without periodic idle polling.
use crossbeam_channel::{Receiver, Sender};
use std::io::{self, Read, Write};
use std::os::fd::{AsFd, AsRawFd, BorrowedFd};
use std::os::unix::net::UnixStream;
use std::sync::Arc;
use std::time::Instant;

pub struct WakeSender<T> {
    queue: Sender<T>,
    signal: Option<Arc<UnixStream>>,
}
impl<T> Clone for WakeSender<T> {
    fn clone(&self) -> Self {
        Self {
            queue: self.queue.clone(),
            signal: self.signal.clone(),
        }
    }
}

pub struct WakeReceiver<T> {
    pub queue: Receiver<T>,
    signal: UnixStream,
}

pub fn channel<T>() -> io::Result<(WakeSender<T>, WakeReceiver<T>)> {
    let (reader, writer) = UnixStream::pair()?;
    reader.set_nonblocking(true)?;
    writer.set_nonblocking(true)?;
    let (tx, rx) = crossbeam_channel::unbounded();
    Ok((
        WakeSender {
            queue: tx,
            signal: Some(Arc::new(writer)),
        },
        WakeReceiver {
            queue: rx,
            signal: reader,
        },
    ))
}

// Unit tests can exercise actor request ordering without an X display or waker.
#[cfg(test)]
impl<T> From<Sender<T>> for WakeSender<T> {
    fn from(queue: Sender<T>) -> Self {
        Self {
            queue,
            signal: None,
        }
    }
}

impl<T> WakeSender<T> {
    pub fn send(&self, message: T) -> io::Result<()> {
        self.queue
            .send(message)
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "actor stopped"))?;
        let Some(signal) = &self.signal else {
            return Ok(());
        };
        let mut signal = &**signal;
        loop {
            match signal.write(&[1]) {
                Ok(1) => return Ok(()),
                Ok(_) => {
                    return Err(io::Error::new(
                        io::ErrorKind::WriteZero,
                        "actor wake failed",
                    ))
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => return Ok(()),
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e),
            }
        }
    }
}

impl<T> WakeReceiver<T> {
    /// Drain a bounded amount; remaining signal bytes keep poll readable.
    pub fn drain_signal(&self) -> io::Result<()> {
        let mut signal = &self.signal;
        let mut bytes = [0; 512];
        for _ in 0..8 {
            match signal.read(&mut bytes) {
                Ok(0) => {
                    return Err(io::Error::new(
                        io::ErrorKind::BrokenPipe,
                        "actor senders stopped",
                    ))
                }
                Ok(_) => {}
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => return Ok(()),
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }
    pub fn wait(&self, x11: BorrowedFd<'_>, deadline: Option<Instant>) -> io::Result<Ready> {
        wait_fds(x11, self.signal.as_fd(), deadline)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Ready {
    Activity { x11: bool, commands: bool },
    Deadline,
}

fn poll_timeout(deadline: Option<Instant>, now: Instant) -> i32 {
    match deadline {
        None => -1,
        Some(deadline) => {
            let remaining = deadline.saturating_duration_since(now);
            if remaining.is_zero() {
                return 0;
            }
            // Round up so a sub-millisecond remainder does not spin.
            remaining
                .as_millis()
                .saturating_add(u128::from(remaining.subsec_nanos() % 1_000_000 != 0))
                .min(i32::MAX as u128) as i32
        }
    }
}

fn wait_fds(
    x11: BorrowedFd<'_>,
    wake: BorrowedFd<'_>,
    deadline: Option<Instant>,
) -> io::Result<Ready> {
    wait_fds_with(x11, wake, deadline, |fds, timeout| {
        // SAFETY: borrowed descriptors outlive poll; fds is a writable two-element
        // array, and no references cross this syscall.
        let count = unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as libc::nfds_t, timeout) };
        if count < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(count)
        }
    })
}

fn wait_fds_with(
    x11: BorrowedFd<'_>,
    wake: BorrowedFd<'_>,
    deadline: Option<Instant>,
    mut poll: impl FnMut(&mut [libc::pollfd; 2], i32) -> io::Result<i32>,
) -> io::Result<Ready> {
    loop {
        let mut fds = [
            libc::pollfd {
                fd: x11.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            },
            libc::pollfd {
                fd: wake.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            },
        ];
        let count = match poll(&mut fds, poll_timeout(deadline, Instant::now())) {
            Ok(count) => count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        if fds
            .iter()
            .any(|fd| fd.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0)
        {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "actor event source closed",
            ));
        }
        if count > 0 {
            return Ok(Ready::Activity {
                x11: fds[0].revents & libc::POLLIN != 0,
                commands: fds[1].revents & libc::POLLIN != 0,
            });
        }
        if deadline.is_some_and(|limit| Instant::now() >= limit) {
            return Ok(Ready::Deadline);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    #[test]
    fn idle_wait_is_unbounded_but_command_wakes_it_without_periodic_timer() {
        let (tx, rx) = channel().unwrap();
        let (x, _peer) = UnixStream::pair().unwrap();
        let worker = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            tx.send(7).unwrap();
            std::thread::sleep(Duration::from_millis(20));
        });
        assert_eq!(
            rx.wait(x.as_fd(), None).unwrap(),
            Ready::Activity {
                x11: false,
                commands: true
            }
        );
        assert_eq!(rx.queue.try_recv().unwrap(), 7);
        worker.join().unwrap();
    }
    #[test]
    fn x_event_wakes_without_command_or_polling_timeout() {
        let (_tx, rx) = channel::<u8>().unwrap();
        let (x, mut peer) = UnixStream::pair().unwrap();
        let worker = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            peer.write_all(&[1]).unwrap();
            std::thread::sleep(Duration::from_millis(20));
        });
        assert_eq!(
            rx.wait(x.as_fd(), None).unwrap(),
            Ready::Activity {
                x11: true,
                commands: false
            }
        );
        worker.join().unwrap();
    }
    #[test]
    fn enqueue_between_final_queue_check_and_poll_is_not_lost() {
        let (tx, rx) = channel().unwrap();
        let (x, _peer) = UnixStream::pair().unwrap();
        rx.drain_signal().unwrap();
        assert!(rx.queue.try_recv().is_err());
        tx.send(42).unwrap();
        assert_eq!(
            rx.wait(x.as_fd(), Some(Instant::now() + Duration::from_secs(1)))
                .unwrap(),
            Ready::Activity {
                x11: false,
                commands: true
            }
        );
        assert_eq!(rx.queue.try_recv().unwrap(), 42);
    }
    #[test]
    fn full_nonblocking_signal_buffer_does_not_lose_queued_commands() {
        let (tx, rx) = channel().unwrap();
        let (x, _peer) = UnixStream::pair().unwrap();
        for n in 0..100_000 {
            tx.send(n).unwrap();
        }
        assert_eq!(
            rx.wait(x.as_fd(), Some(Instant::now() + Duration::from_secs(1)))
                .unwrap(),
            Ready::Activity {
                x11: false,
                commands: true
            }
        );
        rx.drain_signal().unwrap();
        assert_eq!(
            rx.queue.try_iter().collect::<Vec<_>>(),
            (0..100_000).collect::<Vec<_>>()
        );
    }
    #[test]
    fn deadline_and_peer_disconnect_are_terminal_without_busy_polling() {
        let (_tx, rx) = channel::<u8>().unwrap();
        let (x, peer) = UnixStream::pair().unwrap();
        assert_eq!(
            rx.wait(x.as_fd(), Some(Instant::now() + Duration::from_millis(5)))
                .unwrap(),
            Ready::Deadline
        );
        drop(peer);
        assert_eq!(
            rx.wait(x.as_fd(), None).unwrap_err().kind(),
            io::ErrorKind::BrokenPipe
        );
    }
    #[test]
    fn timeout_rounds_up_and_never_adds_an_idle_tick() {
        let now = Instant::now();
        assert_eq!(poll_timeout(None, now), -1);
        assert_eq!(poll_timeout(Some(now), now), 0);
        assert_eq!(poll_timeout(Some(now + Duration::from_nanos(1)), now), 1);
        assert_eq!(
            poll_timeout(Some(now + Duration::from_millis(650_000)), now),
            650_000
        );
    }
    #[test]
    fn interrupted_poll_recalculates_remaining_deadline() {
        let (x, peer) = UnixStream::pair().unwrap();
        let deadline = Instant::now() + Duration::from_millis(3);
        let mut calls = 0;
        let result = wait_fds_with(x.as_fd(), peer.as_fd(), Some(deadline), |_fds, timeout| {
            calls += 1;
            if calls == 1 {
                assert!(timeout > 0);
                std::thread::sleep(Duration::from_millis(5));
                Err(io::Error::from(io::ErrorKind::Interrupted))
            } else {
                assert_eq!(timeout, 0);
                Ok(0)
            }
        })
        .unwrap();
        assert_eq!(result, Ready::Deadline);
        assert_eq!(calls, 2);
    }
    #[test]
    fn poll_error_flags_fail_closed_and_simultaneous_sources_are_retained() {
        let (x, peer) = UnixStream::pair().unwrap();
        for flag in [libc::POLLERR, libc::POLLHUP, libc::POLLNVAL] {
            let result = wait_fds_with(x.as_fd(), peer.as_fd(), None, |fds, _| {
                fds[0].revents = flag;
                Ok(1)
            });
            assert_eq!(result.unwrap_err().kind(), io::ErrorKind::BrokenPipe);
        }
        let result = wait_fds_with(x.as_fd(), peer.as_fd(), None, |fds, _| {
            fds[0].revents = libc::POLLIN;
            fds[1].revents = libc::POLLIN;
            Ok(2)
        })
        .unwrap();
        assert_eq!(
            result,
            Ready::Activity {
                x11: true,
                commands: true
            }
        );
    }
}
