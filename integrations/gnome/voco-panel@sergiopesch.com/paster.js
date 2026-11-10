import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {SHELL_MAJOR} from './version.js';

// A paste sends only these, evdev codes as VOCO's uinput keyboard declares
// them, with VOCO's 12 ms between events.
const KEY_SHIFT = 42;
const KEY_INSERT = 110;
const PASTE_GAP_MS = 12;
// What a held shortcut leaves pressed: Shift+Insert under it is another chord.
const MODIFIERS = Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.CONTROL_MASK |
    Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.SUPER_MASK |
    Clutter.ModifierType.META_MASK | Clutter.ModifierType.HYPER_MASK |
    Clutter.ModifierType.MOD4_MASK | Clutter.ModifierType.MOD5_MASK;

// Observes compositor state; never synthesizes releases of the user's keys.
export function modifiersClear() {
    return (global.get_pointer()[2] & MODIFIERS) === 0;
}

// Types VOCO's paste through one Clutter virtual keyboard inside the Shell: no
// device to settle, portal dialog or screen-sharing indicator. GNOME disables
// the extension at the lock screen, so it can't type there.
export class Paster {
    // report(method, parameters) sends PasteDone or PasteRefused to VOCO.
    constructor(report) {
        this._report = report;
        this._keyboard = null;
        this._paste = null;
    }

    // Shift, Insert and their releases, PASTE_GAP_MS apart, then PasteDone with
    // the Insert press's monotonic time for VOCO's paste-read detection. A
    // refusal sends no key and says why.
    paste(id) {
        if (this._paste) {
            this._report('PasteRefused', new GLib.Variant('(us)', [id, 'Busy']));
            return;
        }
        if (!modifiersClear()) {
            this._report('PasteRefused', new GLib.Variant('(us)', [id, 'ModifiersHeld']));
            return;
        }
        // GNOME 48 and later reach the seat through the stage's context; GNOME 51
        // removed Clutter.get_default_backend(), which GNOME 46 still needs.
        const backend = SHELL_MAJOR >= 48 ? global.stage.context.get_backend() : Clutter.get_default_backend();
        this._keyboard ??= backend.get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const keyboard = this._keyboard;
        const paste = {id, sourceId: 0, held: new Set(), insertUs: 0};
        this._paste = paste;
        const key = (code, pressed) => {
            keyboard.notify_key(GLib.get_monotonic_time(), code,
                pressed ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED);
            if (pressed)
                paste.held.add(code);
            else
                paste.held.delete(code);
        };
        const steps = [
            () => key(KEY_SHIFT, true),
            () => {
                key(KEY_INSERT, true);
                paste.insertUs = GLib.get_monotonic_time();
            },
            () => key(KEY_INSERT, false),
            () => key(KEY_SHIFT, false),
        ];
        let next = 0;
        const run = () => {
            paste.sourceId = 0;
            steps[next++]();
            if (next < steps.length) {
                paste.sourceId = GLib.timeout_add(GLib.PRIORITY_HIGH, PASTE_GAP_MS, run);
                return GLib.SOURCE_REMOVE;
            }
            this._paste = null;
            this._report('PasteDone', new GLib.Variant('(ut)', [id, paste.insertUs]));
            return GLib.SOURCE_REMOVE;
        };
        run();
    }

    // Stops a gesture in progress and releases what it holds, so no key stays
    // down. Returns its request ID, which VOCO must hear was cut short, or null.
    cancel() {
        const paste = this._paste;
        if (!paste)
            return null;
        this._paste = null;
        if (paste.sourceId)
            GLib.Source.remove(paste.sourceId);
        for (const code of paste.held)
            this._keyboard.notify_key(GLib.get_monotonic_time(), code, Clutter.KeyState.RELEASED);
        return paste.id;
    }

    destroy() {
        this.cancel();
        this._keyboard = null;
    }
}
