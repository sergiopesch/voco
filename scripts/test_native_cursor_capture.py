"""Real cursor dictation in the private GNOME seat with explicit input adapters."""
import hashlib
import array
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import struct
import time
import wave


def run_cursor(root, app, pump, native_windows, activate):
    import gi
    gi.require_version('Gtk', '3.0')
    gi.require_version('Atspi', '2.0')
    from gi.repository import Gtk, Atspi, Gio, GLib
    from audio_continuity import capture_continuity, pcm16
    # This process also owns the target widget. Service AT-SPI immediately like
    # Gtk.main(), without adding a polling sleep to every accessibility request.
    def pump(seconds=0):
        context = GLib.MainContext.default()
        if seconds <= 0:
            while context.pending():
                context.iteration(False)
            return
        finished = False
        def finish():
            nonlocal finished
            finished = True
            return False
        GLib.timeout_add(max(1, int(seconds * 1000)), finish)
        while not finished:
            context.iteration(True)
    assert os.environ.get('VOCO_GNOME_CURSOR') == '1'
    assert 'DISPLAY' not in os.environ
    assert not any(Path(path).exists() for path in ('/dev/snd', '/dev/input', '/dev/uinput'))
    assert os.environ['PULSE_SERVER'] == f'unix:/run/user/{os.getuid()}/pulse/native'
    assert all(os.environ.get(flag) == '1' for flag in
               ('VOCO_DEV_NATIVE_CAPTURE', 'VOCO_DEBUG_CAPTURE_AUDIO', 'VOCO_DEBUG_NATIVE_CAPTURE'))
    result = {'passed': False, 'scope': 'exact app binary, native capture, pinned recognition, GTK cursor, real GNOME Stop; private input/clipboard adapters',
              'physicalMicrophone': False, 'physicalHotkeyStart': False, 'kernelInputHelperQualified': False,
              'startTransport': 'owner-only control CLI', 'trials': []}
    baseline = os.environ.get('VOCO_CURSOR_BASELINE') == '1'
    result['audioOnlyBaselineComparison'] = baseline
    result['modifierGuardExercised'] = not baseline
    modifier_stress = os.environ.get('VOCO_CURSOR_MODIFIER_STRESS') == '1'
    if modifier_stress:
        assert os.environ.get('VOCO_PERFORMANCE_LOG') == '1', 'Stress qualification requires numeric terminal capture receipts'
    result['streamingModifierStress'] = modifier_stress and not baseline
    if modifier_stress:
        result['scope'] += '; separate non-atomic modifier stress, fail-closed interruption allowed but never replay'
    evidence = root / 'evidence'
    trace = root / 'state/voco/hotkey-trace.jsonl'
    journal = root / 'state/voco/crash-recovery'
    dispatch = evidence / 'cursor-input-dispatch.jsonl'
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    target = None
    daemon = None
    player = None
    monitor = None
    reference_capture = None
    xenv = {**os.environ, 'DISPLAY': ':77'}

    def rows():
        return [json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []

    def quality_terminal(session_id):
        performance = root / 'state/voco/performance/performance.jsonl'
        if not performance.exists():
            return None
        return next((row for row in reversed([json.loads(line) for line in performance.read_text().splitlines()])
                     if row.get('stage') == 'terminal' and row.get('dictation_session_id') == session_id), None)

    def input_state():
        return json.loads(bus.call_sync('org.gnome.Shell', '/org/voco/PrivateShellProbe',
            'org.voco.PrivateShellProbe', 'GetInputState', None, None,
            Gio.DBusCallFlags.NO_AUTO_START, 1500, None).unpack()[0])

    def wait(predicate, description, seconds=30):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            assert app.poll() is None, 'App exited during ' + description
            value = predicate()
            if value:
                return value
            pump(.025)
        raise AssertionError('Timed out: ' + description)

    def keys(*args):
        subprocess.run(['/usr/bin/xdotool', *args], env=xenv, check=True, timeout=5)
        pump(.03)

    def app_button(label):
        desktop = Atspi.get_desktop(0)
        pending = [desktop.get_child_at_index(i) for i in range(desktop.get_child_count())
                   if desktop.get_child_at_index(i).get_process_id() == app.pid]
        seen = 0
        while pending and seen < 500:
            node = pending.pop()
            if node is None:
                continue
            seen += 1
            if node.get_role() == Atspi.Role.PUSH_BUTTON and node.get_name() == label:
                states = node.get_state_set()
                if states.contains(Atspi.StateType.SHOWING):
                    return node
            pending.extend(node.get_child_at_index(i) for i in range(min(node.get_child_count(), 100)))
        return None

    def desktop_input_ready():
        # Read-only prerequisite check: paste helpers and input service only.
        # Dictation pastes into whatever has focus; there is no cursor probe.
        probe = subprocess.Popen([str(root / 'voco'), '--check-desktop-input'],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        wait(lambda: probe.poll() is not None, 'read-only desktop input prerequisite check', 8)
        stdout, stderr = probe.communicate()
        result.setdefault('desktopInputChecks', []).append({'code': probe.returncode, 'stdout': stdout, 'stderr': stderr})
        return probe.returncode == 0

    def screenshot(name):
        code = "import gi;gi.require_version('Gdk','3.0');from gi.repository import Gdk;Gdk.init([]);p=Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(),0,0,1280,900);p.savev(__import__('sys').argv[1],'png',[],[])"
        subprocess.run(['/usr/bin/python3', '-c', code, str(evidence / name)],
                       env={**xenv, 'GDK_BACKEND': 'x11'}, check=True, timeout=10)

    try:
        monitor = subprocess.Popen(['dbus-monitor', '--session', "type='error'"],
            stdout=(evidence / 'cursor-dbus-errors.log').open('w'), stderr=subprocess.DEVNULL)
        daemon = subprocess.Popen(['/usr/bin/ydotool', '--fixture-daemon'])
        wait(lambda: subprocess.run(['pgrep', '-u', str(os.getuid()), '-x', 'ydotoold'],
             capture_output=True).returncode == 0, 'private input adapter daemon')
        # Open and hide through actual app controls, never compositor focus repair.
        activate('Settings')
        node = wait(lambda: app_button('Hide to tray'), 'settings hide control')
        assert node.get_action_iface().do_action(0)
        wait(lambda: not any(w['pid'] == app.pid and w['visible'] for w in native_windows()), 'hidden app')
        Gtk.init([])
        target = Gtk.Window(title='VOCO private cursor delivery fixture')
        target.set_default_size(850, 420)
        field = Gtk.TextView()
        field.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        target.add(field)
        target.show_all()
        field.grab_focus()
        target.present()
        def destination_focused():
            return field.has_focus() and any(w['pid'] == os.getpid() and w['visible'] and w['focused']
                                             for w in native_windows())
        wait(destination_focused, 'focused GTK destination')
        assert desktop_input_ready(), 'Desktop input prerequisites unavailable'
        buffer = field.get_buffer()

        def text():
            return buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), True)

        fixtures = Path(__file__).resolve().parent.parent / 'tests/fixtures/speech'
        manifest = json.loads((fixtures / 'manifest.json').read_text())
        for trial_index, fixture_name in enumerate(('1462-170138-0000.wav', '84-121123-0000.wav')):
            fixture = next(item for item in manifest['fixtures'] if item['file'] == fixture_name)
            sound = fixtures / fixture_name
            assert hashlib.sha256(sound.read_bytes()).hexdigest() == fixture['sha256']
            trial = {'fixture': fixture_name, 'fixtureSha256': fixture['sha256'], 'passed': False}
            result['trials'].append(trial)
            buffer.set_text('')
            field.grab_focus()
            target.present()
            pump(.3)
            wait(destination_focused, 'focused GTK destination', 15)
            previous_active = sum(row.get('event') == 'recording_state_active' for row in rows())
            previous_idle = sum(row.get('event') == 'dictation_stop_to_idle' for row in rows())
            assert not (journal / 'active.json').exists(), 'Previous normal dictation retained its journal'
            start = subprocess.run([str(root / 'voco'), '--toggle'], capture_output=True, text=True, timeout=5)
            assert start.returncode == 0, start.stderr
            wait(lambda: sum(row.get('event') == 'recording_state_active' for row in rows()) > previous_active,
                 'cursor recording active')
            if not baseline:
                wait(lambda: (journal / 'active.json').exists(), 'active crash-only checkpoint')
            trial['pulseSourceOutputsBeforePlayback'] = json.loads(subprocess.check_output(
                [os.environ['VOCO_WAYLAND_PACTL'], '-f', 'json', 'list', 'source-outputs'], text=True))
            reference_capture = subprocess.Popen([os.environ['VOCO_WAYLAND_PAPLAY'], '--record', '--raw',
                '--format=s16le', '--rate=44100', '--channels=2', '--device=voco_fixture',
                str(evidence / f'cursor-independent-capture-{trial_index}.s16le')])
            playback = evidence / f'cursor-input-{trial_index}.wav'
            with wave.open(str(sound), 'rb') as original:
                assert (original.getnchannels(), original.getsampwidth(), original.getframerate()) == (1, 2, 16000)
                pcm = original.readframes(original.getnframes())
            with wave.open(str(playback), 'wb') as padded:
                padded.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                padded.writeframes(bytes(16000) + pcm + bytes(16000))
            player = subprocess.Popen([os.environ['VOCO_WAYLAND_PAPLAY'], '--device=fixture', str(playback)])
            trial['playbackStartMonotonic'] = time.monotonic()
            wait(lambda: len(text().split()) >= (4 if trial_index == 0 else 1), 'first streamed words', 40)
            if trial_index == 0 and not baseline and modifier_stress:
                # In-flight streaming delivery must wait during an ordinary held
                # Alt too, not only after the D shortcut has requested Stop.
                overlaps = []
                for _ in range(3):
                    keys('keydown', 'Alt_L')
                    began = time.monotonic()
                    before = text()
                    pump(.65)
                    overlaps.append({'heldFor': time.monotonic() - began,
                                     'textStable': text() == before, 'input': input_state()})
                    assert not input_state()['windowMenuOpen'], 'Streaming joining Space opened a GNOME window menu'
                    keys('keyup', 'Alt_L')
                    pump(.35)
                trial['heldAltStreaming'] = overlaps
            interruption = None
            def playback_done():
                nonlocal interruption
                failed = any(row.get('event') == 'dictation_desktop_stream_failed'
                             and row.get('dictation_session_id') == trial_index + 1 for row in rows())
                if modifier_stress and failed:
                    current = {'text': text(), 'dispatches': len(dispatch.read_text().splitlines())}
                    if interruption is None:
                        interruption = current
                    else:
                        assert current == interruption, 'Interrupted insertion replayed or changed the original field'
                return player.poll() is not None
            wait(playback_done, 'whole public fixture playback', 40)
            assert player.returncode == 0
            player = None
            trial['playbackEndMonotonic'] = time.monotonic()
            trial['pulseSourceOutputsAfterPlayback'] = json.loads(subprocess.check_output(
                [os.environ['VOCO_WAYLAND_PACTL'], '-f', 'json', 'list', 'source-outputs'], text=True))
            pump(.6)
            # Real compositor-held Stop, not a direct API stop or toggle command.
            if baseline:
                subprocess.run([str(root / 'voco'), '--toggle'], check=True, timeout=5)
            else:
                # The companion consumes the shortcut and toggles on press. A final
                # paste must wait for release; the dispatch log checks modifiers below.
                keys('keydown', 'Alt_L', 'keydown', 'd')
                pump(.45)
                assert not input_state()['windowMenuOpen'], 'Held Stop opened the window menu'
                keys('keyup', 'd', 'keyup', 'Alt_L')
            wait(lambda: (quality_terminal(trial_index + 1) is not None and not (journal / 'active.json').exists())
                 if interruption is not None else
                 sum(row.get('event') == 'dictation_stop_to_idle' for row in rows()) > previous_idle,
                 'Stop flushed and returned idle', 60)
            pump(.3)
            reference_capture.terminate()
            reference_capture.wait(timeout=5)
            reference_capture = None
            trial['text'] = text()
            if interruption is not None:
                assert interruption == {'text': text(), 'dispatches': len(dispatch.read_text().splitlines())}, \
                    'Stop replayed an interrupted insertion'
                terminal = quality_terminal(trial_index + 1)
                assert terminal['finish_responded'] and terminal['captured_samples'] == terminal['responded_samples'] == terminal['enqueued_samples']
                assert terminal['buffered_samples'] == 0 and terminal['pending_delivery_count'] == 0
                sources = json.loads(subprocess.check_output([os.environ['VOCO_WAYLAND_PACTL'], '-f', 'json', 'list', 'source-outputs'], text=True))
                assert not any(source.get('properties', {}).get('application.process.id') == str(app.pid)
                               and source.get('corked') is False for source in sources)
                trial['failClosedInterruption'] = {'stableField': True, 'noReplay': True,
                    'recognitionFinished': True, 'allCapturedSamplesRecognized': True, 'captureStopped': True,
                    'acceptedUnicodeScalars': terminal['accepted_unicode_scalars'],
                    'dispatchedUnicodeScalars': terminal['dispatched_unicode_scalars']}
            trial['reference'] = fixture['reference']
            observed = re.findall('[a-z]+', text().lower())
            expected = re.findall('[a-z]+', fixture['reference'].lower())
            previous = list(range(len(observed) + 1))
            for index, expected_word in enumerate(expected, 1):
                current = [index]
                for j, observed_word in enumerate(observed, 1):
                    current.append(min(current[-1] + 1, previous[j] + 1,
                                       previous[j - 1] + (expected_word != observed_word)))
                previous = current
            trial['wordErrorRate'] = previous[-1] / len(expected)
            assert not (journal / 'active.json').exists(), 'Normal Stop retained active transcript'
            recovered = json.loads((journal / 'recovered.json').read_text()) if (journal / 'recovered.json').exists() else []
            # Review test may have its own distinct fixture entries; normal
            # cursor dictation must not add either recognized phrase to them.
            assert not any(entry.get('text') == text() for entry in recovered)
            assert not any(w['pid'] == app.pid and w['visible'] for w in native_windows()), 'Dictation presented a transcript window'
            assert not input_state()['windowMenuOpen']
            assert any(w['pid'] == os.getpid() and w['focused'] for w in native_windows()), 'Stop moved focus away from the dictated field'
            bundles = root / 'state/voco/debug-native-captures'
            wait(lambda: len(list(bundles.glob('native-*/COMMIT.json'))) == 1
                 and len(list(bundles.glob('renderer-*/COMMIT.json'))) == 1,
                 'complete native and renderer audio audit')
            commits = [json.loads(path.read_text()) for path in bundles.glob('*/COMMIT.json')]
            assert all(commit['complete'] is True for commit in commits)
            trial['completeAuditBundles'] = len(commits)
            trial.update(journalRemoved=True, noTranscriptPopup=True, originalFieldFocused=True)
            trial['nativeWaveformAudited'] = trial_index == 0
            if trial_index == 0:
                native_bundle = next(bundles.glob('native-*/COMMIT.json')).parent
                raw = (native_bundle / 'raw.s16le').read_bytes()
                descriptor = json.loads((native_bundle / 'descriptor.json').read_text())['descriptor']
                assert (descriptor['sampleRate'], descriptor['channels'], descriptor['frameBytes']) == (44100, 2, 4)
                assert hashlib.sha256(raw).hexdigest() == json.loads((native_bundle / 'COMMIT.json').read_text())['files']['raw.s16le']['sha256']
                mono = [(left + right) / 2 for left, right in struct.iter_unpack('<hh', raw)]
                resampled = array.array('h')
                for frame in range(max(0, len(mono) - 1) * 16000 // 44100):
                    position = frame * 44100 / 16000
                    index = int(position)
                    fraction = position - index
                    resampled.append(round(mono[index] * (1 - fraction) + mono[index + 1] * fraction))
                trial['nativeCapturedSeconds'] = len(mono) / 44100
                trial['fullFixtureSeconds'] = len(pcm) / 32000
                if len(resampled) < len(pcm) // 2:
                    trial['captureContinuity'] = {'passed': False, 'reason': 'Captured audio shorter than full fixture'}
                else:
                    trial['captureContinuity'] = capture_continuity(pcm16(sound), resampled)
                assert trial['captureContinuity']['passed'], 'Native capture did not retain the complete input waveform'
            else:
                trial['auditLimit'] = 'Native and renderer debug audits intentionally allow one capture per process'
            screenshot(f'cursor-trial-{trial_index + 1}.png')
            if interruption is None:
                assert trial['wordErrorRate'] <= .25, 'Whole-fixture transcript error exceeded threshold'
            else:
                trial['deliveryQualified'] = False
            trial['passed'] = True
        events = [json.loads(line) for line in dispatch.read_text().splitlines()]
        if not baseline:
            assert any(' ' in event['keys'] for event in events), 'No joining Space dispatch was exercised'
        assert all(not event['input']['windowMenuOpen'] for event in events)
        assert all((event['input']['modifiers'] & (1 | 4 | 8 | 64 | 128)) == 0 for event in events), \
            'A physical modifier reached a streaming paste dispatch'
        result['dispatchCount'] = len(events)
        result['passed'] = True
        return result
    except Exception as error:
        result['failure'] = str(error)
        result['failureWindows'] = native_windows()
        try:
            if (journal / 'active.json').exists():
                subprocess.run([str(root / 'voco'), '--toggle'], capture_output=True, timeout=5)
                wait(lambda: not (journal / 'active.json').exists(), 'diagnostic controlled Stop', 60)
            activate('Settings')
            pump(2)
            desktop = Atspi.get_desktop(0)
            pending = [desktop.get_child_at_index(i) for i in range(desktop.get_child_count())
                       if desktop.get_child_at_index(i).get_process_id() == app.pid]
            result['failureAppText'] = []
            while pending and len(result['failureAppText']) < 500:
                node = pending.pop()
                if node is None:
                    continue
                content = node.get_name()
                try:
                    content = Atspi.Text.get_text(node, 0, -1) or content
                except Exception:
                    pass
                result['failureAppText'].append({'role': node.get_role_name(), 'text': content})
                pending.extend(node.get_child_at_index(i) for i in range(min(node.get_child_count(), 100)))
        except Exception as diagnostic_error:
            result['diagnosticFailure'] = str(diagnostic_error)
        desktop = Atspi.get_desktop(0)
        result['accessibleWindows'] = []
        for i in range(desktop.get_child_count()):
            application = desktop.get_child_at_index(i)
            for j in range(application.get_child_count()):
                window = application.get_child_at_index(j)
                if window is not None:
                    result['accessibleWindows'].append({'pid': application.get_process_id(),
                        'name': window.get_name(), 'active': window.get_state_set().contains(Atspi.StateType.ACTIVE)})
        raise
    finally:
        keys('keyup', 'd', 'keyup', 'Alt_L')
        if player is not None and player.poll() is None:
            player.terminate()
            player.wait(timeout=5)
        if daemon is not None and daemon.poll() is None:
            daemon.terminate()
            daemon.wait(timeout=5)
        if monitor is not None and monitor.poll() is None:
            monitor.terminate()
            monitor.wait(timeout=5)
        if reference_capture is not None and reference_capture.poll() is None:
            reference_capture.terminate()
            reference_capture.wait(timeout=5)
        try:
            screenshot('cursor-final-state.png')
        finally:
            bundles = root / 'state/voco/debug-native-captures'
            if bundles.exists():
                shutil.copytree(bundles, evidence / 'cursor-debug-native-captures', dirs_exist_ok=True)
            performance = root / 'state/voco/performance'
            if performance.exists():
                shutil.copytree(performance, evidence / 'cursor-performance', dirs_exist_ok=True)
            (evidence / 'cursor-capture.json').write_text(json.dumps(result, indent=2) + '\n')
            if target is not None:
                target.destroy()
