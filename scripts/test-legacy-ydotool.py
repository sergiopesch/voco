#!/usr/bin/env python3
"""Verify actual legacy ydotool events in a private socket sink, never the desktop.

Requires Linux, bwrap and ydotool 0.1.x. Newer helpers use a different protocol;
this test exits with a clear error instead of pretending to cover them.
"""
import argparse
import hashlib
import json
from pathlib import Path
import socket
import struct
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inside', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not args.inside:
        subprocess.run([
            'bwrap', '--unshare-all', '--die-with-parent', '--ro-bind', '/', '/',
            '--dev', '/dev', '--tmpfs', '/tmp', '/usr/bin/python3',
            str(Path(__file__).resolve()), '--inside',
        ], check=True, timeout=30)
        return
    # Verify the namespace cannot reach the owner's helper or physical devices.
    assert not Path('/dev/uinput').exists()
    assert not Path('/tmp/.ydotool_socket').exists()
    results = []
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
        server.bind('/tmp/.ydotool_socket')
        server.listen()
        server.settimeout(3)
        def capture(arguments):
            with subprocess.Popen(['/usr/bin/ydotool', 'key', '--delay', '24', '--key-delay', '12', *arguments],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
                try:
                    client, _ = server.accept()
                    with client:
                        client.settimeout(3)
                        data = bytearray()
                        while True:
                            chunk = client.recv(4096)
                            if not chunk:
                                break
                            data.extend(chunk)
                            assert len(data) <= 4096
                    _, stderr = process.communicate(timeout=3)
                    assert process.returncode == 0, stderr.decode()
                    assert len(data) % 8 == 0
                    return [list(struct.unpack_from('HHi', data, offset))
                            for offset in range(0, len(data), 8)
                            if struct.unpack_from('H', data, offset)[0] == 1]
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.communicate()
        # Retain the original bug as an explicit negative control.
        broken = capture(['space', 'ctrl+v'])
        assert broken[:2] == [[1, 31, 1], [1, 31, 0]], 'Requires legacy ydotool 0.1.x'
        results.append({'case': 'old-space-name-negative-control', 'events': broken})
        for terminal in (False, True):
            for separator in (False, True):
                command = ([' '] if separator else []) + ['ctrl+shift+v' if terminal else 'ctrl+v']
                chord = [29] + ([42] if terminal else []) + [47]
                expected = ([[1, 57, 1], [1, 57, 0]] if separator else [])
                expected += [[1, key, 1] for key in chord]
                expected += [[1, key, 0] for key in reversed(chord)]
                actual = capture(command)
                assert actual == expected, (command, actual, expected)
                results.append({'terminal': terminal, 'separator': separator, 'events': actual})
    print(json.dumps({'status': 'passed', 'positive_cases': 4, 'negative_controls': 1,
                      'scope': 'installed legacy helper key events; no target editor or compositor',
                      'helper_sha256': hashlib.sha256(Path('/usr/bin/ydotool').read_bytes()).hexdigest(),
                      'results': results}, indent=2))


if __name__ == '__main__':
    main()
