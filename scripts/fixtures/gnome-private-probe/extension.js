// Test-only: copied into disposable XDG_DATA_HOME, never the active user profile.
import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
const xml = '<node><interface name="org.voco.PrivateShellProbe"><method name="GetWindows"><arg type="s" direction="out"/></method></interface></node>';
export default class Probe extends Extension {
    enable() {
        this.ids = new WeakMap();
        this.nextId = 1;
        this.object = Gio.DBusExportedObject.wrapJSObject(xml, this);
        this.object.export(Gio.DBus.session, '/org/voco/PrivateShellProbe');
    }
    GetWindows() {
        return JSON.stringify(global.get_window_actors().map(actor => {
            const window = actor.meta_window;
            if (!this.ids.has(window))
                this.ids.set(window, this.nextId++);
            const r = window.get_frame_rect();
            return {generation: this.ids.get(window), pid: window.get_pid(),
                title: window.get_title(), frame: [r.x, r.y, r.width, r.height],
                visible: actor.visible && !window.is_hidden(),
                focused: global.display.focus_window === window};
        }));
    }
    disable() {
        this.object?.unexport();
        this.object = null;
        this.ids = null;
    }
}
