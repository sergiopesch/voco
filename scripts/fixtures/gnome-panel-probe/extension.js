// Test-only, installed exclusively in a disposable desktop namespace.
import Gio from 'gi://Gio';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
const xml = '<node><interface name="org.voco.PanelProbe"><method name="Inspect"><arg type="s" direction="out"/></method><method name="Stop"/><method name="Overview"/><method name="NativeState"><arg type="s" direction="out"/></method><method name="Crowd"><arg type="b" direction="in"/></method></interface></node>';
function bounds(actor) {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    return {x, y, width, height, visible: actor.visible};
}
function children(actor) { return [actor, ...actor.get_children().flatMap(children)]; }
export default class Probe extends Extension {
    enable() {
        this.object = Gio.DBusExportedObject.wrapJSObject(xml, this);
        this.object.export(Gio.DBus.session, '/org/voco/PanelProbe');
    }
    Inspect() {
        const indicator = Main.panel.statusArea['voco-panel@voco.local'];
        const actors = indicator ? children(indicator) : [];
        return JSON.stringify({animations: St.Settings.get().enable_animations, panel: bounds(Main.panel), indicator: indicator ? bounds(indicator) : null,
            windows: global.get_window_actors().length,
            actors: actors.map(actor => ({...bounds(actor), name: actor.accessible_name,
                text: actor.text ?? null, scale: actor.scale_y, opacity: actor.opacity,
                style: actor.style_class, transitions: actor.get_transition('width') !== null}))});
    }
    Stop() {
        const indicator = Main.panel.statusArea['voco-panel@voco.local'];
        children(indicator).find(actor => actor.accessible_name === 'Stop dictation').emit('clicked', 1);
    }
    Crowd(enabled) {
        this.spacer?.destroy(); this.spacer = null;
        if (enabled) {
            this.spacer = new St.Widget({width: 250});
            Main.panel._rightBox.add_child(this.spacer);
        }
    }
    NativeState() {
        return Gio.DBus.session.call_sync('org.voco.Panel', '/org/voco/Panel', 'org.voco.Panel1',
            'GetState', null, null, Gio.DBusCallFlags.NO_AUTO_START, 1500, null).deep_unpack()[0];
    }
    Overview() { Main.overview.hide(); }
    disable() { this.spacer?.destroy(); this.object?.unexport(); this.object = null; }
}
