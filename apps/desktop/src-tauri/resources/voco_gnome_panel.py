"""Explicit GNOME panel setup. Checking never changes desktop preferences."""
import json
import os
from pathlib import Path
import sys
import time

UUID = 'voco-panel@voco.local'
# Bump with behavior changes that require reloading the running Shell companion.
COMPANION_VERSION = 4
PACKAGE = Path('/usr/share/gnome-shell/extensions') / UUID


def result(status, detail, can_enable=False):
    return dict(status=status, detail=detail, canEnable=can_enable)


def classify(version, installed, info, enabled, globally_disabled):
    if version.split('.')[0] != '46':
        return result('unsupported', 'Live panel bars require GNOME 46. Use the VOCO tray menu for status and Stop.')
    if not installed:
        return result('missing', 'The VOCO panel files are missing. Reinstall the complete VOCO package.')
    if globally_disabled:
        return result('blocked', 'GNOME extensions are turned off. Turn them on in Extensions, then check again.')
    if info.get('state') == 1:
        if info.get('version') != COMPANION_VERSION:
            return result('restart', 'Panel update installed. Save your work, then sign out and back in to load the current bars and Stop controls.')
        return result('active', 'Live panel bars and Stop are active.')
    if info.get('state') in (3, 4):
        return result('error', 'GNOME could not load the VOCO panel. Sign out and back in, then check Extensions.')
    if enabled:
        return result('restart', 'Panel enabled. Sign out and back in to load it; saving your work first is recommended.')
    return result('disabled', 'Enable live bars, Listening and Stop in your top panel.', True)


def check(enable=False):
    # Query the running shell, not a potentially different installed shell version.
    import gi
    gi.require_version('Gio', '2.0')
    from gi.repository import Gio, GLib
    if not any(item.lower() == 'gnome' for item in os.environ.get('XDG_CURRENT_DESKTOP', '').split(':')):
        return result('other-desktop', 'Use the VOCO tray menu for status and Stop. Labels depend on your desktop.')
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)

    def call(interface, method, parameters):
        return bus.call_sync('org.gnome.Shell', '/org/gnome/Shell', interface, method,
                             parameters, None, Gio.DBusCallFlags.NO_AUTO_START, 700, None).unpack()[0]

    version = call('org.freedesktop.DBus.Properties', 'Get',
                   GLib.Variant('(ss)', ('org.gnome.Shell.Extensions', 'ShellVersion')))
    if isinstance(version, GLib.Variant):
        version = version.unpack()
    info = call('org.gnome.Shell.Extensions', 'GetExtensionInfo', GLib.Variant('(s)', (UUID,)))
    info = {key: value.unpack() if isinstance(value, GLib.Variant) else value for key, value in info.items()}
    settings = Gio.Settings.new('org.gnome.shell')
    enabled = list(settings.get_strv('enabled-extensions'))
    installed = all((PACKAGE / name).is_file() for name in
                    ('metadata.json', 'extension.js', 'model.js', 'stylesheet.css', 'voco-symbol.png'))
    status = classify(version, installed, info, UUID in enabled,
                      settings.get_boolean('disable-user-extensions'))
    if enable and status['canEnable']:
        if not settings.is_writable('enabled-extensions'):
            return result('blocked', 'Your desktop policy prevents enabling extensions. Contact your administrator.')
        if info:
            if not call('org.gnome.Shell.Extensions', 'EnableExtension', GLib.Variant('(s)', (UUID,))):
                return result('error', 'GNOME could not enable the panel. Check VOCO in Extensions.')
            for _ in range(5):
                time.sleep(.1)
                context = GLib.MainContext.default()
                for _ in range(64):
                    if not context.pending():
                        break
                    context.iteration(False)
                current = check(False)
                if current['status'] in ('active', 'error', 'blocked', 'restart'):
                    return current
            return result('pending', 'Panel activation requested. Check again in a moment.')
        # Only this extension is added. A newly installed system extension is
        # discovered at next login; never restart Shell or change the global switch.
        if not settings.set_strv('enabled-extensions', [*enabled, UUID]):
            return result('error', 'GNOME could not save panel activation. Check again in Extensions.')
        Gio.Settings.sync()
        return check(False)
    return status


def main():
    try:
        status = check('--enable' in sys.argv[1:])
    except Exception:
        status = result('unavailable', 'Panel status is unavailable. Open Extensions to check VOCO, or use the tray menu.')
    print(json.dumps(status))


if __name__ == '__main__':
    main()
