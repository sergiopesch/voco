#!/usr/bin/env python3
"""Standalone, server-free native callback regression using real C implementation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]

def run(argv, timeout, env):
    started = time.monotonic()
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env=env, start_new_session=True)
    timed_out = False
    completed = False
    try:
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
            completed = True
        except subprocess.TimeoutExpired:
            timed_out = True
    finally:
        if not completed:
            # An interrupt or timeout must not leave compiler children running.
            # Ignore a second Ctrl-C only during this bounded owned-group cleanup.
            previous = signal.signal(signal.SIGINT, signal.SIG_IGN)
            try:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass  # The process group can finish between timeout and kill.
                stdout, stderr = proc.communicate(timeout=5)
            finally:
                signal.signal(signal.SIGINT, previous)
    return {'argv': argv, 'exitCode': proc.returncode, 'timedOut': timed_out,
            'elapsedSeconds': time.monotonic() - started,
            'stdout': stdout.decode('utf-8', errors='replace'),
            'stderr': stderr.decode('utf-8', errors='replace')}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, help='New JSON report, never overwritten')
    args = parser.parse_args()
    # Reserve publication before any subprocess; repeated use cannot overwrite evidence.
    handle = args.report.open('x') if args.report else None
    report = {'passed': False, 'deviceConnections': 0, 'steps': {}}
    try:
        env = os.environ.copy()
        compiler = shlex.split(env.get('CC', 'cc'))
        if not compiler:
            raise ValueError('CC must name a C compiler')
        paths = [ROOT/'scripts/native-capture-lifecycle.test.c',
                 ROOT/'apps/desktop/src-tauri/native/native_capture_pulse.c',
                 ROOT/'apps/desktop/src-tauri/native/native_capture_pulse.h',
                 Path(__file__).resolve()]
        report['sourceSha256'] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        def checked(name, argv, timeout):
            result = run(argv, timeout, env)
            report['steps'][name] = result
            if result['exitCode'] or result['timedOut']:
                raise RuntimeError(f'{name} failed (exit {result["exitCode"]}, timeout={result["timedOut"]}): {result["stderr"]}')
            return result
        flags = shlex.split(checked('pkg-config', ['pkg-config', '--cflags', 'libpulse'], 10)['stdout'])
        if any(token.startswith('-DNDEBUG') or token == 'NDEBUG' for token in compiler + flags):
            raise ValueError('NDEBUG disables regression assertions and is not supported')
        includes = [Path(flag[2:]) for flag in flags if flag.startswith('-I') and len(flag) > 2]
        includes.append(Path('/usr/include'))
        pulse_dir = next((directory/'pulse' for directory in includes if (directory/'pulse/pulseaudio.h').is_file()), None)
        if pulse_dir is None:
            raise ValueError('Cannot bind the Pulse header directory')
        report['pulseHeaderSha256'] = {str(header): hashlib.sha256(header.read_bytes()).hexdigest()
                                       for header in sorted(pulse_dir.glob('*.h'))}
        checked('compiler-version', compiler + ['--version'], 10)
        # No --libs or libpulse linkage: all exercised transport functions are doubles.
        with tempfile.TemporaryDirectory(prefix='voco-native-callbacks-') as temporary:
            executable = str(Path(temporary)/'test')
            checked('compile', compiler + ['-std=c11', '-O1', '-g', '-Wall', '-Wextra', '-Werror',
                    '-ffunction-sections', '-fdata-sections', '-fsanitize=address,undefined',
                    '-fno-omit-frame-pointer'] + flags +
                    ['-UNDEBUG', '-I'+str(paths[1].parent), str(paths[0]), '-Wl,--gc-sections', '-o', executable], 60)
            env['ASAN_OPTIONS'] = 'detect_leaks=1:abort_on_error=1'
            env['UBSAN_OPTIONS'] = 'halt_on_error=1:print_stacktrace=1'
            report['sanitizerOptions'] = {key: env[key] for key in ['ASAN_OPTIONS', 'UBSAN_OPTIONS']}
            result = checked('runtime', [executable], 10)
            rows = [json.loads(line) for line in result['stdout'].splitlines()]
            if not rows or rows[-1] != {'passed': True, 'cases': 66, 'actualProductionCallbacks': True,
                                       'pulseTransportMocked': True, 'deviceConnections': 0}:
                raise ValueError('Missing exact terminal success record')
            report['results'] = rows
        report['passed'] = True
    except Exception as error:
        report['error'] = str(error)
    finally:
        if handle:
            with handle:
                json.dump(report, handle, indent=2)
                handle.write('\n')
    if report['passed']:
        print('PASS: 66 native callback cases; ASan/UBSan; Pulse transport and clock mocked; no audio server.')
    else:
        print('FAIL: '+report['error'], file=sys.stderr)
    return 0 if report['passed'] else 1

if __name__ == '__main__':
    raise SystemExit(main())
