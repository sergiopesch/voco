"""Optional real application capture-to-Copy in the private nested Wayland seat."""
if not __debug__:
    raise SystemExit("Wayland qualification requires assertions; unset PYTHONOPTIMIZE and do not use python -O.")

import hashlib
import array
import math
import wave
import json
import os
from pathlib import Path
import re
import socket
import shutil
import subprocess
import time


def pcm16(path):
    with wave.open(str(path), 'rb') as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16000)
        values = array.array('h', wav.readframes(wav.getnframes()))
    return values


def capture_continuity(reference, captured):
    """Locate complete public PCM, then check independent quarters for lost audio."""
    assert len(captured) >= len(reference), 'Captured audio shorter than fixture'
    def correlation(offset, start=0, end=None, stride=16):
        end = len(reference) if end is None else end
        pairs = [(reference[i], captured[offset + i]) for i in range(start, end, stride)]
        energy_a = sum(a * a for a, _ in pairs)
        energy_b = sum(b * b for _, b in pairs)
        if not energy_a or not energy_b:
            return 0.0
        return sum(a * b for a, b in pairs) / math.sqrt(energy_a * energy_b)
    last = len(captured) - len(reference)
    # A coarse energy envelope tolerates sample phase; one refined global
    # waveform alignment is then shared by every quarter (no local realignment).
    reference_energy = [sum(v * v for v in reference[i:i + 64]) for i in range(0, len(reference) - 63, 64)]
    captured_energy = [sum(v * v for v in captured[i:i + 64]) for i in range(0, len(captured) - 63, 64)]
    def envelope(offset):
        values = captured_energy[offset:offset + len(reference_energy)]
        norm = math.sqrt(sum(v * v for v in reference_energy) * sum(v * v for v in values))
        return sum(a * b for a, b in zip(reference_energy, values)) / norm if norm else 0.0
    coarse = max(range(last // 64 + 1), key=envelope) * 64
    offset = max(range(max(0, coarse - 128), min(last, coarse + 128) + 1), key=correlation)
    quarters = [correlation(offset, len(reference) * i // 4, len(reference) * (i + 1) // 4, 4) for i in range(4)]
    quarter_rms = [math.sqrt(sum(v * v for v in reference[len(reference) * i // 4:len(reference) * (i + 1) // 4]) / (len(reference) * (i + 1) // 4 - len(reference) * i // 4)) / 32768 for i in range(4)]
    active = [i for i, rms in enumerate(quarter_rms) if rms >= .005]
    assert active, 'Fixture has no speech-energy quarters'
    result = {'referenceSamples': len(reference), 'capturedSamples': len(captured),
              'offsetSamples': offset, 'quarterCorrelations': quarters,
              'minimumQuarterCorrelation': 0.90, 'quarterReferenceRms': quarter_rms,
              'scoredQuarters': active, 'minimumReferenceRms': .005, 'wholeFixtureCorrelation': correlation(offset, stride=4),
              'referenceDurationSeconds': len(reference) / 16000, 'capturedDurationSeconds': len(captured) / 16000}
    result['passed'] = min(quarters[i] for i in active) >= .90 and result['wholeFixtureCorrelation'] >= .90
    return result


def painted_copy_metrics(pixels, width, height, rowstride, channels, frame, button, ghost=False):
    """Verify the known dark VOCO panel and light Copy control at native bounds."""
    fx, fy, fw, fh = frame
    bx, by, bw, bh = button
    if not (fx >= 0 and fy >= 0 and fw > 0 and fh > 0 and fx + fw <= width and fy + fh <= height
            and bx >= 0 and by >= 0 and bw > 0 and bh > 0 and bx + bw <= fw and by + bh <= fh):
        return {'passed': False, 'reason': 'native geometry unavailable or outside screenshot'}
    def colors(x, y, w, h, step):
        for yy in range(y, y + h, step):
            for xx in range(x, x + w, step):
                offset = yy * rowstride + xx * channels
                yield tuple(pixels[offset:offset + 3])
    panel = list(colors(fx, fy, fw, fh, 4))
    control = list(colors(fx + bx, fy + by, bw, bh, 1))
    dark_panel = sum(8 <= min(c) and max(c) <= 65 and max(c) - min(c) <= 25 for c in panel) / len(panel)
    light_button = sum(min(c) >= 110 and max(c) - min(c) <= 50 for c in control) / len(control)
    # CSS uses 18px horizontal padding and a pill radius; the middle half
    # of its height plus that inset excludes rounded corners and borders.
    if bw <= 36 or bh < 24:
        return {'passed': False, 'reason': 'Copy content rectangle too small'}
    glyph_rect = [fx + bx + 18, fy + by + bh // 4, bw - 36, bh - 2 * (bh // 4)]
    content = list(colors(*glyph_rect, 1))
    dark_glyph = sum(max(c) < 80 for c in content) / len(content)
    light_glyph = sum(min(c) >= 110 and max(c) - min(c) <= 50 for c in content) / len(content)
    return {'passed': dark_panel >= .50 and ((light_button < .40 and light_glyph >= .015) if ghost else (light_button >= .50 and dark_glyph >= .015)),
            'ghostControl': ghost, 'lightGlyphFraction': light_glyph,
            'darkPanelFraction': dark_panel, 'lightButtonFraction': light_button,
            'darkGlyphFraction': dark_glyph, 'glyphContentBounds': glyph_rect, 'frame': frame, 'button': button,
            'thresholds': ({'minimumDarkPanel': .50, 'maximumExclusiveLightButton': .40, 'minimumLightGlyph': .015} if ghost else {'minimumDarkPanel': .50, 'minimumLightButton': .50, 'minimumDarkGlyph': .015})}


def run_capture(root, app, pump, activate, geometry_provider=None, control_revealer=None):
    import gi
    gi.require_version('Gtk', '3.0')
    gi.require_version('Atspi', '2.0')
    from gi.repository import Gtk, Gdk, Atspi
    Gtk.init([])

    assert 'DISPLAY' not in os.environ
    assert os.environ['PULSE_SERVER'] == 'unix:' + str(root / 'runtime/pulse.sock')
    assert not Path('/dev/snd').exists() and not Path('/dev/input').exists()
    assert Gdk.Display.get_default().__gtype__.name == 'GdkWaylandDisplay'
    remap_capture = os.environ.get('VOCO_WAYLAND_SURFACE_JOURNEY') == '1'
    if remap_capture:
        assert os.environ.get('VOCO_DEBUG_CAPTURE_AUDIO') == '1', 'Remap continuity requires isolated synthetic debug WAV'
    trace = root / 'state/voco/hotkey-trace.jsonl'
    target = Gtk.Window(title='VOCO private Wayland unchanged target')
    field = Gtk.Entry()
    target.add(field)
    changes = []
    field.connect('changed', lambda entry: changes.append(entry.get_text()))
    target.show_all()
    field.grab_focus()
    result = {'passed': False, 'boundary': 'nested Wayland / synthetic PulseAudio / real WebKit capture / native IPC / pinned model / explicit Copy',
              'physicalMicrophone': False, 'shortcutTested': False, 'targetMutations': changes,
              'scenario': 'idle-remap-then-capture-open-refused' if remap_capture else 'capture-copy', 'surfaceObservations': []}

    def event_rows():
        rows = []
        if trace.exists():
            for line in trace.read_text().splitlines():
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return rows

    def events():
        return {row.get('event') for row in event_rows()}

    def wait(predicate, description, seconds=20):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if predicate():
                return
            assert app.poll() is None, 'Application exited during ' + description
            pump(.05)
        raise AssertionError('Timed out: ' + description)

    def toggle():
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(2)
            client.connect(str(root / 'runtime/voco.sock'))

    clipboard_owners = []

    def seed_clipboard(label):
        sentinel = 'VOCO private Copy precondition: ' + label
        owner = subprocess.Popen(['wl-copy', '--foreground'], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        clipboard_owners.append(owner)
        owner.stdin.write(sentinel)
        owner.stdin.close()
        def verified():
            read = subprocess.run(['wl-paste', '--no-newline'], text=True, capture_output=True, timeout=3)
            return read.returncode == 0 and read.stdout == sentinel
        wait(verified, 'distinct private clipboard sentinel ' + label)
        result.setdefault('clipboardPreconditions', []).append({'stage': label, 'verified': True, 'sentinel': sentinel})

    def screenshot(name, geometry=None):
        # Only the private nested compositor's Xvfb output is inspected.
        code = "import gi;gi.require_version('Gdk','3.0');from gi.repository import Gdk;Gdk.init([]);p=Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(),0,0,1280,900);p.savev(__import__('sys').argv[1],'png',[],[])"
        if geometry is not None:
            code += ";import json;sys=__import__('sys');sys.path.insert(0,sys.argv[2]);from test_native_wayland_capture import painted_copy_metrics;g=json.loads(sys.argv[3]);print(json.dumps(painted_copy_metrics(p.get_pixels(),p.get_width(),p.get_height(),p.get_rowstride(),p.get_n_channels(),g['frame'],g['button'],g.get('ghost',False))))"
        execution = subprocess.run(['/usr/bin/python3', '-c', code, str(root / ('evidence/' + name)), str(Path(__file__).parent), json.dumps(geometry)], text=True, capture_output=True, env={**os.environ, 'GDK_BACKEND': 'x11', 'DISPLAY': ':77'}, timeout=10, check=True)
        return json.loads(execution.stdout) if geometry is not None else None

    def painted_copy(stage, wanted='Copy transcript'):
        attempts = result.setdefault('paintChecks', {}).setdefault(stage, [])
        verified_button = None
        def painted():
            nonlocal verified_button
            candidate = copy_button(wanted)
            if candidate is None or result.get('appFrameBounds') is None:
                return False
            reported_frame = list(result['appFrameBounds'])
            # GTK Wayland reports (0,0) even for the centered surface. This
            # fixture explicitly uses one 1280x900 Weston kiosk output, not a
            # general Wayland screen-origin claim. Require the normal panel size.
            native_observation = geometry_provider(app.pid) if geometry_provider else None
            if geometry_provider:
                if (native_observation is None or not native_observation['visible']
                        or not native_observation['focused']
                        or native_observation['frame'][2:] != reported_frame[2:]):
                    return False
                frame = native_observation['frame']
            else:
                if reported_frame[2:] != [420, 660]:
                    return False
                frame = [430, 120, 420, 660]
            geometry = {'frame': frame, 'button': list(result['copyEligibility']['bounds']), 'ghost': wanted == 'Settings'}
            before = dict(result['copyEligibility'])
            observation = screenshot(stage + '-' + str(len(attempts)) + '.png', geometry)
            after = copy_button(wanted)
            observation['accessibilityStable'] = after is not None and before == result['copyEligibility'] and reported_frame == result.get('appFrameBounds')
            observation['accessibility'] = before
            observation['reportedFrameBounds'] = reported_frame
            observation['positionBasis'] = native_observation.get('positionBasis', 'private GNOME MetaWindow + private Xvfb parent geometry') if geometry_provider else 'configured1280x900-Weston-kiosk-centered420x660; Wayland origin unavailable'
            if geometry_provider:
                observation['nativeWindow'] = native_observation
                observation['accessibilityStable'] = observation['accessibilityStable'] and geometry_provider(app.pid) == native_observation
            attempts.append(observation)
            if observation['passed'] and observation['accessibilityStable']:
                verified_button = after
                return True
            return False
        wait(painted, 'painted visible Copy ' + stage)
        return verified_button

    def copy_button(wanted='Copy transcript'):
        desktop = Atspi.get_desktop(0)
        # WebKit accessibility descendants belong to its separate web process.
        # Scope by the application root, then traverse that root's complete tree.
        pending = [desktop.get_child_at_index(i) for i in range(desktop.get_child_count())
                   if desktop.get_child_at_index(i).get_process_id() == app.pid]
        found = None
        result['appFrameBounds'] = None
        texts = []
        buttons = []
        observations = []
        for _ in range(500):
            if not pending:
                break
            node = pending.pop()
            try:
                observations.append({"pid": node.get_process_id(), "name": node.get_name(), "role": node.get_role_name()})
                if node.get_role() in (Atspi.Role.FRAME, Atspi.Role.WINDOW):
                    native_bounds = node.get_component_iface().get_extents(Atspi.CoordType.SCREEN)
                    if native_bounds.width > 4 and native_bounds.height > 4:
                        result['appFrameBounds'] = [native_bounds.x, native_bounds.y, native_bounds.width, native_bounds.height]
                name = node.get_name() or ''
                texts.append(name)
                if any(interface.endswith('Text') for interface in node.get_interfaces()):
                    texts.append(Atspi.Text.get_text(node, 0, min(1000, Atspi.Text.get_character_count(node))))
                if node.get_role() == Atspi.Role.PUSH_BUTTON:
                    buttons.append(name)
                    if name == wanted:
                        states = node.get_state_set()
                        bounds = node.get_component_iface().get_extents(Atspi.CoordType.WINDOW)
                        result['copyEligibility'] = {'enabled': states.contains(Atspi.StateType.ENABLED), 'showing': states.contains(Atspi.StateType.SHOWING), 'visible': states.contains(Atspi.StateType.VISIBLE), 'bounds': [bounds.x, bounds.y, bounds.width, bounds.height]}
                        if states.contains(Atspi.StateType.ENABLED) and states.contains(Atspi.StateType.SHOWING) and states.contains(Atspi.StateType.VISIBLE) and bounds.width > 0 and bounds.height > 0:
                            found = node
                pending.extend(node.get_child_at_index(i) for i in range(min(node.get_child_count(), 100)))
            except Exception:
                continue
        (root / 'evidence/wayland-accessibility-diagnostic.json').write_text(json.dumps({'appPid': app.pid, 'nodes': observations}, indent=2))
        result['manualControls'] = {'normalReady': any('Transcript ready to copy' in text for text in texts),
                                    'clearAvailable': 'Clear transcript' in buttons,
                                    'failureActions': [b for b in buttons if b in ('Discard recovery', 'Retry transcription')]}
        if found is not None:
            bounds = result['copyEligibility']['bounds']
            frame = result.get('appFrameBounds')
            if frame is None or bounds[0] < 0 or bounds[1] < 0 or bounds[0] + bounds[2] > frame[2] or bounds[1] + bounds[3] > frame[3]:
                return None
        return found

    try:
        pump(2)
        if remap_capture:
            if os.environ.get('VOCO_WAYLAND_DISMISS_TARGET') == '1':
                target.hide()
                result['targetExplicitlyDismissedBeforeIdleRemap'] = True
                pump(.5)
            activate('Open VOCO')
            wait(lambda: copy_button('Settings') is not None, 'visible idle popover remap before recording')
            result['surfaceObservations'].append({'stage': 'idle-remap-before-recording', 'control': dict(result['copyEligibility'])})
            hide = copy_button('Hide to tray')
            assert hide is not None and hide.get_action_iface().do_action(0), 'Visible Hide to tray action failed'
            wait(lambda: copy_button('Settings') is None, 'idle panel hidden before recording')
            assert 'recording_state_active' not in events(), 'Hide to tray unexpectedly started recording'
            result['idlePanelExplicitlyHiddenBeforeRecording'] = True
        toggle()
        wait(lambda: 'recording_state_active' in events(), 'real WebKit capture')
        source_outputs = subprocess.check_output([os.environ['VOCO_WAYLAND_PACTL'], 'list', 'source-outputs'], text=True, timeout=5)
        (root / 'evidence/pulse-source-outputs.txt').write_text(source_outputs)
        sound = Path(__file__).resolve().parent.parent / 'tests/fixtures/speech/84-121123-0000.wav'
        result['fixtureSha256'] = hashlib.sha256(sound.read_bytes()).hexdigest()
        manifest = json.loads(sound.with_name('manifest.json').read_text())
        fixture = next(item for item in manifest['fixtures'] if item['file'] == sound.name)
        assert result['fixtureSha256'] == fixture['sha256'], 'Synthetic fixture hash mismatch'
        pump(.5)
        player = subprocess.Popen([os.environ['VOCO_WAYLAND_PAPLAY'], '--device=fixture', str(sound)])
        try:
            if remap_capture:
                pump(.7)
                assert player.poll() is None, 'Fixture ended before mid-recording Open'
                result['midCaptureOpenElapsedSeconds'] = .7
                activate('Open VOCO')
                pump(.2)
                assert copy_button('Settings') is None, 'Open exposed popover during recording despite product guard'
                result['openDuringRecordingRefused'] = True
                assert 'dictation_recording_stopped' not in events(), 'Opening popover stopped capture'
            wait(lambda: player.poll() is not None, 'synthetic playback')
            assert player.returncode == 0
        finally:
            if player.poll() is None:
                player.terminate()
            player.wait(timeout=5)
        pump(.6)
        stopped = time.monotonic()
        toggle()
        wait(lambda: 'dictation_stop_to_idle' in events(), 'transcription completion', 60)
        result['stopToIdleSeconds'] = time.monotonic() - stopped
        result['captureTrace'] = [row for row in event_rows() if row.get('event') in ('dictation_recording_stopped', 'dictation_audio_teardown_completed', 'dictation_audio_prepared')]
        if remap_capture:
            captures = list((root / 'state/voco/debug-captures').glob('*.wav'))
            assert len(captures) == 1, 'Expected exactly one synthetic capture WAV'
            shutil.copyfile(captures[0], root / 'evidence/synthetic-capture.wav')
            result['captureContinuity'] = capture_continuity(pcm16(sound), pcm16(captures[0]))
            result['captureContinuity']['capturedSha256'] = hashlib.sha256(captures[0].read_bytes()).hexdigest()
            assert result['captureContinuity']['passed'], 'Synthetic capture waveform continuity failed'
        assert events().intersection({'dictation_transcription_completed', 'dictation_canonical_final_completed'})
        assert 'dictation_recovery_retained' not in events(), 'Expected normal manual result, received failure recovery'
        assert not changes and field.get_text() == '', 'Target changed before explicit Copy'
        if os.environ.get('VOCO_WAYLAND_DISMISS_TARGET') == '1':
            # Separate scenario: user dismisses the fixture. This is not proof
            # that D-Bus tray activation raises VOCO over a foreground window.
            target.hide()
            result['targetExplicitlyDismissed'] = True
            pump(.5)
        seed_clipboard('initial-copy')
        activate('Open VOCO')
        button = None
        def ready():
            nonlocal button
            button = copy_button()
            return button is not None and result['manualControls']['normalReady'] and result['manualControls']['clearAvailable']
        wait(ready, 'visible normal Copy controls')
        assert not result['manualControls']['failureActions']
        result['surfaceObservations'].append({'stage': 'normal-copy', 'control': dict(result['copyEligibility'])})
        button = painted_copy('nested-before-copy')
        action = button.get_action_iface()
        assert action is not None and action.get_n_actions() > 0
        assert action.do_action(0), 'Actual accessibility Copy action was rejected'
        copied = ''
        def clipboard_matches():
            nonlocal copied
            read = subprocess.run(['wl-paste', '--no-newline'], text=True, capture_output=True, timeout=3)
            copied = read.stdout if read.returncode == 0 else ''
            return re.findall('[a-z]+', copied.lower()) == ['go', 'do', 'you', 'hear']
        wait(clipboard_matches, 'private Wayland clipboard transcript')
        assert not changes and field.get_text() == '', 'Explicit Copy mutated target'
        if remap_capture:
            # Exercise settings through a visible control, then the ordinary tray
            # route back to the retained transcript. Do not mutate renderer state.
            activate('Open VOCO')
            if control_revealer is not None:
                control_revealer(app.pid, 'Settings')
            wait(lambda: copy_button('Settings') is not None, 'visible Settings after clipboard readback and Open')
            settings = painted_copy('nested-before-settings', 'Settings') if geometry_provider else copy_button('Settings')
            assert settings is not None and settings.get_action_iface().do_action(0)
            wait(lambda: copy_button('General') is not None, 'visible settings after remap')
            result['surfaceObservations'].append({'stage': 'settings', 'control': dict(result['copyEligibility'])})
            activate('Open VOCO')
            wait(ready, 'Copy after settings-to-popover transition')
            result['surfaceObservations'].append({'stage': 'reopened-copy', 'control': dict(result['copyEligibility'])})
            # A newly mapped native target receives a real compositor focus
            # transition. Require focus acquisition before judging app blur.
            focus_probe = Gtk.Window(title='VOCO private deliberate focus change')
            focus_probe.add(Gtk.Entry())
            try:
                focus_probe.show_all()
                wait(focus_probe.is_active, 'private target acquired compositor focus')
                wait(lambda: copy_button() is None, 'popover dismisses on real blur')
                result['blurDismissed'] = True
                focus_probe.destroy()
                seed_clipboard('blur-reopened-copy')
                activate('Open VOCO')
                wait(ready, 'visible Copy after real blur and reopen')
                button = painted_copy('nested-before-reopened-copy')
                assert button.get_action_iface().do_action(0)
                wait(clipboard_matches, 'clipboard after blur/reopen')
                result['surfaceObservations'].append({'stage': 'blur-reopened-copy', 'control': dict(result['copyEligibility'])})
            finally:
                focus_probe.destroy()
        result.update(passed=True, copiedText=copied, crossProcessClipboardVerified=True)
        return result
    finally:
        # Retain raw evidence even when acceptance fails before transcription or
        # the normal capture-copy branch. The enclosing sandbox is disposable.
        result['evidenceRetentionErrors'] = []
        for source, destination in [(trace, root / 'evidence/hotkey-trace.jsonl'),
                                    (root / 'state/voco/debug-captures', root / 'evidence/debug-captures')]:
            try:
                if source.is_dir():
                    shutil.copytree(source, destination, dirs_exist_ok=True)
                elif source.is_file():
                    shutil.copyfile(source, destination)
            except OSError as error:
                result['evidenceRetentionErrors'].append(str(error))
        for owner in clipboard_owners:
            if owner.poll() is None:
                owner.terminate()
            owner.wait(timeout=5)
        try:
            screenshot('nested-capture.png')
        finally:
            (root / 'evidence/capture-copy.json').write_text(json.dumps(result, indent=2) + '\n')
            target.destroy()
