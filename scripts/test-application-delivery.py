"""VOCO's paste into real Linux applications on the private desktop.

Every case pastes with the one production chord through fixtures/focused-paste.py
and reads the result back from the application itself. On gnome-wayland the
applications are clients of a nested GNOME Shell, whose private probe reports
their windows. Never run this on the owner desktop.
"""
import contextlib
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import sys
import time

root = Path(sys.argv[1]); home = root/'home'; out = root/'evidence'
platform = os.environ['VOCO_DELIVERY_PLATFORM']; wayland = platform == 'gnome-wayland'
# Test keys and screenshots use the private Xvfb, which has no authority file.
keyboard = {name: value for name, value in os.environ.items() if name != 'XAUTHORITY'}
keyboard['DISPLAY'] = os.environ['VOCO_DELIVERY_KEYBOARD_DISPLAY']
assert keyboard['DISPLAY'] == ':0' and os.environ['HOME'] == str(home)
if wayland:
    assert os.environ['WAYLAND_DISPLAY'] == 'voco-delivery'
else:
    assert os.environ['DISPLAY'] == ':0'
assert not any(Path(path).exists() for path in ('/dev/input', '/dev/snd'))
# Only production paste on Wayland types, through VOCO's real virtual keyboard.
assert Path('/dev/uinput').is_char_device() == (wayland and bool(os.environ.get('VOCO_FIXTURE_PASTE_BINARY')))
fixtures = Path(__file__).with_name('fixtures')
results = []; processes = []; windows = []
SCREENSHOT = """import sys
import gi
gi.require_version('Gdk', '3.0')
from gi.repository import Gdk
Gdk.pixbuf_get_from_window(Gdk.get_default_root_window(), 0, 0, 1280, 900).savev(sys.argv[1], 'png', [], [])
"""


def paste(text):
    subprocess.run(['/usr/bin/python3', str(fixtures/'focused-paste.py'), text], check=True, timeout=40)


def key(*keys):
    """Test-only keys that read the result back; delivery never sends these."""
    subprocess.run(['xdotool', 'key', '--clearmodifiers', *keys], env=keyboard, check=True, timeout=5)


def wait_for(read, expected, what, timeout=10):
    deadline = time.monotonic() + timeout
    while (value := read()) != expected:
        if time.monotonic() > deadline:
            raise AssertionError(f'{what}: expected {expected!r}, found {value!r}')
        time.sleep(.05)


def file_text(path):
    return path.read_text().rstrip('\n') if path.exists() else None


def saved(document):
    key('ctrl+s'); time.sleep(.1)
    return file_text(document)


def launch(name, args, stdout=None, env=None):
    log = (out/f'{name}.log').open('w')
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=stdout or log, stderr=log, bufsize=0, env=env)
    processes.append(process)
    return process


def shell_windows():
    reply = subprocess.run(['dbus-send', '--session', '--print-reply=literal', '--dest=org.gnome.Shell',
                            '/org/voco/PrivateShellProbe', 'org.voco.PrivateShellProbe.GetWindows'],
                           capture_output=True, text=True, check=True, timeout=5)
    return json.loads(reply.stdout)


def visible_windows():
    if wayland:
        return [window for window in shell_windows() if window['visible']]
    ids = subprocess.run(['xdotool', 'search', '--onlyvisible', '--name', '.*'], capture_output=True, text=True, timeout=5).stdout.split()
    return [window_title(id) for id in ids]


def window_title(window):
    if wayland:
        return next((item['title'] for item in shell_windows() if item['generation'] == window['generation']), None)
    return subprocess.run(['xdotool', 'getwindowname', window], capture_output=True, text=True, timeout=5).stdout.strip()


def focused_window(process, title):
    """The application's window once it has keyboard focus, or None."""
    if wayland:
        # GNOME Shell focuses each new window itself.
        matches = [window for window in visible_windows()
                   if (re.search(title, window['title'] or '') if title else window['pid'] == process.pid)]
        return matches[-1] if matches and matches[-1]['focused'] else None
    search = ['xdotool', 'search', '--onlyvisible', *(['--name', title] if title else ['--pid', str(process.pid)])]
    ids = subprocess.run(search, capture_output=True, text=True, timeout=5).stdout.split()
    if ids:
        # No window manager runs here, so focus the window directly.
        subprocess.run(['xdotool', 'windowfocus', '--sync', ids[-1]], check=True, timeout=5)
        return ids[-1]
    return None


def focus_window(process, title=None, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if window := focused_window(process, title):
            windows.append(window)
            return window
        time.sleep(.05)
    if process.poll() is not None:
        raise AssertionError(f'Application window unavailable: the application exited with status {process.returncode}')
    raise AssertionError(f'Application window unavailable; visible windows: {visible_windows()}')


def close_windows(first_window):
    if not wayland:
        for window in windows[first_window:]:
            subprocess.run(['xdotool', 'windowclose', window], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        return
    # The probe cannot close windows, so end every client that still shows one.
    # A new window takes focus only when no other window holds it.
    deadline = time.monotonic() + 5
    while (remaining := shell_windows()) and time.monotonic() < deadline:
        for pid in {window['pid'] for window in remaining if window['pid'] > 1}:
            with contextlib.suppress(ProcessLookupError):
                os.kill(pid, signal.SIGTERM)
        time.sleep(.2)


def toolkit(kind):
    fixture = launch(kind, ['/usr/bin/python3', str(fixtures/'delivery-native.py'), kind], stdout=subprocess.PIPE)
    def ask(command='read'):
        fixture.stdin.write(command.encode() + b'\n')
        assert select.select([fixture.stdout], [], [], 5)[0], 'Fixture did not answer'
        return json.loads(fixture.stdout.readline())
    focus_window(fixture)
    wait_for(ask, {'focus': 'entry', 'entry': '', 'document': ''}, 'Entry focus')
    paste('Hello')
    wait_for(ask, {'focus': 'entry', 'entry': 'Hello', 'document': ''}, 'First chunk')
    paste(' Linux.')
    wait_for(ask, {'focus': 'entry', 'entry': 'Hello Linux.', 'document': ''}, 'Joined chunk')
    # The next chunk follows keyboard focus; a line break arrives as a space.
    wait_for(lambda: ask('document'), {'focus': 'document', 'entry': 'Hello Linux.', 'document': ''}, 'Document focus')
    paste('Another\nfield.')
    wait_for(ask, {'focus': 'document', 'entry': 'Hello Linux.', 'document': 'Another field.'}, 'Second field')


def text_editor():
    document = home/'text-editor.txt'; document.write_text('')
    editor = launch('text-editor', ['gnome-text-editor', '--standalone', str(document)])
    focus_window(editor)
    time.sleep(1)  # GNOME Text Editor has no readiness signal for its opened document.
    for text, expected in (('Hello', 'Hello'), (' Linux.', 'Hello Linux.')):
        paste(text)
        wait_for(lambda: saved(document), expected, 'Saved document')


def bash(name, terminal):
    # Bash records each prompt and, on test-only Ctrl+T, its unsubmitted line.
    work = home/name; work.mkdir()
    prompts = work/'prompts'; line = work/'line'
    prompt_count = lambda: prompts.read_text().count('\n') if prompts.exists() else 0
    (work/'bashrc').write_text(f"""PS1='$ '
PROMPT_COMMAND='echo >> {prompts}'
bind -x '"\\C-t": printf %s "$READLINE_LINE" > {line}'
""")
    shell = launch(name, [*terminal, '/bin/bash', '--noprofile', '--rcfile', str(work/'bashrc')])
    focus_window(shell, title=name)
    wait_for(prompt_count, 1, 'Bash prompt')
    def typed():
        key('ctrl+t'); time.sleep(.1)
        return file_text(line)
    # Bash can print its prompt before the terminal window takes keys.
    wait_for(typed, '', 'Terminal keyboard input')
    # Ghostty applies its key bindings about a second after its window takes
    # keys; until then Shift+Insert reaches Bash as an unbound escape sequence.
    time.sleep(1)
    for text, expected in (('hello', 'hello'), (' linux', 'hello linux')):
        paste(text)
        wait_for(typed, expected, 'Bash command line')
    assert prompt_count() == 1, 'The paste submitted a command'


def nano(name, terminal):
    document = home/'nano.txt'; document.write_text('')
    editor = launch(name, [*terminal, '/usr/bin/nano', '--ignorerc', '--locking', str(document)])
    focus_window(editor, title=name)
    # nano writes its lock file after it takes over terminal input.
    wait_for(home.joinpath('.nano.txt.swp').exists, True, 'nano startup')
    for text, expected in (('hello', 'hello'), (' linux', 'hello linux')):
        paste(text)
        wait_for(lambda: saved(document), expected, 'Saved nano buffer')


def gnome_terminal(name):
    return ['gnome-terminal', '--wait', f'--title={name}', '--']


def firefox():
    profile = home/'firefox'; profile.mkdir()
    (profile/'user.js').write_text('user_pref("browser.shell.checkDefaultBrowser", false);\n'
                                   'user_pref("browser.startup.homepage_override.mstone", "ignore");\n'
                                   'user_pref("browser.aboutwelcome.enabled", false);\n'
                                   'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);\n'
                                   'user_pref("datareporting.policy.dataSubmissionEnabled", false);\n'
                                   'user_pref("datareporting.policy.firstRunURL", "");\n')
    # The page mirrors its field into the window title for readback. Firefox
    # blocks top-level data: URLs, so it loads a local file.
    page = home/'firefox.html'
    page.write_text('<title>[]</title><textarea autofocus oninput="document.title=\'[\'+this.value+\']\'"></textarea>')
    browser = launch('firefox', [os.environ['VOCO_FIREFOX_BINARY'], '--no-remote', '--profile', str(profile), page.as_uri()],
                     env={**os.environ, 'MOZ_CRASHREPORTER_DISABLE': '1', **({'MOZ_ENABLE_WAYLAND': '1'} if wayland else {})})
    # A fresh hosted runner reads its preinstalled Firefox from a cold disk; the
    # first start there took up to 26 seconds to show the page.
    window = focus_window(browser, title=r'^\[\]', timeout=60)
    def title():
        match = re.match(r'\[(.*)\]', window_title(window) or '')
        return match and match.group(1)
    for text, expected in (('Hello', 'Hello'), (' Firefox.', 'Hello Firefox.')):
        paste(text)
        wait_for(title, expected, 'Firefox field')


def vscode():
    profile = home/'vscode'; (profile/'User').mkdir(parents=True)
    (profile/'User/settings.json').write_text(json.dumps({'workbench.startupEditor': 'none', 'update.mode': 'none',
                                                         'security.workspace.trust.enabled': False,
                                                         'chat.disableAIFeatures': True}))
    # Sign-in and welcome pages must not open a browser window over the editor.
    stubs = home/'vscode-bin'; stubs.mkdir()
    (stubs/'xdg-open').write_text('#!/bin/sh\nexit 0\n'); (stubs/'xdg-open').chmod(0o755)
    document = home/'vscode.txt'; document.write_text('')
    editor = launch('vscode', [os.environ['VOCO_VSCODE_BINARY'], '--no-sandbox', '--disable-gpu', '--password-store=basic',
                               *(['--ozone-platform=wayland'] if wayland else []),
                               f'--user-data-dir={profile}', f'--extensions-dir={profile/"extensions"}', '--new-window', str(document)],
                    env={**os.environ, 'PATH': f'{stubs}:{os.environ["PATH"]}'})
    focus_window(editor, title=r'vscode\.txt')
    time.sleep(2)  # The window title appears before the editor accepts input.
    for text, expected in (('Hello', 'Hello'), (' Linux.', 'Hello Linux.')):
        paste(text)
        wait_for(lambda: saved(document), expected, 'Saved editor')


def trial(name, run, requires=None):
    if os.environ.get('VOCO_APP_CASE') and os.environ['VOCO_APP_CASE'] not in name:
        return
    item = {'name': name, 'status': 'unavailable'}
    results.append(item)
    if requires and not os.environ.get(requires):
        item['detail'] = f'Set {requires} to run this case.'
        print(json.dumps(item), flush=True)
        return
    first_window = len(windows); first_process = len(processes)
    try:
        run()
        item['status'] = 'passed'
    except Exception as error:
        item.update(status='failed', error=str(error))
        # The Xvfb root also shows the nested Shell on gnome-wayland.
        png = out/(re.sub(r'\W+', '-', name).strip('-').lower() + '.png')
        with contextlib.suppress(subprocess.SubprocessError):
            subprocess.run(['/usr/bin/python3', '-c', SCREENSHOT, str(png)], env={**keyboard, 'GDK_BACKEND': 'x11'}, timeout=20)
    finally:
        close_windows(first_window)
        for process in processes[first_process:]:
            if process.poll() is None: process.terminate()
    print(json.dumps(item), flush=True)


try:
    for kind in ('gtk3', 'gtk4', 'webkit'):
        trial(f'{kind} native fields', lambda kind=kind: toolkit(kind))
    trial('GNOME Text Editor', text_editor)
    trial('GNOME Terminal / Bash', lambda: bash('VOCO-bash-fixture', gnome_terminal('VOCO-bash-fixture')))
    trial('GNOME Terminal / nano', lambda: nano('VOCO-nano-fixture', gnome_terminal('VOCO-nano-fixture')))
    trial('Ghostty / Bash', lambda: bash('VOCO-ghostty-fixture', [
        os.environ['VOCO_GHOSTTY_BINARY'], '--gtk-single-instance=false', '--shell-integration=none',
        '--title=VOCO-ghostty-fixture', '-e']), 'VOCO_GHOSTTY_BINARY')
    trial('Firefox page field', firefox, 'VOCO_FIREFOX_BINARY')
    trial('VS Code editor', vscode, 'VOCO_VSCODE_BINARY')
finally:
    paste_mode = 'production' if os.environ.get('VOCO_FIXTURE_PASTE_BINARY') else 'replica'
    (out/'results.json').write_text(json.dumps({'platform': platform, 'paste': paste_mode, 'results': results}, indent=2) + '\n')
    for process in processes:
        if process.poll() is None: process.terminate()
statuses = [item['status'] for item in results]
sys.exit(0 if 'passed' in statuses and 'failed' not in statuses else 1)
