import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {presentation, barScales} from './model.js';

const NAME = 'org.voco.Panel';
const PATH = '/org/voco/Panel';
const INTERFACE = 'org.voco.Panel1';
const INPUT_PATH = '/org/voco/PanelInput';
const INPUT_XML = '<node><interface name="org.voco.PanelInput1"><method name="ModifiersClear"><arg type="b" direction="out"/></method></interface></node>';
// GNOME 50 removed X11 sessions together with Meta.is_wayland_compositor(). The
// metadata admits only tested majors, and on each of them a missing function
// means a Wayland-only Shell.
const isWayland = () => Meta.is_wayland_compositor?.() ?? true;

// Holds the meter at its natural size against the microphone, so opening and
// closing uncover it in place: only the pill's outer edge moves.
const Reveal = GObject.registerClass(class VocoReveal extends St.Widget {
    vfunc_allocate(box) {
        this.set_allocation(box);
        const child = this.get_first_child();
        if (!child?.visible) return;
        const [, width] = child.get_preferred_width(-1);
        const [, height] = child.get_preferred_height(width);
        const x = this.get_text_direction() === Clutter.TextDirection.RTL ? 0 : Math.floor(box.get_width() - width);
        const y = Math.floor((box.get_height() - height) / 2);
        child.allocate(Clutter.ActorBox.new(x, y, x + width, y + height));
    }
});

export default class VocoPanel extends Extension {
    enable() {
        this._alive = true;
        this._inputGuard = Gio.DBusExportedObject.wrapJSObject(INPUT_XML, this);
        this._inputGuard.export(Gio.DBus.session, INPUT_PATH);
        this._generation = 0;
        this._target = null;
        this._barsKey = null;
        this._state = null;
        this._polling = false;
        this._refreshQueued = false;
        this._signal = 0;
        this._attached = false;
        this._timer = 0;
        this._shortcut = 0;
        this._accelerator = null;
        this._heartbeat = 0;
        this._reserving = false;
        this._shortcutGeneration = 0;
        // The consumed chord is the ordinary toggle; VOCO decides Start or Stop.
        this._shortcutSignal = global.display.connect('accelerator-activated', (_display, action) => {
            if (this._shortcut && action === this._shortcut)
                this._call('Action', new GLib.Variant('(ss)', ['shortcut', '']), () => {});
        });
        this._cancellable = new Gio.Cancellable();
        this._indicator = new PanelMenu.Button(0, 'VOCO');
        this._indicator.can_focus = false;
        this._indicator.add_style_class_name('voco-panel');
        this._indicator.hide();
        // The button is the pill GNOME highlights on hover, focus and an open
        // menu, so VOCO's tint and the theme's fills share one shape. A primary
        // click anywhere on it stops or opens VOCO; other mouse buttons open the menu.
        this._button = new St.Button({style_class: 'voco-panel-button',
            can_focus: true, accessible_name: 'VOCO'});
        this._indicator.add_child(this._button);
        this._box = new St.BoxLayout();
        this._button.set_child(this._box);
        this._button.connect('clicked', () => this._action(this._state?.canStop ? 'stop' : 'open'));
        this._button.connect('key-focus-in', () => this._indicator?.add_style_pseudo_class('focus'));
        this._button.connect('key-focus-out', () => this._indicator?.remove_style_pseudo_class('focus'));
        this._button.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Menu &&
                !(event.get_key_symbol() === Clutter.KEY_F10 && event.get_state() & Clutter.ModifierType.SHIFT_MASK))
                return Clutter.EVENT_PROPAGATE;
            this._indicator.menu.toggle();
            return Clutter.EVENT_STOP;
        });
        this._settingsItem = new PopupMenu.PopupMenuItem('Settings');
        this._settingsItem.connect('activate', () => this._action('settings'));
        this._indicator.menu.addMenuItem(this._settingsItem);
        this._reviewItem = new PopupMenu.PopupMenuItem('Review');
        this._reviewItem.connect('activate', () => this._action('review'));
        this._indicator.menu.addMenuItem(this._reviewItem);
        this._stopItem = new PopupMenu.PopupMenuItem('Stop dictation');
        this._stopItem.connect('activate', () => this._action('stop'));
        this._indicator.menu.addMenuItem(this._stopItem);
        // The top bar's right side grows leftward, so the microphone comes last
        // and never moves: the meter opens and closes on its left.
        this._clip = new Reveal({clip_to_allocation: true, width: 0});
        // The panel packs fractional widths unevenly, which jolts every indicator
        // on this side; the meter eases through whole pixels only.
        this._reveal = new St.Adjustment({actor: this._clip, upper: 1000});
        this._reveal.connect('notify::value', () => {
            this._clip.width = Math.round(this._reveal.value);
            // A fixed-width actor already awaiting layout passes no relayout up,
            // so widths the panel measured this frame would stay cached.
            this._box.queue_relayout();
        });
        this._detail = new St.BoxLayout({style_class: 'voco-panel-detail', visible: false});
        this._clip.add_child(this._detail);
        this._box.add_child(this._clip);
        this._box.add_child(new St.Icon({style_class: 'voco-panel-icon', y_align: Clutter.ActorAlign.CENTER,
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(`${this.path}/voco-symbol.png`)), icon_size: 20}));
        this._wave = new St.BoxLayout({style_class: 'voco-panel-wave', y_align: Clutter.ActorAlign.CENTER});
        this._bars = Array.from({length: 7}, () => {
            const bar = new St.Widget({style_class: 'voco-panel-bar', y_align: Clutter.ActorAlign.CENTER});
            bar.set_pivot_point(0.5, 0.5);
            this._wave.add_child(bar);
            return bar;
        });
        this._detail.add_child(this._wave);
        this._label = new St.Label({style_class: 'voco-panel-status', y_align: Clutter.ActorAlign.CENTER});
        this._detail.add_child(this._label);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._motionId = this._settings.connect('changed::enable-animations', () => this._render());
        this._sizeId = Main.panel.connect('notify::width', () => this._render());
        this._watch = Gio.bus_watch_name(Gio.BusType.SESSION, NAME, Gio.BusNameWatcherFlags.NONE,
            (_connection, _name, owner) => {
                this._owner = owner;
                const generation = ++this._generation;
                this._call('Attach', null, (result) => {
                    if (generation !== this._generation) return;
                    this._attached = result.deep_unpack()[0] === true;
                    if (this._attached) this._beginPolling();
                });
            }, () => { this._owner = null; this._disconnect(); });
    }

    ModifiersClearAsync(_parameters, invocation) {
        if (!this._alive || !this._attached || invocation.get_sender() !== this._owner) {
            invocation.return_dbus_error('org.voco.NotAttached', 'Only the attached application can check input readiness');
            return;
        }
        // A paste can be ready while the consumed shortcut is still held.
        // Observe compositor state; never synthesize releases of the user's keys.
        const modifiers = Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.CONTROL_MASK |
            Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.SUPER_MASK |
            Clutter.ModifierType.META_MASK | Clutter.ModifierType.HYPER_MASK |
            Clutter.ModifierType.MOD4_MASK | Clutter.ModifierType.MOD5_MASK;
        invocation.return_value(new GLib.Variant('(b)', [(global.get_pointer()[2] & modifiers) === 0]));
    }

    _call(method, parameters, done, failed = () => this._retry()) {
        // Pin calls to the unique owner; an in-flight request cannot hit a replacement app.
        const cancellable = this._cancellable;
        const generation = this._generation;
        Gio.DBus.session.call(this._owner, PATH, INTERFACE, method, parameters, null,
            Gio.DBusCallFlags.NO_AUTO_START, 1500, this._cancellable, (connection, result) => {
                if (!this._alive || cancellable !== this._cancellable || generation !== this._generation) return;
                try { done?.(connection.call_finish(result)); }
                catch (error) { failed(error); }
            });
    }

    _beginPolling() {
        if (this._signal) Gio.DBus.session.signal_unsubscribe(this._signal);
        this._signal = Gio.DBus.session.signal_subscribe(this._owner, INTERFACE,
            'Changed', PATH, null, Gio.DBusSignalFlags.NONE, () => this._poll());
        this._poll();
    }

    _poll() {
        if (!this._attached || !this._alive) return;
        if (this._polling) { this._refreshQueued = true; return; }
        this._polling = true;
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        const generation = this._generation;
        this._call('GetState', null, result => {
            if (generation !== this._generation || !this._attached) return;
            this._polling = false;
            this._state = presentation(JSON.parse(result.deep_unpack()[0]));
            this._syncShortcut();
            this._indicator.show();
            this._render();
            // Only recording streams levels; statuses arrive through Changed.
            const delay = this._refreshQueued ? 1 : this._state.status === 'recording' ? 50 : 1500;
            this._refreshQueued = false;
            this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._timer = 0;
                this._poll();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _render() {
        if (!this._state || !this._alive) return;
        const state = this._state;
        const motion = this._settings.get_boolean('enable-animations');
        const action = state.canStop ? 'Stop dictation' : state.canOpen ? 'Open settings' : '';
        this._button.accessible_name = [state.description, action].filter(Boolean).join('. ');
        const wave = state.active;
        const label = !state.active && state.label.length > 0;
        // A closing meter keeps its last content until the clip hides it.
        if (wave || label) {
            this._wave.visible = wave;
            this._label.visible = label;
            if (label) this._label.text = state.label;
        }
        this._settingsItem.setSensitive(state.canOpen);
        this._reviewItem.setSensitive(state.canOpen);
        this._stopItem.visible = state.canStop;
        this._stopItem.setSensitive(state.canStop);
        // Only new levels, statuses or motion settings move the bars; the
        // processing pulse runs until the status changes.
        const processing = state.status === 'processing';
        const scales = barScales(state.level);
        const bars = `${processing}:${motion}:${scales}`;
        if (bars !== this._barsKey) {
            this._barsKey = bars;
            this._bars.forEach((bar, index) => {
                bar.remove_all_transitions();
                const scale = processing ? 0.35 : scales[index];
                const duration = scale >= bar.scale_y ? 45 : 100;
                bar.ease({scale_y: scale, duration: motion ? duration : 0, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                // Processing uses a restrained pulse; listening only reflects real levels.
                bar.opacity = 255;
                if (processing && motion)
                    bar.ease({opacity: 90, duration: 700, delay: index * 40,
                        autoReverse: true, repeatCount: -1, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE});
            });
        }
        if (state.status !== 'idle') this._button.add_style_class_name('voco-panel-active');
        else this._button.remove_style_class_name('voco-panel-active');
        // Open the meter only if the whole right side, meter included, still
        // fits beside the clock. A crowded panel keeps just the actionable icon.
        // St styles hidden actors only on request; measure content as it will look.
        [this._detail, this._wave, this._label].forEach(widget => widget.ensure_style());
        const [, natural] = this._detail.get_preferred_width(-1);
        const [, row] = Main.panel._rightBox.get_preferred_width(-1);
        const center = Main.panel._centerBox;
        const space = Main.panel.get_text_direction() === Clutter.TextDirection.RTL
            ? center.x : Main.panel.width - center.x - center.width;
        // Capture adds GNOME's privacy microphone to this side; a closed meter
        // keeps an idle pill's room for it, so it never opens only to close again.
        const reserve = wave && !this._target ? this._button.get_preferred_width(-1)[1] - this._clip.width : 0;
        const target = (wave || label) && row - this._clip.width + natural + reserve <= space
            ? Math.ceil(natural) : 0;
        if (this._target !== target) {
            this._target = target;
            // Closed content leaves the accessibility tree as well as the view.
            if (target) this._detail.show();
            this._reveal.ease(target, {duration: motion && this._clip.mapped ? 220 : 0,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => { if (!target) this._detail.hide(); }});
        }
    }

    _syncShortcut() {
        // Consume the chord whenever attached, idle included, so the focused app
        // never also acts on it. X11 keeps VOCO's own exclusive global shortcut.
        const accelerator = this._attached && isWayland()
            ? this._state?.shortcutAccelerator ?? null : null;
        if (accelerator === this._accelerator) return;
        this._releaseShortcut();
        if (!accelerator) return;
        const action = global.display.grab_accelerator(accelerator, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT);
        if (action === Meta.KeyBindingAction.NONE) return;
        this._shortcut = action;
        this._accelerator = accelerator;
        // Ordinary and fullscreen windows and the overview; Shell modals filter it.
        Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action),
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
        this._reserveShortcut();
        this._heartbeat = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._reserveShortcut();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _reserveShortcut() {
        // VOCO mutes its passive listener only while renewals arrive. One is in
        // flight at a time, so a hung app times out and the grab is released.
        if (this._reserving) return;
        this._reserving = true;
        const generation = this._shortcutGeneration;
        this._call('ReserveShortcut', new GLib.Variant('(s)', [this._accelerator]), result => {
            if (generation !== this._shortcutGeneration) return;
            this._reserving = false;
            if (result.deep_unpack()[0] !== true) this._releaseShortcut();
        }, () => {
            if (generation === this._shortcutGeneration) this._retry();
        });
    }

    _releaseShortcut() {
        // Late replies about an earlier grab must never act on a newer one.
        this._shortcutGeneration++;
        this._reserving = false;
        if (this._heartbeat) { GLib.source_remove(this._heartbeat); this._heartbeat = 0; }
        if (this._shortcut) {
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(this._shortcut), Shell.ActionMode.NONE);
            global.display.ungrab_accelerator(this._shortcut);
        }
        this._shortcut = 0;
        this._accelerator = null;
    }

    _action(action) {
        const state = this._state;
        if (!state || (action === 'stop' ? !state.canStop : !state.canOpen)) return;
        this._indicator.menu.close();
        this._call('Action', new GLib.Variant('(ss)', [action, action === 'stop' ? state.stopSession : state.token]), () => {});
    }

    _retry() {
        this._detach();
        this._disconnect();
        if (!this._alive || !this._owner) return;
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._timer = 0;
            const generation = this._generation;
            this._call('Attach', null, result => {
                if (generation !== this._generation) return;
                this._attached = result.deep_unpack()[0] === true;
                if (this._attached) this._beginPolling();
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _disconnect() {
        this._releaseShortcut();
        this._generation++;
        this._attached = false;
        this._polling = false;
        this._refreshQueued = false;
        if (this._signal) { Gio.DBus.session.signal_unsubscribe(this._signal); this._signal = 0; }
        this._state = null;
        this._barsKey = null;
        this._target = null;
        this._bars?.forEach(bar => bar.remove_all_transitions());
        // Reappear collapsed; a reconnect must not replay a stale expansion.
        this._reveal?.remove_transition('value');
        if (this._reveal) { this._reveal.value = 0; this._detail.hide(); }
        this._button?.remove_style_class_name('voco-panel-active');
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        this._indicator?.hide();
    }

    _detach() {
        if (this._attached && this._owner)
            Gio.DBus.session.call(this._owner, PATH, INTERFACE, 'Detach', null, null,
                Gio.DBusCallFlags.NO_AUTO_START, 1000, null, null);
    }

    disable() {
        this._inputGuard?.unexport();
        this._inputGuard = null;
        this._detach();
        this._alive = false;
        this._disconnect();
        if (this._shortcutSignal) { global.display.disconnect(this._shortcutSignal); this._shortcutSignal = 0; }
        this._cancellable?.cancel();
        if (this._watch) Gio.bus_unwatch_name(this._watch);
        if (this._sizeId) Main.panel.disconnect(this._sizeId);
        if (this._motionId) this._settings.disconnect(this._motionId);
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
