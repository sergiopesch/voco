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
        // The grab held now: {accelerator, action, heartbeatId, reserving}, or null.
        this._grab = null;
        this._activatedId = global.display.connect('accelerator-activated', (_display, action) => {
            if (this._grab && action === this._grab.action)
                this._onPressed();
        });
    }

    // Grabs accelerator, or releases the grab for null.
    hold(accelerator) {
        const held = this._grab ? this._grab.accelerator : null;
        if (accelerator === held)
            return;
        this.release();
        if (!accelerator)
            return;
        const action = global.display.grab_accelerator(accelerator, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT);
        if (action === Meta.KeyBindingAction.NONE)
            return;
        const grab = {accelerator, action, heartbeatId: 0, reserving: false};
        this._grab = grab;
        // Ordinary and fullscreen windows and the overview; Shell modals filter it.
        Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action),
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
        this._renew(grab);
        grab.heartbeatId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._renew(grab);
            return GLib.SOURCE_CONTINUE;
        });
    }

    // VOCO mutes its passive listener only while renewals arrive. One is in
    // flight at a time, so a hung app times out and the grab is released. A
    // reply about a grab that is no longer held never acts on a newer one.
    _renew(grab) {
        if (grab.reserving)
            return;
        grab.reserving = true;
        this._reserve(grab.accelerator, accepted => {
            if (grab !== this._grab)
                return;
            grab.reserving = false;
            if (!accepted)
                this.release();
        }, () => {
            if (grab === this._grab)
                this._onLost();
        });
    }

    release() {
        const grab = this._grab;
        if (!grab)
            return;
        this._grab = null;
        GLib.Source.remove(grab.heartbeatId);
        Main.wm.allowKeybinding(Meta.external_binding_name_for_action(grab.action), Shell.ActionMode.NONE);
        global.display.ungrab_accelerator(grab.action);
    }

    destroy() {
        this.release();
        global.display.disconnect(this._activatedId);
    }
}
