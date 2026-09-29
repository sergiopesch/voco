// Test-only, installed exclusively in a disposable desktop namespace.
import Gio from 'gi://Gio';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
const xml = '<node><interface name="org.voco.PanelProbe"><method name="Inspect"><arg type="s" direction="out"/></method><method name="Stop"/><method name="Menu"/><method name="MenuAction"><arg type="s" direction="in"/></method><method name="Overview"/><method name="NativeState"><arg type="s" direction="out"/></method><method name="Crowd"><arg type="b" direction="in"/></method><method name="SlowDown"><arg type="d" direction="in"/></method><method name="Focus"><arg type="b" direction="in"/></method></interface></node>';
function bounds(actor) {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    return {x, y, width, height, visible: actor.visible};
}
function children(actor) { return [actor, ...actor.get_children().flatMap(children)]; }
function iconPath(actor) {
    let icon = actor.gicon;
    while (icon instanceof Gio.EmblemedIcon) icon = icon.get_icon();
    return icon instanceof Gio.FileIcon ? icon.get_file().get_path() : null;
}
export default class Probe extends Extension {
    enable() {
        this.object = Gio.DBusExportedObject.wrapJSObject(xml, this);
        this.object.export(Gio.DBus.session, '/org/voco/PanelProbe');
    }
    Inspect() {
        const indicator = Main.panel.statusArea['voco-panel@voco.local'];
        const actors = indicator ? children(indicator) : [];
        // The companion eases its meter through an adjustment, not an actor property.
        const reveal = Main.extensionManager.lookup('voco-panel@voco.local')?.stateObj?._reveal;
        return JSON.stringify({animations: St.Settings.get().enable_animations, panel: bounds(Main.panel), indicator: indicator ? bounds(indicator) : null,
            indicatorFocus: indicator ? indicator.has_style_pseudo_class('focus') : null,
            revealing: Boolean(reveal?.get_transition('value')),
            statusIcons: Object.entries(Main.panel.statusArea).filter(([key, value]) => key.startsWith('appindicator-') && value)
                .map(([key, value]) => ({key, ...bounds(value), mapped: value.mapped,
                    actors: children(value).map(actor => ({...bounds(actor), mapped: actor.mapped,
                        opacity: actor.opacity, hasIcon: Boolean(actor.gicon), icon: iconPath(actor), text: actor.text ?? null}))})),
            windows: global.get_window_actors().length,
            menu: indicator ? {open: indicator.menu.isOpen, ...bounds(indicator.menu.actor),
                items: indicator.menu._getMenuItems().map(item => ({text: item.label?.text,
                    sensitive: item.sensitive, ...bounds(item)}))} : null,
            windowMenuOpen: children(global.stage).some(actor => actor.mapped && actor.text === 'Take Screenshot'),
            rightBox: Main.panel._rightBox.get_children().map(child => ({...bounds(child), voco: child === indicator?.container})),
            actors: actors.map(actor => ({...bounds(actor), name: actor.accessible_name,
                text: actor.text ?? null, scale: actor.scale_y, opacity: actor.opacity,
                style: actor.style_class}))});
    }
    Stop() {
        const indicator = Main.panel.statusArea['voco-panel@voco.local'];
        children(indicator).find(actor => actor.accessible_name?.endsWith('Stop dictation')).emit('clicked', 1);
    }
    Menu() {
        Main.panel.statusArea['voco-panel@voco.local'].menu.toggle();
    }
    MenuAction(label) {
        const item = Main.panel.statusArea['voco-panel@voco.local'].menu._getMenuItems()
            .find(item => item.label?.text === label);
        if (item?.sensitive && item.visible) item.activate(null);
    }
    Crowd(enabled) {
        this.spacer?.destroy(); this.spacer = null;
        if (enabled) {
            this.spacer = new St.Widget({width: 250});
            Main.panel._rightBox.add_child(this.spacer);
        }
    }
    Focus(enabled) {
        const indicator = Main.panel.statusArea['voco-panel@voco.local'];
        if (enabled) children(indicator).find(actor => actor instanceof St.Button).grab_key_focus();
        else global.stage.set_key_focus(null);
    }
    // Stretches every Shell animation so a poll can sample many of its frames.
    SlowDown(factor) { St.Settings.get().slow_down_factor = factor; }
    NativeState() {
        return Gio.DBus.session.call_sync('org.voco.Panel', '/org/voco/Panel', 'org.voco.Panel1',
            'GetState', null, null, Gio.DBusCallFlags.NO_AUTO_START, 1500, null).deep_unpack()[0];
    }
    Overview() { Main.overview.hide(); }
    disable() { this.SlowDown(1); this.spacer?.destroy(); this.object?.unexport(); this.object = null; }
}
