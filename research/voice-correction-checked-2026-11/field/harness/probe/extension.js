// Test-only, installed exclusively in a run's throwaway home. It is the
// harness's eyes inside the Shell: the windows, the pointer and a screenshot.
// It sends no key and changes no text.
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
const xml = `<node><interface name="org.fieldladder.Probe">
<method name="Windows"><arg type="s" direction="out"/></method>
<method name="StartingUp"><arg type="b" direction="out"/></method>
<method name="HideOverview"/>
<method name="OverviewVisible"><arg type="b" direction="out"/></method>
<method name="Pointer"><arg type="ai" direction="out"/></method>
<method name="Screenshot"><arg type="s" direction="in"/></method>
<method name="ActivateWindow"><arg type="s" direction="in"/><arg type="b" direction="out"/></method>
</interface></node>`;
export default class Probe extends Extension {
    enable() {
        this.object = Gio.DBusExportedObject.wrapJSObject(xml, this);
        this.object.export(Gio.DBus.session, '/org/fieldladder/Probe');
    }
    // x, y, width and height are the frame's: what the person sees as the
    // window, without the shadow a client draws around it.
    Windows() {
        return JSON.stringify(global.get_window_actors().map(actor => {
            const window = actor.meta_window;
            const frame = window.get_frame_rect();
            return {
                title: window.get_title(), wmClass: window.get_wm_class(), pid: window.get_pid(),
                x: frame.x, y: frame.y, width: frame.width, height: frame.height,
                focused: global.display.focus_window === window,
                client: window.get_client_type() === Meta.WindowClientType.X11 ? 'x11' : 'wayland',
            };
        }));
    }
    StartingUp() { return Boolean(Main.layoutManager._startingUp); }
    HideOverview() { Main.overview.hide(); }
    OverviewVisible() { return Boolean(Main.overview.visible); }
    Pointer() { return global.get_pointer().slice(0, 2).map(Math.round); }
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
    ActivateWindow(title) {
        const window = global.get_window_actors().map(actor => actor.meta_window)
            .find(w => w.get_title() === title);
        if (window)
            Main.activateWindow(window);
        return Boolean(window);
    }
    disable() {
        this.object?.unexport();
        this.object = null;
    }
}
