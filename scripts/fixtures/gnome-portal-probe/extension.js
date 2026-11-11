// Test-only, installed exclusively in a disposable desktop namespace.
// Its virtual keyboard is the tester's hands: a Clutter device inside the
// Shell, so the tester's own keys open no RemoteDesktop session beside VOCO's
// and show no remote-access icon of their own.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
const xml = `<node><interface name="org.voco.PortalProbe">
<method name="Windows"><arg type="s" direction="out"/></method>
<method name="ActivateWindow"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
<method name="StartingUp"><arg type="b" direction="out"/></method>
<method name="HideOverview"/>
<method name="Key"><arg type="u" direction="in"/><arg type="b" direction="in"/></method>
<method name="Screenshot"><arg type="s" direction="in"/></method>
<method name="Sharing"><arg type="b" direction="out"/></method>
<method name="StopSharing"/>
</interface></node>`;
export default class Probe extends Extension {
    enable() {
        this.object = Gio.DBusExportedObject.wrapJSObject(xml, this);
        this.object.export(Gio.DBus.session, '/org/voco/PortalProbe');
    }
    Windows() {
        return JSON.stringify(global.get_window_actors().map(actor => ({
            title: actor.meta_window.get_title(), pid: actor.meta_window.get_pid(),
            focused: global.display.focus_window === actor.meta_window})));
    }
    ActivateWindow(title) {
        const window = global.get_window_actors().map(actor => actor.meta_window).find(w => w.get_title() === title);
        window?.activate(global.get_current_time());
        return Boolean(window);
    }
    // Until startup completes the Shell's action mode is NONE and it filters
    // every grabbed shortcut, the portal's included.
    StartingUp() { return Boolean(Main.layoutManager._startingUp); }
    HideOverview() { Main.overview.hide(); }
    Key(code, pressed) {
        this.keyboard ??= Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this.keyboard.notify_key(GLib.get_monotonic_time(), code,
            pressed ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED);
    }
    ScreenshotAsync([path], invocation) {
        const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
        new Shell.Screenshot().screenshot(false, stream, (shooter, result) => {
            try {
                shooter.screenshot_finish(result);
                stream.close(null);
                invocation.return_value(null);
            } catch (error) {
                invocation.return_error_literal(Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED, `${error}`);
            }
        });
    }
    // GNOME's remote-access icon (ScreenSharingIndicator, status/remoteAccess.js).
    Sharing() {
        const indicator = Main.panel.statusArea.screenSharing;
        return Boolean(indicator?.visible && (indicator.container?.visible ?? true));
    }
    // What the icon's Stop button does.
    StopSharing() { Main.panel.statusArea.screenSharing._stopSharing(); }
    disable() {
        this.object?.unexport();
        this.object = null;
        this.keyboard?.run_dispose?.();
        this.keyboard = null;
    }
}
