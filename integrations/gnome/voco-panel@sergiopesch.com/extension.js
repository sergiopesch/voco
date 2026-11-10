import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Companion} from './companion.js';

export default class VocoPanel extends Extension {
    enable() {
        this._companion = new Companion(this.path, this.uuid);
    }

    disable() {
        this._companion.destroy();
        this._companion = null;
    }
}
