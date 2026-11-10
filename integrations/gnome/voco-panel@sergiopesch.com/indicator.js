import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {barScales} from './model.js';
import {SHELL_MAJOR} from './version.js';

// Holds the meter at its natural size against the microphone, so opening and
// closing uncover it in place: only the pill's outer edge moves.
const Reveal = GObject.registerClass(class VocoReveal extends St.Widget {
    vfunc_allocate(box) {
        this.set_allocation(box);
        const child = this.get_first_child();
        if (!child.visible)
            return;
        const [, width] = child.get_preferred_width(-1);
        const [, height] = child.get_preferred_height(width);
        const x = this.get_text_direction() === Clutter.TextDirection.RTL ? 0 : Math.floor(box.get_width() - width);
        const y = Math.floor((box.get_height() - height) / 2);
        child.allocate(Clutter.ActorBox.new(x, y, x + width, y + height));
    }
});

// The VOCO pill in the top bar: microphone, live meter and menu. It shows the
// state it's given and hands each chosen action to onAction.
export const VocoIndicator = GObject.registerClass(class VocoIndicator extends PanelMenu.Button {
    _init(extensionPath, onAction) {
        super._init(0, 'VOCO');
        this._onAction = onAction;
        this._state = null;
        this._barsKey = null;
        this._target = null;
        this.can_focus = false;
        this.add_style_class_name('voco-panel');
        this.hide();
        this._buildPill(extensionPath);
        this._buildMenu();
        // The Shell's own view of reduced motion: the desktop's setting, and off
        // while the Shell inhibits animations.
        this._settings = St.Settings.get();
        this._motionId = this._settings.connect('notify::enable-animations', () => this._render());
        this._panelWidthId = Main.panel.connect('notify::width', () => this._render());
    }

    _buildPill(extensionPath) {
        // The button is the pill GNOME highlights on hover, focus and an open
        // menu, so VOCO's tint and the theme's fills share one shape. A primary
        // click anywhere on it stops or opens VOCO; other mouse buttons open the menu.
        this._button = new St.Button({style_class: 'voco-panel-button', can_focus: true, accessible_name: 'VOCO'});
        this.add_child(this._button);
        // GNOME 50's panel button opens its menu from a click gesture that wins
        // any press, which would cancel the pill's own primary click. Leave
        // primary presses and touches to the pill. Earlier Shells open the menu
        // from the press event, which the pill already stops.
        if (SHELL_MAJOR >= 50) {
            for (const gesture of this.get_actions()) {
                if (gesture instanceof Clutter.ClickGesture) {
                    gesture.connect('should-handle-sequence', (_gesture, event) =>
                        event.type() !== Clutter.EventType.TOUCH_BEGIN && event.get_button() !== Clutter.BUTTON_PRIMARY);
                }
            }
        }
        this._button.connect('clicked', () => this._onAction(this._state?.canStop ? 'stop' : 'open'));
        this._button.connect('key-focus-in', () => this.add_style_pseudo_class('focus'));
        this._button.connect('key-focus-out', () => this.remove_style_pseudo_class('focus'));
        this._button.connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            const shiftF10 = symbol === Clutter.KEY_F10 && event.get_state() & Clutter.ModifierType.SHIFT_MASK;
            if (symbol !== Clutter.KEY_Menu && !shiftF10)
                return Clutter.EVENT_PROPAGATE;
            this.menu.toggle();
            return Clutter.EVENT_STOP;
        });
        this._box = new St.BoxLayout();
        this._button.set_child(this._box);
        // The top bar's right side grows leftward, so the microphone comes last
        // and never moves: the meter opens and closes on its left.
        this._clip = new Reveal({clip_to_allocation: true, width: 0});
        // The panel packs fractional widths unevenly, which jolts every indicator
        // on this side; the meter eases through whole pixels only.
        this._reveal = new St.Adjustment({actor: this._clip, upper: 1000});
        this._revealId = this._reveal.connect('notify::value', () => {
            this._clip.width = Math.round(this._reveal.value);
            // A fixed-width actor already awaiting layout passes no relayout up,
            // so widths the panel measured this frame would stay cached.
            this._box.queue_relayout();
        });
        this._detail = new St.BoxLayout({style_class: 'voco-panel-detail', visible: false});
        this._clip.add_child(this._detail);
        this._box.add_child(this._clip);
        this._box.add_child(new St.Icon({style_class: 'voco-panel-icon', y_align: Clutter.ActorAlign.CENTER,
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(`${extensionPath}/voco-symbol.png`)), icon_size: 20}));
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
    }

    _buildMenu() {
        const item = (label, action) => {
            const menuItem = new PopupMenu.PopupMenuItem(label);
            menuItem.connect('activate', () => this._onAction(action));
            this.menu.addMenuItem(menuItem);
            return menuItem;
        };
        this._settingsItem = item('Settings', 'settings');
        this._reviewItem = item('Review', 'review');
        this._stopItem = item('Stop dictation', 'stop');
        this._quitSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._quitSeparator);
        this._quitItem = item('Quit VOCO', 'quit');
    }

    // Shows VOCO's state, as model.js's presentation() returns it.
    update(state) {
        this._state = state;
        this.show();
        this._render();
    }

    // Hides the pill, closed: a reconnect must not replay a stale expansion.
    reset() {
        this._state = null;
        this._barsKey = null;
        this._target = null;
        this._bars.forEach(bar => bar.remove_all_transitions());
        this._reveal.remove_transition('value');
        this._reveal.value = 0;
        this._detail.hide();
        this._button.remove_style_class_name('voco-panel-active');
        this.hide();
    }

    _render() {
        const state = this._state;
        if (!state)
            return;
        const motion = this._settings.enable_animations;
        const action = state.canStop ? 'Stop dictation' : state.canOpen ? 'Open settings' : '';
        this._button.accessible_name = [state.description, action].filter(Boolean).join('. ');
        const wave = state.active;
        const label = !state.active && state.label.length > 0;
        // A closing meter keeps its last content until the clip hides it.
        if (wave || label) {
            this._wave.visible = wave;
            this._label.visible = label;
            if (label)
                this._label.text = state.label;
        }
        this._settingsItem.setSensitive(state.canOpen);
        this._reviewItem.setSensitive(state.canOpen);
        this._stopItem.visible = state.canStop;
        this._stopItem.setSensitive(state.canStop);
        this._quitSeparator.visible = this._quitItem.visible = state.quitOffered;
        this._quitItem.setSensitive(state.canQuit);
        this._renderBars(state, motion);
        if (state.status !== 'idle')
            this._button.add_style_class_name('voco-panel-active');
        else
            this._button.remove_style_class_name('voco-panel-active');
        this._renderMeter(wave, label, motion);
    }

    // Only new levels, statuses or motion settings move the bars; the
    // processing pulse runs until the status changes.
    _renderBars(state, motion) {
        const processing = state.status === 'processing';
        const scales = barScales(state.level);
        const bars = `${processing}:${motion}:${scales}`;
        if (bars === this._barsKey)
            return;
        this._barsKey = bars;
        this._bars.forEach((bar, index) => {
            bar.remove_all_transitions();
            const scale = processing ? 0.35 : scales[index];
            const duration = scale >= bar.scale_y ? 45 : 100;
            bar.ease({scale_y: scale, duration: motion ? duration : 0, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            // Processing uses a restrained pulse; listening only reflects real levels.
            bar.opacity = 255;
            if (processing && motion) {
                bar.ease({opacity: 90, duration: 700, delay: index * 40,
                    autoReverse: true, repeatCount: -1, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE});
            }
        });
    }

    // Opens the meter only if the whole right side, meter included, still fits
    // beside the clock. A crowded panel keeps just the actionable icon.
    _renderMeter(wave, label, motion) {
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
        const target = (wave || label) && row - this._clip.width + natural + reserve <= space ? Math.ceil(natural) : 0;
        if (this._target === target)
            return;
        this._target = target;
        // Closed content leaves the accessibility tree as well as the view.
        if (target)
            this._detail.show();
        this._reveal.ease(target, {duration: motion && this._clip.mapped ? 220 : 0,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (!target)
                    this._detail.hide();
            }});
    }

    // The pill, meter and menu items are children, destroyed with it, signal
    // handlers included; the handlers on objects it doesn't own are removed here.
    destroy() {
        this._reveal.remove_transition('value');
        this._reveal.disconnect(this._revealId);
        this._settings.disconnect(this._motionId);
        Main.panel.disconnect(this._panelWidthId);
        super.destroy();
    }
});
