import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Holds VOCO's dictation chord, so the focused app never also acts on it, for
// as long as VOCO keeps confirming the reservation.
export class Shortcut {
    // onPressed() runs on each press. reserve(accelerator, done, failed) asks
    // VOCO to keep the reservation: done(accepted) with its answer, failed()
    // when the call fails, after which onLost() runs.
    constructor({onPressed, reserve, onLost}) {
        this._onPressed = onPressed;
        this._reserve = reserve;
        this._onLost = onLost;
        this._action = 0;
        this._accelerator = null;
        this._heartbeatId = 0;
        this._reserving = false;
        // Late replies about an earlier grab must never act on a newer one.
        this._generation = 0;
        this._activatedId = global.display.connect('accelerator-activated', (_display, action) => {
            if (this._action && action === this._action)
                this._onPressed();
        });
    }

    // Grabs accelerator, or releases the grab for null.
    hold(accelerator) {
        if (accelerator === this._accelerator)
            return;
        this.release();
        if (!accelerator)
            return;
        const action = global.display.grab_accelerator(accelerator, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT);
        if (action === Meta.KeyBindingAction.NONE)
            return;
        this._action = action;
        this._accelerator = accelerator;
        // Ordinary and fullscreen windows and the overview; Shell modals filter it.
        Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action),
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
        this._renew();
        if (this._heartbeatId)
            GLib.Source.remove(this._heartbeatId);
        this._heartbeatId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._renew();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // VOCO mutes its passive listener only while renewals arrive. One is in
    // flight at a time, so a hung app times out and the grab is released.
    _renew() {
        if (this._reserving)
            return;
        this._reserving = true;
        const generation = this._generation;
        this._reserve(this._accelerator, accepted => {
            if (generation !== this._generation)
                return;
            this._reserving = false;
            if (!accepted)
                this.release();
        }, () => {
            if (generation === this._generation)
                this._onLost();
        });
    }

    release() {
        this._generation++;
        this._reserving = false;
        if (this._heartbeatId) {
            GLib.Source.remove(this._heartbeatId);
            this._heartbeatId = 0;
        }
        if (this._action) {
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(this._action), Shell.ActionMode.NONE);
            global.display.ungrab_accelerator(this._action);
        }
        this._action = 0;
        this._accelerator = null;
    }

    destroy() {
        this.release();
        global.display.disconnect(this._activatedId);
    }
}
