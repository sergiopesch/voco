import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {presentation, barScales} from './model.js';

const NAME = 'org.voco.Panel';
const PATH = '/org/voco/Panel';
const INTERFACE = 'org.voco.Panel1';

export default class VocoPanel extends Extension {
    enable() {
        this._alive = true;
        this._generation = 0;
        this._target = null;
        this._previousStatus = null;
        this._state = null;
        this._polling = false;
        this._refreshQueued = false;
        this._signal = 0;
        this._attached = false;
        this._timer = 0;
        this._shortcut = 0;
        this._accelerator = null;
        this._shortcutDeadline = 0;
        this._stopPending = null;
        this._shortcutTimer = 0;
        this._shortcutGeneration = 0;
        this._shortcutSignal = global.display.connect('accelerator-activated', (_display, action) => {
            if (action === this._shortcut && this._state?.canStop)
                this._stopPending ??= this._state.stopSession;
        });
        this._cancellable = new Gio.Cancellable();
        // The dummy menu satisfies GNOME's status-area contract without a popup.
        this._indicator = new PanelMenu.Button(0, 'VOCO', true);
        this._indicator.can_focus = false;
        this._indicator.add_style_class_name('voco-panel');
        this._indicator.hide();
        this._box = new St.BoxLayout({style_class: 'voco-panel-box'});
        this._indicator.add_child(this._box);
        this._iconButton = new St.Button({style_class: 'voco-panel-button',
            can_focus: true, accessible_name: 'VOCO settings'});
        this._iconButton.set_child(new St.Icon({
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(`${this.path}/voco-symbol.png`)),
            icon_size: 20, style_class: 'system-status-icon'}));
        this._iconButton.connect('clicked', () => this._action(this._state?.canStop ? 'stop' : 'open'));
        this._box.add_child(this._iconButton);
        this._clip = new St.Widget({layout_manager: new Clutter.BinLayout(), clip_to_allocation: true, width: 0});
        this._detail = new St.BoxLayout({style_class: 'voco-panel-detail'});
        this._clip.add_child(this._detail);
        this._box.add_child(this._clip);
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
        this._stop = new St.Button({style_class: 'voco-panel-stop', label: 'Stop',
            can_focus: true, accessible_name: 'Stop dictation', y_align: Clutter.ActorAlign.CENTER});
        this._stop.connect('clicked', () => this._action('stop'));
        this._detail.add_child(this._stop);
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
            const delay = this._refreshQueued ? 1 : this._state.active ? 50 : 1500;
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
        this._iconButton.accessible_name = `VOCO: ${state.description}. ${state.canStop ? 'Stop dictation' : 'Open VOCO'}`;
        this._iconButton.reactive = state.canStop || state.canOpen;
        this._label.text = state.label;
        this._wave.visible = state.status === 'recording' || state.status === 'processing';
        this._stop.visible = state.canStop;
        this._stop.can_focus = state.canStop;
        this._stop.reactive = state.canStop;
        const scales = barScales(state.level);
        this._bars.forEach((bar, index) => {
            if (state.status === 'processing' && this._previousStatus === 'processing' && motion === this._previousMotion) return;
            bar.remove_all_transitions();
            const scale = state.status === 'processing' ? 0.35 : scales[index];
            const duration = scale >= bar.scale_y ? 45 : 100;
            bar.ease({scale_y: scale, duration: motion ? duration : 0, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            // Processing uses a restrained pulse; listening only reflects real levels.
            bar.opacity = 255;
            if (state.status === 'processing' && motion)
                bar.ease({opacity: 90, duration: 700, delay: index * 40,
                    autoReverse: true, repeatCount: -1, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE});
        });
        this._previousStatus = state.status;
        this._previousMotion = motion;
        const expanded = state.status !== 'idle';
        if (expanded) this._box.add_style_class_name('voco-panel-active');
        else this._box.remove_style_class_name('voco-panel-active');
        const [, natural] = this._detail.get_preferred_width(-1);
        // Leave centre and other panel items their space. On a crowded panel,
        // retain the actionable icon instead of clipping an unusable Stop button.
        const right = Main.panel._rightBox;
        const other = right.get_children().filter(child => child !== this._indicator.container && child !== this._indicator)
            .reduce((sum, child) => sum + child.get_width(), 0);
        const budget = Math.max(0, Main.panel.width / 2 - Main.panel._centerBox.width / 2 - other - 48);
        const target = expanded && natural <= budget ? natural : 0;
        this._stop.can_focus = state.canStop && target > 0;
        if (this._target !== target) {
            this._target = target;
            this._clip.remove_all_transitions();
            this._clip.ease({width: target, duration: motion ? 220 : 0, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
    }

    _syncShortcut() {
        const state = this._state;
        const accelerator = state?.active && typeof state.stopShortcutToken === 'string' && state.stopShortcutToken.length > 0 && ['<Alt>d', '<Alt><Shift>d'].includes(state.stopAccelerator)
            ? state.stopAccelerator : null;
        if (accelerator !== this._accelerator) {
            this._releaseShortcut();
            if (!accelerator) return;
            const action = global.display.grab_accelerator(accelerator, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT);
            if (action === Meta.KeyBindingAction.NONE) return;
            this._shortcut = action;
            this._accelerator = accelerator;
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action), Shell.ActionMode.NORMAL);
            this._shortcutTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                if (GLib.get_monotonic_time() > this._shortcutDeadline) {
                    this._releaseShortcut();
                    return GLib.SOURCE_REMOVE;
                }
                // Wait for modifiers to be released before final text can paste.
                // Only an explicit Stop is emitted, never a delayed toggle/start.
                if (this._stopPending && !(global.get_pointer()[2] &
                    (Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.SHIFT_MASK))) {
                    const session = this._stopPending;
                    this._stopPending = null;
                    if (this._state?.canStop && this._state.stopSession === session)
                        this._action('stop');
                }
                return GLib.SOURCE_CONTINUE;
            });
        }
        if (!this._shortcut) return;
        // A hung/disconnected app must not leave a key swallowed in the shell.
        this._shortcutDeadline = GLib.get_monotonic_time() + 2_000_000;
        // Only the latest renewal owns this grab; late replies must not revoke it.
        const generation = ++this._shortcutGeneration;
        const release = () => {
            if (generation === this._shortcutGeneration) this._releaseShortcut();
        };
        this._call('ReserveStopShortcut', new GLib.Variant('(s)', [state.stopShortcutToken]), result => {
            if (result.deep_unpack()[0] !== true) release();
        }, release);
    }

    _releaseShortcut() {
        this._shortcutGeneration++;
        if (this._shortcutTimer) { GLib.source_remove(this._shortcutTimer); this._shortcutTimer = 0; }
        if (this._shortcut) {
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(this._shortcut), Shell.ActionMode.NONE);
            global.display.ungrab_accelerator(this._shortcut);
        }
        this._shortcut = 0;
        this._accelerator = null;
        this._stopPending = null;
    }

    _action(action) {
        const state = this._state;
        if (!state || (action === 'stop' ? !state.canStop : !state.canOpen)) return;
        this._stop.reactive = false;
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
        this._previousStatus = null;
        this._target = null;
        this._bars?.forEach(bar => bar.remove_all_transitions());
        this._clip?.remove_all_transitions();
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
        this._indicator?.hide();
    }

    _detach() {
        if (this._attached && this._owner)
            Gio.DBus.session.call(this._owner, PATH, INTERFACE, 'Detach', null, null,
                Gio.DBusCallFlags.NO_AUTO_START, 1000, null, null);
    }

    disable() {
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
