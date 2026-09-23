#!/usr/bin/env python3
"""Exercise the production ELF in a device-free namespace with a uinput syscall sink."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import socket
import stat
import struct
import subprocess
import sys
import time

if not __debug__:
    raise SystemExit('Assertions are required; do not use Python optimization')

ROOT = Path(__file__).resolve().parents[1]
SOCKET = '/tmp/.ydotool_socket'
PACKET = struct.Struct('=HHi')
EVENT = struct.Struct('@llHHi')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def limits():
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def fd_count(process):
    return len(list(Path(f'/proc/{process.pid}/fd').iterdir()))


def tick_count(process):
    fields = Path(f'/proc/{process.pid}/stat').read_text().split()
    return int(fields[13]) + int(fields[14])


def wait(predicate, process, message, seconds=3):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        assert process.poll() is None, f'Daemon exited during {message}'
        time.sleep(.002)
    raise AssertionError('Timed out: ' + message)


def trial(output, daemon, name, *, failure='', clients=0, payload=None, client_binary=None,
          fragments=False, abrupt=False, expect_exit=None):
    directory = output / name
    directory.mkdir()
    events, setup = directory / 'events.bin', directory / 'setup.json'
    env = {**os.environ, 'LD_PRELOAD': str(output / 'syscalls.so'),
           'VOCO_TEST_EVENTS': str(events), 'VOCO_TEST_SETUP': str(setup), 'VOCO_TEST_FAILURE': failure,
           'VOCO_TEST_ACCEPTED': str(directory / 'accepted-fd.txt')}
    result = {'name': name, 'passed': False, 'connected_clients': 0}
    with (directory / 'daemon.log').open('w') as log:
        process = subprocess.Popen([str(daemon)], env=env, stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=log, preexec_fn=limits)
    try:
        if expect_exit is not None and failure != 'thread-create':
            process.wait(timeout=3)
        else:
            wait(lambda: setup.exists(), process, 'uinput setup')
            result['setup'] = json.loads(setup.read_text())
            assert result['setup']['device'] == 'ydotoold virtual device'
            assert result['setup']['events'] == 14 and result['setup']['keys'] > 500
            assert result['setup']['relativeAxes'] == 5
            assert stat.S_IMODE(Path(SOCKET).stat().st_mode) == 0o600
            initial = fd_count(process)
            if client_binary:
                before = events.stat().st_size
                commands = [([], 'ctrl+v'), ([' '], 'ctrl+v'), ([], 'ctrl+shift+v'), ([' '], 'ctrl+shift+v')]
                result['client_cases'] = []
                for prefix, chord in commands:
                    args = [str(client_binary), 'key', '--delay', '24', '--key-delay', '12', *prefix, chord]
                    subprocess.run(args, check=True, timeout=3, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                    expected_keys = ([29, 42, 47] if 'shift' in chord else [29, 47])
                    expected = ([(1, 57, 1), (0, 0, 0), (1, 57, 0), (0, 0, 0)] if prefix else [])
                    for value, keys in [(1, expected_keys), (0, list(reversed(expected_keys)))]:
                        for code in keys:
                            expected.extend([(1, code, value), (0, 0, 0)])
                    wait(lambda: events.stat().st_size >= before + len(expected) * EVENT.size, process, 'client events')
                    chunk = events.read_bytes()[before:]
                    actual = [tuple(EVENT.unpack_from(chunk, i)[2:]) for i in range(0, len(chunk), EVENT.size)]
                    assert actual == expected, (args, actual, expected)
                    result['client_cases'].append({'arguments': args[1:], 'events': actual})
                    before += len(chunk)
            for index in range(clients):
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                    client.settimeout(2)
                    client.connect(SOCKET)
                    result['connected_clients'] += 1
                    if payload:
                        if fragments:
                            client.sendall(payload[:3]); time.sleep(.003); client.sendall(payload[3:])
                        else:
                            client.sendall(payload)
                    if abrupt:
                        client.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
                    else:
                        # EOF is the direct lifecycle witness. Bound each client
                        # rather than overloading the unchanged 16-slot backlog.
                        client.shutdown(socket.SHUT_WR)
                        assert client.recv(1) == b'', 'Unexpected daemon reply'
                if abrupt:
                    time.sleep(.003)
            if expect_exit is not None:
                process.wait(timeout=3)
            else:
                bound = initial
                wait(lambda: fd_count(process) <= bound, process, 'client descriptor reclamation')
                result['fds_before'] = initial
                result['fds_after'] = fd_count(process)
                before = tick_count(process)
                time.sleep(.15)
                result['idle_cpu_ticks'] = tick_count(process) - before
                assert result['idle_cpu_ticks'] <= 2, 'Daemon spins while idle'
                assert process.poll() is None
                if failure == 'fd-zero':
                    assert (directory / 'accepted-fd.txt').read_text().strip() == '0'
        if expect_exit is not None:
            result['exit_code'] = process.returncode
            assert (process.returncode == expect_exit if expect_exit >= 0 else process.returncode != 0)
        result['passed'] = True
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait(timeout=3)
        data = events.read_bytes() if events.exists() else b''
        assert len(data) % EVENT.size == 0
        result['emitted_events'] = [list(EVENT.unpack_from(data, i)[2:]) for i in range(0, len(data), EVENT.size)]
        Path(SOCKET).unlink(missing_ok=True)
        (directory / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def inside(output, daemon, client):
    assert not any(Path(p).exists() for p in ('/dev/uinput', '/dev/input', '/dev/snd', SOCKET))
    assert EVENT.size == 24 and PACKET.size == 8
    report = {'passed': False, 'scope': 'unchanged production ELF with test-only uinput syscall sink',
              'real_input_devices_opened': 0, 'daemon_sha256': sha(daemon), 'client_sha256': sha(client), 'trials': []}
    try:
        def run(name, **kwargs):
            result = trial(output, daemon, name, **kwargs)
            report['trials'].append(result)
            return result
        zero = run('empty-clients', clients=2000)
        assert zero['emitted_events'] == [] and zero['connected_clients'] == 2000
        event = PACKET.pack(1, 194, 1)  # F24; the sink cannot reach any device.
        full = run('event-clients', clients=2000, payload=event)
        assert full['emitted_events'] == [[1, 194, 1]] * 2000
        run('qualified-client-chords', client_binary=client)
        for name, failure in [('accept-eintr', 'accept-eintr'), ('recv-eintr', 'recv-eintr'), ('fd-zero', 'fd-zero')]:
            result = run(name, failure=failure, clients=32, payload=event)
            assert result['emitted_events'] == [[1, 194, 1]] * 32
        result = run('fragmented-frame', clients=16, payload=event, fragments=True)
        assert result['emitted_events'] == [[1, 194, 1]] * 16
        for size in range(1, 8):
            result = run(f'truncated-frame-{size}', clients=16, payload=event[:size])
            assert result['emitted_events'] == []
        result = run('abrupt-client', clients=32, abrupt=True)
        assert result['emitted_events'] == []
        for failure in ('accept-emfile', 'accept-ebadf'):
            run(failure, failure=failure, expect_exit=1)
        run('thread-create', failure='thread-create', clients=1, expect_exit=1)
        for failure in ('uinput-open', 'uinput-setup'):
            run(failure, failure=failure, expect_exit=-1)
        report['passed'] = True
    except Exception as error:
        report['error'] = str(error)
    finally:
        (output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passed': report['passed'], 'cases': len(report['trials']), 'error': report.get('error')}))
    return 0 if report['passed'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--daemon', type=Path, help='Exact production binary; build fresh if omitted')
    parser.add_argument('--client', type=Path, default=Path('/usr/bin/ydotool'))
    parser.add_argument('--inside', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    output = args.output.resolve()
    if args.inside:
        return inside(output, args.daemon.resolve(), args.client.resolve())
    output.mkdir(parents=True, exist_ok=False)
    daemon = args.daemon.resolve() if args.daemon else output / 'build/ydotoold'
    if not args.daemon:
        subprocess.run([sys.executable, str(ROOT / 'scripts/build-legacy-ydotool.py'),
                        '--output', str(output / 'build')], check=True, timeout=120)
    shim = ROOT / 'scripts/fixtures/legacy-ydotool-syscalls.c'
    subprocess.run(['cc', '-std=c11', '-O2', '-shared', '-fPIC', '-Wall', '-Wextra', '-Werror',
                    '-UNDEBUG', str(shim), '-ldl', '-pthread', '-o', str(output / 'syscalls.so')], check=True, timeout=30)
    (output / 'inputs.json').write_text(json.dumps({'daemon_sha256': sha(daemon),
        'shim_source_sha256': sha(shim), 'shim_binary_sha256': sha(output / 'syscalls.so'),
        'script_sha256': sha(Path(__file__)), 'client_sha256': sha(args.client)}, indent=2) + '\n')
    result = subprocess.run(['bwrap', '--unshare-all', '--die-with-parent', '--new-session',
        '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '--tmpfs', '/run/user',
        '--ro-bind', str(ROOT), str(ROOT), '--bind', str(output), str(output), '--ro-bind', str(daemon), str(daemon),
        '--unsetenv', 'LD_PRELOAD', '--', sys.executable, str(Path(__file__).resolve()), '--inside',
        '--output', str(output), '--daemon', str(daemon), '--client', str(args.client.resolve())], timeout=60)
    return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
