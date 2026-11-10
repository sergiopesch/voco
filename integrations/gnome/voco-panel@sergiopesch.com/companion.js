import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {VocoIndicator} from './indicator.js';
import {presentation} from './model.js';
import {Paster, modifiersClear} from './paster.js';
import {Shortcut} from './shortcut.js';
import {SHELL_MAJOR} from './version.js';

// Under the maintainer's own domain, as the Snap Store requires of the snap's
// dbus slot. A VOCO from before this name owns only org.voco.Panel, so this
// copy never attaches to it.
const NAME = 'com.sergiopesch.voco.Panel';
const PATH = '/com/sergiopesch/voco/Panel';
const INTERFACE = 'com.sergiopesch.voco.Panel1';
// VOCO answers a pending NextRequest within 20 s, so the call never expires first.
const REQUEST_TIMEOUT_MS = 30000;
// GNOME 50 removed X11 sessions together with Meta.is_wayland_compositor().
const isWayland = () => SHELL_MAJOR >= 50 || Meta.is_wayland_compositor();

// Speaks VOCO's panel protocol while VOCO owns its name: shows its state in the
// pill, holds its shortcut and types the pastes it asks for.
export class Companion {
    constructor(extensionPath, uuid) {
        this._owner = null;
        this._state = null;
        this._attached = false;
        this._polling = false;
        this._refreshQueued = false;
        this._requesting = false;
        // The poll, request and retry timeouts, by name.
        this._sources = new Map();
        // Every call of the current attachment carries this. It is cancelled and
        // replaced when the attachment ends, so no late reply is ever read.
        this._cancellable = new Gio.Cancellable();
        this._indicator = new VocoIndicator(extensionPath, action => this._action(action));
        Main.panel.addToStatusArea(uuid, this._indicator, 0, 'right');
        this._paster = new Paster((method, parameters) => this._call(method, parameters, () => {}, () => {}));
        // The consumed chord is the ordinary toggle; VOCO decides Start or Stop.
        this._shortcut = new Shortcut({
            onPressed: () => this._call('Action', new GLib.Variant('(ss)', ['shortcut', '']), () => {}),
            reserve: (accelerator, done, failed) =>
                this._call('ReserveShortcut', new GLib.Variant('(s)', [accelerator]), result => done(result.deep_unpack()[0] === true), failed),
            onLost: () => this._retry(),
        });
        this._watchId = Gio.bus_watch_name(Gio.BusType.SESSION, NAME, Gio.BusNameWatcherFlags.NONE,
            (_connection, _name, owner) => {
                this._owner = owner;
                this._cancelCalls();
                this._attach();
            }, () => {
                this._owner = null;
                this._disconnect();
            });
    }

    destroy() {
        // A gesture cut short is uncertain to VOCO. Sent without the cancellable
        // that is about to be cancelled.
        const cancelled = this._paster.cancel();
        if (cancelled !== null)
            this._send('PasteRefused', new GLib.Variant('(us)', [cancelled, 'Disabled']));
        this._send('Detach', null);
        this._disconnect();
        this._cancellable.cancel();
        this._cancellable = null;
        Gio.bus_unwatch_name(this._watchId);
        this._owner = null;
        this._shortcut.destroy();
        this._shortcut = null;
        this._paster.destroy();
        this._paster = null;
        this._indicator.destroy();
        this._indicator = null;
    }

    _call(method, parameters, done, failed = () => this._retry()) {
        // Pinned to the unique owner, so an in-flight call can't reach a replacement app.
        const cancellable = this._cancellable;
        Gio.DBus.session.call(this._owner, PATH, INTERFACE, method, parameters, null,
            Gio.DBusCallFlags.NO_AUTO_START, 1500, cancellable, (connection, result) => {
                if (cancellable.is_cancelled())
                    return;
                try {
                    done(connection.call_finish(result));
                } catch (error) {
                    failed(error);
                }
            });
    }

    // Fire and forget, outside any attachment: VOCO ignores what it no longer expects.
    _send(method, parameters) {
        if (this._attached && this._owner) {
            Gio.DBus.session.call(this._owner, PATH, INTERFACE, method, parameters, null,
                Gio.DBusCallFlags.NO_AUTO_START, 1000, null, null);
        }
    }

    _attach() {
        this._call('Attach', null, result => {
            this._attached = result.deep_unpack()[0] === true;
            if (!this._attached)
                return;
            this._poll();
            this._armRequest();
        });
    }

    // A confined VOCO can answer the Shell but not call it, so the companion
    // asks VOCO for work: one NextRequest stays pending, re-armed as soon as
    // VOCO answers.
    _armRequest() {
        if (!this._attached || this._requesting)
            return;
        this._requesting = true;
        const cancellable = this._cancellable;
        Gio.DBus.session.call(this._owner, PATH, INTERFACE, 'NextRequest', null, new GLib.VariantType('(su)'),
            Gio.DBusCallFlags.NO_AUTO_START, REQUEST_TIMEOUT_MS, cancellable, (connection, result) => {
                if (cancellable.is_cancelled())
                    return;
                this._requesting = false;
                let request;
                try {
                    request = connection.call_finish(result).deep_unpack();
                } catch (_error) {
                    this._schedule('request', 1000, () => this._armRequest());
                    return;
                }
                this._armRequest();
                const [kind, id] = request;
                if (kind === 'paste')
                    this._paster.paste(id);
                else if (kind === 'modifiers')
                    this._call('ModifiersState', new GLib.Variant('(ub)', [id, modifiersClear()]), () => {}, () => {});
                else if (kind === 'changed')
                    this._poll();
            });
    }

    _poll() {
        if (!this._attached)
            return;
        if (this._polling) {
            this._refreshQueued = true;
            return;
        }
        this._polling = true;
        // This read replaces a scheduled one: a 'changed' request polls at once.
        this._unschedule('poll');
        this._call('GetState', null, result => {
            if (!this._attached)
                return;
            this._polling = false;
            const state = presentation(JSON.parse(result.deep_unpack()[0]));
            this._state = state;
            // Consumed whenever attached, idle included, so the focused app never
            // also acts on it. X11 keeps VOCO's own exclusive global shortcut.
            this._shortcut.hold(isWayland() ? state.shortcutAccelerator : null);
            this._indicator.update(state);
            // Only recording streams levels; statuses arrive as 'changed' work.
            const delay = this._refreshQueued ? 1 : state.status === 'recording' ? 50 : 1500;
            this._refreshQueued = false;
            this._schedule('poll', delay, () => this._poll());
        });
    }

    _action(action) {
        const state = this._state;
        if (!state || !(action === 'stop' ? state.canStop : action === 'quit' ? state.canQuit : state.canOpen))
            return;
        this._indicator.menu.close();
        this._call('Action', new GLib.Variant('(ss)', [action, action === 'stop' ? state.stopSession : state.token]), () => {});
    }

    _retry() {
        this._send('Detach', null);
        this._disconnect();
        if (this._owner)
            this._schedule('retry', 2000, () => this._attach());
    }

    // Runs callback once after delayMs, in place of what key had scheduled.
    _schedule(key, delayMs, callback) {
        this._unschedule(key);
        this._sources.set(key, GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._sources.delete(key);
            callback();
            return GLib.SOURCE_REMOVE;
        }));
    }

    _unschedule(key) {
        if (this._sources.has(key)) {
            GLib.Source.remove(this._sources.get(key));
            this._sources.delete(key);
        }
    }

    _cancelCalls() {
        this._cancellable.cancel();
        this._cancellable = new Gio.Cancellable();
    }

    _disconnect() {
        this._shortcut.release();
        this._cancelCalls();
        this._attached = false;
        this._polling = false;
        this._refreshQueued = false;
        this._requesting = false;
        this._state = null;
        for (const sourceId of this._sources.values())
            GLib.Source.remove(sourceId);
        this._sources.clear();
        this._indicator.reset();
    }
}
