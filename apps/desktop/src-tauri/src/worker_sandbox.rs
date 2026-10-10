//! Keep the speech worker off the network. Just before its Python starts, the
//! worker's process marks every descriptor beyond its pipes close-on-exec, so
//! it inherits no socket, and installs a seccomp filter that refuses every new
//! socket except a local Unix one. Recognition needs no network.

use std::io;
use std::os::unix::process::CommandExt;
use std::process::Command;

#[cfg(target_arch = "x86_64")]
const AUDIT_ARCH: u32 = 0xc000_003e;
#[cfg(target_arch = "aarch64")]
const AUDIT_ARCH: u32 = 0xc000_00b7;
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
compile_error!("the worker sandbox needs this architecture's AUDIT_ARCH value");

const LOAD: u16 = (libc::BPF_LD | libc::BPF_W | libc::BPF_ABS) as u16;
const IS: u16 = (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16;
const AT_LEAST: u16 = (libc::BPF_JMP | libc::BPF_JGE | libc::BPF_K) as u16;
const RETURN: u16 = (libc::BPF_RET | libc::BPF_K) as u16;
// Offsets into struct seccomp_data; ARG0 is the low half of args[0].
const NR: u32 = 0;
const ARCH: u32 = 4;
const ARG0: u32 = 16;
const X32_SYSCALL_BIT: u32 = 0x4000_0000;
const REFUSE: u32 = libc::SECCOMP_RET_ERRNO | libc::EACCES as u32;

// The instructions that jumps land on.
const FAMILY: usize = 7;
const ALLOWED: usize = 9;
const REFUSED: usize = 10;

const fn op(code: u16, k: u32) -> libc::sock_filter {
    libc::sock_filter {
        code,
        jt: 0,
        jf: 0,
        k,
    }
}

/// Instruction `at` goes to `then` when the test holds, otherwise to `otherwise`.
const fn jump(at: usize, code: u16, k: u32, then: usize, otherwise: usize) -> libc::sock_filter {
    libc::sock_filter {
        code,
        jt: (then - at - 1) as u8,
        jf: (otherwise - at - 1) as u8,
        k,
    }
}

static FILTER: [libc::sock_filter; 11] = [
    op(LOAD, ARCH),
    jump(1, IS, AUDIT_ARCH, 2, REFUSED), // another ABI's calls
    op(LOAD, NR),
    jump(3, AT_LEAST, X32_SYSCALL_BIT, REFUSED, 4), // x32 calls
    jump(4, IS, libc::SYS_socket as u32, FAMILY, 5),
    jump(5, IS, libc::SYS_socketpair as u32, FAMILY, 6),
    // io_uring can open a socket without socket(2).
    jump(6, IS, libc::SYS_io_uring_setup as u32, REFUSED, ALLOWED),
    op(LOAD, ARG0), // FAMILY
    jump(8, IS, libc::AF_UNIX as u32, ALLOWED, REFUSED),
    op(RETURN, libc::SECCOMP_RET_ALLOW), // ALLOWED
    op(RETURN, REFUSE),                  // REFUSED
];

/// Confine `command`'s child. Any step that fails fails the spawn, so the
/// worker never runs unconfined.
pub fn deny_network(command: &mut Command) {
    // SAFETY: between fork and exec the closure makes only system calls, on
    // the static program and a descriptor on its own stack.
    unsafe {
        command.pre_exec(|| {
            let (on, off): (libc::c_ulong, libc::c_ulong) = (1, 0);
            let (first, last) = (libc::c_ulong::from(3_u32), libc::c_ulong::from(u32::MAX));
            let program = libc::sock_fprog {
                len: FILTER.len() as libc::c_ushort,
                filter: FILTER.as_ptr().cast_mut(),
            };
            let flags = libc::c_ulong::from(libc::CLOSE_RANGE_CLOEXEC);
            let mode = libc::c_ulong::from(libc::SECCOMP_SET_MODE_FILTER);
            if libc::syscall(libc::SYS_close_range, first, last, flags) != 0
                || libc::prctl(libc::PR_SET_NO_NEW_PRIVS, on, off, off, off) != 0
                || libc::syscall(libc::SYS_seccomp, mode, off, &raw const program) != 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Run the program the way the kernel does, for one system call.
    fn verdict(arch: u32, nr: u32, arg0: u64) -> u32 {
        let mut data = [0_u8; 64];
        data[0..4].copy_from_slice(&nr.to_ne_bytes());
        data[4..8].copy_from_slice(&arch.to_ne_bytes());
        data[16..24].copy_from_slice(&arg0.to_ne_bytes());
        let (mut at, mut accumulator) = (0, 0_u32);
        loop {
            let instruction = FILTER[at];
            at += 1;
            let taken = match instruction.code {
                LOAD => {
                    let offset = instruction.k as usize;
                    let word = data[offset..offset + 4].try_into().unwrap();
                    accumulator = u32::from_ne_bytes(word);
                    continue;
                }
                IS => accumulator == instruction.k,
                AT_LEAST => accumulator >= instruction.k,
                RETURN => return instruction.k,
                code => panic!("unexpected instruction {code:#x}"),
            };
            at += usize::from(if taken {
                instruction.jt
            } else {
                instruction.jf
            });
        }
    }

    fn call(nr: libc::c_long, arg0: i32) -> u32 {
        verdict(AUDIT_ARCH, nr as u32, arg0 as u64)
    }

    #[test]
    fn only_local_sockets_are_allowed_and_every_other_call_passes() {
        let allow = libc::SECCOMP_RET_ALLOW;
        assert_eq!(call(libc::SYS_socket, libc::AF_UNIX), allow);
        assert_eq!(call(libc::SYS_socketpair, libc::AF_UNIX), allow);
        for family in [
            libc::AF_INET,
            libc::AF_INET6,
            libc::AF_NETLINK,
            libc::AF_PACKET,
        ] {
            assert_eq!(call(libc::SYS_socket, family), REFUSE, "{family}");
            assert_eq!(call(libc::SYS_socketpair, family), REFUSE, "{family}");
        }
        // The kernel reads the family as an int, so only the low half counts.
        let high = 1_u64 << 32;
        let inet = high | libc::AF_INET as u64;
        assert_eq!(verdict(AUDIT_ARCH, libc::SYS_socket as u32, inet), REFUSE);
        assert_eq!(call(libc::SYS_io_uring_setup, 1), REFUSE);
        for nr in [
            libc::SYS_read,
            libc::SYS_write,
            libc::SYS_openat,
            libc::SYS_connect,
        ] {
            assert_eq!(call(nr, libc::AF_INET), allow, "{nr}");
        }
    }

    #[test]
    fn another_abi_and_x32_calls_are_refused() {
        // i386 read, and i386 socketcall, which multiplexes socket(2).
        const AUDIT_ARCH_I386: u32 = 0x4000_0003;
        assert_eq!(verdict(AUDIT_ARCH_I386, 3, 0), REFUSE);
        assert_eq!(verdict(AUDIT_ARCH_I386, 102, 1), REFUSE);
        let x32_socket = X32_SYSCALL_BIT | libc::SYS_socket as u32;
        assert_eq!(
            verdict(AUDIT_ARCH, x32_socket, libc::AF_UNIX as u64),
            REFUSE
        );
    }

    const PROBE: &str = r#"
import ctypes, errno, os, socket, sys

def outcome(attempt):
    try:
        attempt()
        return "opened"
    except OSError as error:
        return errno.errorcode[error.errno]

families = (socket.AF_INET, socket.AF_INET6, socket.AF_NETLINK, socket.AF_PACKET)
print(*(outcome(lambda: socket.socket(f, socket.SOCK_DGRAM).close()) for f in families))
libc = ctypes.CDLL(None, use_errno=True)
params = ctypes.create_string_buffer(120)
ring = libc.syscall(ctypes.c_long(425), ctypes.c_long(1), params)
print("io_uring", "opened" if ring >= 0 else errno.errorcode[ctypes.get_errno()])
socket.socketpair()
socket.socket(socket.AF_UNIX).close()
print("unix opened")
print("inherited", outcome(lambda: os.fstat(int(sys.argv[1]))))
"#;

    fn probe(confined: bool, inherited: i32) -> String {
        let mut command = Command::new("/usr/bin/python3");
        command.args(["-E", "-s", "-B", "-c", PROBE, &inherited.to_string()]);
        if confined {
            deny_network(&mut command);
        }
        let output = command.output().expect("python3 runs");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }

    /// The real filter on the real interpreter. Without it, the same probe
    /// opens a network socket and sees the inherited descriptor.
    #[test]
    fn the_worker_interpreter_gets_no_network_socket_and_inherits_no_descriptor() {
        // SAFETY: plain descriptor calls. The duplicate lacks close-on-exec, so
        // children inherit it, and sits too high for Python to reuse by chance.
        let inherited = unsafe {
            let null = libc::open(c"/dev/null".as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC);
            let high = libc::fcntl(null, libc::F_DUPFD, 100);
            libc::close(null);
            high
        };
        assert!(inherited >= 100);
        let confined = probe(true, inherited);
        let open = probe(false, inherited);
        // SAFETY: the descriptor opened above.
        unsafe { libc::close(inherited) };
        assert_eq!(
            confined,
            "EACCES EACCES EACCES EACCES\nio_uring EACCES\nunix opened\ninherited EBADF\n"
        );
        assert!(open.starts_with("opened "), "{open}");
        assert!(open.ends_with("\ninherited opened\n"), "{open}");
    }
}
