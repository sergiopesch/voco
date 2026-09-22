"""Actual onboarding capture on the disposable GNOME Wayland seat."""
import hashlib
import array
import struct
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import wave


def run_onboarding(root, app, pump, native_windows):
    from gi.repository import Atspi
    from test_native_wayland_capture import capture_continuity, pcm16

    assert __debug__ and 'DISPLAY' not in os.environ
    assert os.environ['PULSE_SERVER'] == f'unix:/run/user/{os.getuid()}/pulse/native'
    assert not any(Path(p).exists() for p in ('/dev/snd', '/dev/input', '/dev/uinput'))
    assert all(os.environ.get(flag) == '1' for flag in ('VOCO_DEV_NATIVE_CAPTURE', 'VOCO_DEBUG_CAPTURE_AUDIO', 'VOCO_DEBUG_NATIVE_CAPTURE'))
    result = {'passed': False, 'scope': 'actual onboarding controls / Wayland application audio / private synthetic PulseAudio / pinned model',
              'physicalMicrophone': False, 'desktopDeliveryQualified': False, 'onboardingCompletionRequested': False}
    trace = root / 'state/voco/hotkey-trace.jsonl'
    evidence = root / 'evidence'
    player = None
    owner = None

    def rows():
        return [json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []

    def wait(predicate, description, seconds=20):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            assert app.poll() is None, 'App exited during ' + description
            value = predicate()
            if value:
                return value
            pump(.05)
        raise AssertionError('Timed out: ' + description)

    def nodes():
        desktop = Atspi.get_desktop(0)
        pending = []
        for i in range(desktop.get_child_count()):
            node = desktop.get_child_at_index(i)
            if node is not None and node.get_process_id() == app.pid:
                pending.append(node)
        result_nodes = []
        while pending and len(result_nodes) < 500:
            node = pending.pop()
            if node is None:
                continue
            result_nodes.append(node)
            pending.extend(node.get_child_at_index(i) for i in range(min(node.get_child_count(), 100)))
        return result_nodes

    def button(label):
        for node in nodes():
            if node.get_role() == Atspi.Role.PUSH_BUTTON and node.get_name() == label:
                states = node.get_state_set()
                if all(states.contains(state) for state in (Atspi.StateType.SHOWING, Atspi.StateType.VISIBLE, Atspi.StateType.ENABLED)):
                    return node
        return None

    def press(label):
        node = wait(lambda: button(label), 'visible enabled ' + label)
        rect = node.get_extents(Atspi.CoordType.WINDOW)
        windows = [window for window in native_windows() if window['pid'] == app.pid and window['visible'] and window['focused']]
        assert len(windows) == 1, 'Onboarding app must own native focus'
        frame = windows[0]['frame']
        assert rect.width > 0 and rect.height > 0 and rect.x >= 0 and rect.y >= 0
        assert rect.x + rect.width <= frame[2] and rect.y + rect.height <= frame[3], 'Control outside native app frame'
        result.setdefault('nativeActionWindows', []).append(windows[0])
        result.setdefault('actions', []).append({'label': label, 'bounds': [rect.x, rect.y, rect.width, rect.height], 'method': 'actual AT-SPI action'})
        action = node.get_action_iface()
        assert action is not None and action.get_n_actions() > 0 and action.do_action(0)

    def screenshot(name):
        code = "import gi;gi.require_version('Gdk','3.0');from gi.repository import Gdk;Gdk.init([]);p=Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(),0,0,1280,900);p.savev(__import__('sys').argv[1],'png',[],[])"
        subprocess.run(['/usr/bin/python3', '-c', code, str(evidence / name)], env={**os.environ, 'DISPLAY': ':77', 'GDK_BACKEND': 'x11'}, check=True, timeout=10)

    try:
        sentinel = 'VOCO private onboarding clipboard must remain unchanged'
        owner = subprocess.Popen(['wl-copy', '--foreground'], stdin=subprocess.PIPE, text=True)
        owner.stdin.write(sentinel)
        owner.stdin.close()
        def clipboard():
            read = subprocess.run(['wl-paste', '--no-newline'], text=True, capture_output=True, timeout=5)
            return read.stdout if read.returncode == 0 else None
        wait(lambda: clipboard() == sentinel, 'private clipboard sentinel owner')
        def sources():
            return json.loads(subprocess.check_output([os.environ['VOCO_WAYLAND_PACTL'], '-f', 'json', 'list', 'source-outputs'], text=True, timeout=5))
        baseline_sources = sources()
        result['baselinePulseSources'] = baseline_sources
        baseline_ids = {source['index'] for source in baseline_sources}
        press('Start test')
        wait(lambda: any(r.get('event') == 'recording_state_active' for r in rows()), 'native onboarding capture')
        active_sources = wait(lambda: [source for source in sources() if source['index'] not in baseline_ids and source.get('corked') is False], 'uncorked private audio source')
        assert len(active_sources) == 1 and active_sources[0]['properties'].get('application.process.id') == str(app.pid), 'Unexpected capture process'
        assert active_sources[0]['properties'].get('application.name') == 'VOCO native capture development'
        result['captureBackend'] = 'native-pulse'
        result['activePulseSources'] = active_sources
        (evidence / 'onboarding-pulse-source-outputs.json').write_text(json.dumps(active_sources, indent=2) + '\n')
        sound = Path(__file__).resolve().parent.parent / 'tests/fixtures/speech/84-121123-0000.wav'
        expected = next(item['sha256'] for item in json.loads(sound.with_name('manifest.json').read_text())['fixtures'] if item['file'] == sound.name)
        assert hashlib.sha256(sound.read_bytes()).hexdigest() == expected
        result['fixtureSha256'] = expected
        # A new null sink has no prior microphone clock. Explicit silence starts
        # that clock before the unmodified public speech; score the original WAV.
        playback = evidence / 'onboarding-input.wav'
        with wave.open(str(sound), 'rb') as reference:
            assert (reference.getnchannels(), reference.getsampwidth(), reference.getframerate()) == (1, 2, 16000)
            original_pcm = reference.readframes(reference.getnframes())
        with wave.open(str(playback), 'wb') as padded:
            padded.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            padded.writeframes(bytes(8000) + original_pcm + bytes(8000))
        result['playbackInput'] = {'sha256': hashlib.sha256(playback.read_bytes()).hexdigest(), 'paddingEachSideSamples': 4000, 'originalFrames': len(original_pcm) // 2, 'sampleRate': 16000, 'fullReferenceGateUnchanged': True}
        assert result['playbackInput']['sha256'] == '7baaad00667657bec419c66adf30f62d0658e795239308172215c121efc8101b'
        pump(.5)
        result['playbackStartMonotonic'] = time.monotonic()
        player = subprocess.Popen([os.environ['VOCO_WAYLAND_PAPLAY'], '--device=fixture', str(playback)])
        wait(lambda: player.poll() is not None, 'public fixture playback')
        assert player.returncode == 0
        result['playbackEndMonotonic'] = time.monotonic()
        pump(.6)
        screenshot('onboarding-before-finish.png')
        stopped = time.monotonic()
        press('Finish test')
        wait(lambda: any(r.get('event') == 'dictation_stop_to_idle' for r in rows()), 'onboarding Stop flush', 60)
        result['stopToIdleSeconds'] = time.monotonic() - stopped
        wait(lambda: not [source for source in sources() if source['index'] not in baseline_ids and source.get('corked') is False], 'private app audio source stopped after Stop')
        result['finalPulseSources'] = sources()
        result['appPulseSourceStopped'] = True
        wait(lambda: button('Check desktop setup') is not None, 'successful voice test before desktop setup')
        bundles = root / 'state/voco/debug-native-captures'
        committed = wait(lambda: list(bundles.glob('native-*/COMMIT.json')), 'complete native audio audit')
        assert len(committed) == 1
        commit = json.loads(committed[0].read_text())
        assert commit['complete'] is True
        raw = committed[0].with_name('raw.s16le').read_bytes()
        assert hashlib.sha256(raw).hexdigest() == commit['files']['raw.s16le']['sha256']
        descriptor = json.loads(committed[0].with_name('descriptor.json').read_text())
        assert descriptor['guiPid'] == app.pid and commit['metadata']['guiPid'] == app.pid
        capture_format = descriptor['descriptor']
        assert (capture_format['format'], capture_format['sampleRate'], capture_format['channels'], capture_format['frameBytes']) == ('s16le', 44100, 2, 4)
        assert capture_format['channelMap'] == ['front-left', 'front-right']
        for key in ('captureId', 'sessionId', 'generation'):
            assert commit['metadata'][key] == capture_format[key]
        renderer_commits = wait(lambda: list(bundles.glob('renderer-*/COMMIT.json')), 'complete retained audio audit')
        assert len(renderer_commits) == 1
        renderer_commit = json.loads(renderer_commits[0].read_text())
        assert renderer_commit['complete'] is True and renderer_commit['metadata']['guiPid'] == app.pid
        assert renderer_commit['metadata']['identity'] == {key: capture_format[key] for key in ('captureId', 'sessionId', 'generation')}
        retained = renderer_commits[0].with_name('source.f32le').read_bytes()
        assert len(retained) == len(raw) and hashlib.sha256(retained).hexdigest() == renderer_commit['files']['source.f32le']['sha256']
        assert retained == b''.join(struct.pack('<f', (left + right) / 65536) for left, right in struct.iter_unpack('<hh', raw)), 'Renderer retained source differs from native samples'
        result['nativeCommit'] = commit
        result['rendererCommit'] = renderer_commit
        mono = [(left + right) / 2 for left, right in struct.iter_unpack('<hh', raw)]
        # Linear interpolation is only for the independent waveform comparison.
        # The production renderer's own conversion is verified separately above.
        resampled = array.array('h')
        for frame in range(max(0, len(mono) - 1) * 16000 // 44100):
            offset, remainder = divmod(frame * 44100, 16000)
            resampled.append(round(mono[offset] + (mono[offset + 1] - mono[offset]) * remainder / 16000))
        try:
            result['captureContinuity'] = capture_continuity(pcm16(sound), resampled)
        except AssertionError as error:
            result['captureContinuity'] = {'passed': False, 'error': str(error), 'nativeFrames': len(raw) // 4, 'nativeSampleRate': 44100, 'referenceSamples': len(pcm16(sound))}
        text = []
        for node in nodes():
            text.append(node.get_name() or '')
            if any(interface.endswith('Text') for interface in node.get_interfaces()):
                text.append(Atspi.Text.get_text(node, 0, min(1000, Atspi.Text.get_character_count(node))))
        result['accessibleText'] = text
        result['transcriptObserved'] = any(re.findall('[a-z]+', value.lower()) == ['go', 'do', 'you', 'hear'] for value in text)
        assert clipboard() == sentinel, 'Onboarding changed clipboard'
        result['clipboardUnchanged'] = True
        result['captureTrace'] = [row for row in rows() if row.get('event') in ('dictation_audio_prepared', 'dictation_recording_stopped', 'dictation_audio_teardown_completed', 'dictation_stop_to_idle')]
        lifecycle = ['recording_state_active', 'dictation_recording_stopped', 'dictation_audio_teardown_completed', 'dictation_stop_to_idle']
        ordered = [row for row in rows() if row.get('event') in lifecycle]
        assert [row['event'] for row in ordered] == lifecycle, 'One ordered Start/Stop/teardown/idle lifecycle required'
        session_ids = {row.get('dictation_session_id') for row in ordered}
        assert session_ids == {capture_format['sessionId']} and capture_format['sessionId'] > 0, 'Trace and audio lifecycle must belong to the same session'
        result['orderedCaptureLifecycle'] = ordered
        assert not any(row.get('event', '').startswith('dictation_desktop_paste') for row in rows())
        assert json.loads((root / 'config/voco/config.json').read_text())['onboardingCompleted'] is False
        screenshot('onboarding-voice-test-complete.png')
        assert result['captureContinuity']['passed'], 'Synthetic capture waveform continuity failed'
        assert result['transcriptObserved'], text
        result['passed'] = True
        return result
    except Exception as error:
        result['failure'] = str(error)
        raise
    finally:
        bundles = root / 'state/voco/debug-native-captures'
        if bundles.exists():
            deadline = time.monotonic() + 5
            while len(list(bundles.glob('*/COMMIT.json'))) < 2 and time.monotonic() < deadline:
                pump(.05)
            shutil.copytree(bundles, evidence / 'debug-native-captures', dirs_exist_ok=True)
        if player is not None and player.poll() is None:
            player.terminate()
            player.wait(timeout=5)
        if owner is not None and owner.poll() is None:
            owner.terminate()
            owner.wait(timeout=5)
        try:
            screenshot('onboarding-final-state.png')
        finally:
            (evidence / 'onboarding-capture.json').write_text(json.dumps(result, indent=2) + '\n')
