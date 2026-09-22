#!/usr/bin/env python3
"""Real C/Pulse regression in a private device-free namespace (Linux only)."""
import argparse
import array
import ctypes as C
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import time
import wave

from test_native_wayland_capture import capture_continuity, pcm16

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'apps/desktop/src-tauri/native/native_capture_pulse.c'
FIXTURE = ROOT / 'tests/fixtures/speech/84-121123-0000.wav'
FIXTURE_SHA256 = '6e8353d85498a02b0e06c0107e81f48b2020615b541d13a13440b41effbac0ff'
PADDED_SHA256 = '7baaad00667657bec419c66adf30f62d0658e795239308172215c121efc8101b'
MAX_BUFFER_LATENCY_US = 250000  # Existing 200 ms bound plus scheduling margin.


class Source(C.Structure):
    _fields_ = [('name', C.c_char * 512), ('label', C.c_char * 512),
                ('serial', C.c_char * 128), ('index', C.c_uint32), ('monitor', C.c_int)]


class Catalog(C.Structure):
    _fields_ = [('revision', C.c_uint64), ('count', C.c_uint32),
                ('default_name', C.c_char * 512), ('sources', Source * 128)]


class Status(C.Structure):
    _fields_ = [('frames', C.c_uint64), ('blocks', C.c_uint64), ('ready', C.c_int),
                ('stopped', C.c_int), ('cork_ack', C.c_int), ('barrier_ack', C.c_int),
                ('limit_reached', C.c_int), ('error', C.c_char * 128)]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def private_trial(output, tools):
    assert sys.byteorder == 'little', 'This PCM fixture requires a little-endian host'
    assert not any(Path(p).exists() for p in ('/dev/snd', '/dev/input', '/dev/uinput'))
    private = Path('/tmp/voco-pulse-regression')
    private.mkdir(mode=0o700)
    for name in ('home', 'runtime'):
        (private / name).mkdir(mode=0o700)
    socket = private / 'pulse.sock'
    env = {**os.environ, 'HOME': str(private / 'home'),
           'XDG_RUNTIME_DIR': str(private / 'runtime'), 'PULSE_SERVER': 'unix:' + str(socket)}
    for key in ('DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'PULSE_COOKIE'):
        env.pop(key, None)
    report = {'passed': False, 'lifecyclePassed': False, 'waveformPassed': False,
              'physicalDevicesAvailable': False, 'sourceSha256': digest(output / 'source.c'),
              'fixtureSha256': digest(FIXTURE), 'maximumBufferLatencyUs': MAX_BUFFER_LATENCY_US}
    pulse = player = snapshot = None
    handle = None
    raw = bytearray()
    next_sequence = 1
    lib = C.CDLL(str(output / 'bridge.so'))
    lib.vc_new.argtypes, lib.vc_new.restype = [C.c_char_p], C.c_void_p
    for fn in ('vc_free', 'vc_tick', 'vc_stop'):
        getattr(lib, fn).argtypes, getattr(lib, fn).restype = [C.c_void_p], None
    lib.vc_enumerate.argtypes = [C.c_void_p, C.POINTER(Catalog)]
    lib.vc_begin.argtypes = [C.c_void_p, C.POINTER(Source), C.c_uint64]
    lib.vc_get_status.argtypes = [C.c_void_p, C.POINTER(Status)]
    lib.vc_get_status.restype = None
    lib.vc_ack.argtypes = [C.c_void_p, C.c_uint32]
    lib.vc_peek.argtypes = [C.c_void_p, C.c_uint32, C.POINTER(C.c_void_p),
                           C.POINTER(C.c_size_t), C.POINTER(C.c_uint64), C.POINTER(C.c_uint64)]

    def tick():
        nonlocal next_sequence
        lib.vc_tick(handle)
        status = Status()
        lib.vc_get_status(handle, C.byref(status))
        assert not status.error, status.error.decode()
        while True:
            data, size, sequence, start = C.c_void_p(), C.c_size_t(), C.c_uint64(), C.c_uint64()
            if not lib.vc_peek(handle, 0, C.byref(data), C.byref(size), C.byref(sequence), C.byref(start)):
                break
            assert sequence.value == next_sequence, 'Noncontiguous capture block sequence'
            assert start.value == len(raw) // 4, 'Noncontiguous capture frame offset'
            assert 0 < size.value <= 35280 and size.value % 4 == 0
            raw.extend(C.string_at(data, size.value))
            assert lib.vc_ack(handle, 1) == 0
            next_sequence += 1
        return status

    def pump(seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            tick()
            time.sleep(.005)

    try:
        assert report['fixtureSha256'] == FIXTURE_SHA256
        # A fresh virtual source begins clocking on playback. Neutral padding
        # protects reference silence without altering or trimming any reference PCM.
        reference = pcm16(FIXTURE)
        playback = output / 'playback.wav'
        with wave.open(str(playback), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(bytes(8000) + reference.tobytes() + bytes(8000))
        report['playback'] = {'sha256': digest(playback), 'paddingEachSideSamples': 4000,
                              'referenceSamples': len(reference), 'sampleRate': 16000}
        assert report['playback']['sha256'] == PADDED_SHA256
        with (output / 'pulse-stderr.log').open('w') as log:
            pulse = subprocess.Popen([tools['pulseaudio'], '--daemonize=no', '--use-pid-file=no',
                '--exit-idle-time=-1', '--disable-shm=true', '-n',
                '--log-target=file:' + str(output / 'pulse.log'), '-L',
                'module-native-protocol-unix socket=' + str(socket) + ' auth-anonymous=1',
                '-L', 'module-null-sink sink_name=fixture rate=48000', '-L',
                'module-remap-source master=fixture.monitor source_name=voco_fixture source_properties=object.serial=1'],
                env=env, stdout=log, stderr=log)
        deadline = time.monotonic() + 5
        while not socket.exists():
            assert pulse.poll() is None and time.monotonic() < deadline, 'Private Pulse did not start'
            time.sleep(.01)
        handle = lib.vc_new(str(socket).encode())
        assert handle
        catalog = Catalog()
        assert lib.vc_enumerate(handle, C.byref(catalog)) == 0
        assert catalog.count <= 128
        selected = next(s for s in catalog.sources[:catalog.count] if s.name == b'voco_fixture')
        assert lib.vc_begin(handle, C.byref(selected), catalog.revision) == 0
        deadline = time.monotonic() + 5
        while not tick().ready:
            assert time.monotonic() < deadline, 'Capture did not become ready'
            time.sleep(.005)
        pump(.5)
        report['playbackStartMonotonic'] = time.monotonic()
        with (output / 'playback.log').open('w') as log:
            player = subprocess.Popen([tools['paplay'], '--device=fixture', str(playback)], env=env,
                                      stdout=log, stderr=log)
        deadline = time.monotonic() + 5
        while len(raw) < 1764:
            assert time.monotonic() < deadline, 'No capture data arrived during playback'
            pump(.005)
        # Keep pumping while querying the server: the diagnostic must not itself
        # stall the production callback and inflate its buffer measurement.
        snapshot = subprocess.Popen([tools['pactl'], '-f', 'json', 'list', 'source-outputs'],
                                    env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        deadline = time.monotonic() + 5
        while snapshot.poll() is None:
            assert time.monotonic() < deadline, 'Pulse snapshot timed out'
            pump(.005)
        stdout, stderr = snapshot.communicate(timeout=1)
        assert snapshot.returncode == 0, stderr.decode()
        outputs = json.loads(stdout)
        native = [item for item in outputs if item.get('properties', {}).get('application.process.id') == str(os.getpid())]
        assert len(native) == 1 and native[0]['sample_specification'] == 's16le 2ch 44100Hz'
        report['bufferLatencyUs'] = native[0]['buffer_latency_usec']
        report['sourceLatencyUs'] = native[0]['source_latency_usec']
        deadline = time.monotonic() + 8
        while player.poll() is None:
            assert time.monotonic() < deadline, 'Fixture playback timed out'
            pump(.005)
        assert player.returncode == 0
        report['playbackEndMonotonic'] = time.monotonic()
        pump(.6)
        report['stopMonotonic'] = time.monotonic()
        lib.vc_stop(handle)
        deadline = time.monotonic() + 4
        while True:
            status = tick()
            if status.stopped:
                break
            assert time.monotonic() < deadline, 'Capture Stop timed out'
            time.sleep(.005)
        report['stopCompletedMonotonic'] = time.monotonic()
        assert status.cork_ack and status.barrier_ack and not status.limit_reached
        assert status.frames == len(raw) // 4 and status.blocks == next_sequence - 1
        report['receipt'] = {key: getattr(status, key) for key in
                             ('frames', 'blocks', 'stopped', 'cork_ack', 'barrier_ack', 'limit_reached')}
        report['lifecyclePassed'] = True
        stereo = array.array('h', raw)
        mono = [(stereo[i] + stereo[i + 1]) / 2 for i in range(0, len(stereo), 2)]
        resampled = array.array('h')
        for i in range((len(mono) - 1) * 16000 // 44100):
            index, remainder = divmod(i * 44100, 16000)
            resampled.append(round(mono[index] + (mono[index + 1] - mono[index]) * remainder / 16000))
        report['continuity'] = capture_continuity(reference, resampled)
        report['waveformPassed'] = report['continuity']['passed']
        assert report['waveformPassed'], 'Complete reference waveform was not preserved'
        assert 0 <= report['bufferLatencyUs'] <= MAX_BUFFER_LATENCY_US, 'Excessive capture buffering'
        report['passed'] = True
    except Exception as error:
        report['error'] = str(error)
    finally:
        if handle:
            lib.vc_free(handle)
        for process in (snapshot, player, pulse):
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
        (output / 'capture.s16le').write_bytes(raw)
        report['captureSha256'] = hashlib.sha256(raw).hexdigest()
        (output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)
    return 0 if report['passed'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='New evidence directory, never overwritten')
    parser.add_argument('--source', type=Path, default=SOURCE, help='C source override for a negative control')
    parser.add_argument('--inside', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    os.umask(0o077)
    output = args.output.resolve()
    tools = {name: shutil.which(name) for name in ('pulseaudio', 'pactl', 'paplay')}
    assert all(tools.values()), 'Install pulseaudio and pulseaudio-utils for this optional Linux fixture'
    if args.inside:
        return private_trial(output, tools)
    output.mkdir(mode=0o700)
    source = args.source.resolve()
    shutil.copyfile(source, output / 'source.c')
    compiler = shlex.split(os.environ.get('CC', 'cc'))
    flags = shlex.split(subprocess.check_output(['pkg-config', '--cflags', '--libs', 'libpulse'], text=True, timeout=10))
    command = compiler + ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-shared', '-fPIC',
                         '-I' + str(SOURCE.parent), str(output / 'source.c'), '-o', str(output / 'bridge.so')] + flags
    (output / 'build.json').write_text(json.dumps({'argv': command, 'sourceSha256': digest(output / 'source.c'),
        'headerSha256': digest(SOURCE.with_suffix('.h')), 'scriptSha256': digest(Path(__file__)),
        'continuityHelperSha256': digest(ROOT / 'scripts/test_native_wayland_capture.py')}, indent=2) + '\n')
    subprocess.run(command, check=True, timeout=60)
    # Explicit server plus network/PID/device isolation rules out host microphones,
    # host Pulse sockets and uinput. Only the evidence directory is writable.
    result = subprocess.run(['bwrap', '--die-with-parent', '--new-session', '--unshare-ipc',
        '--unshare-net', '--unshare-pid', '--unshare-uts', '--ro-bind', '/', '/',
        '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '--tmpfs', '/run/user',
        '--ro-bind', str(ROOT), str(ROOT), '--bind', str(output), str(output),
        '--', sys.executable, str(Path(__file__).resolve()),
        '--inside', '--output', str(output)], timeout=45)
    return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
