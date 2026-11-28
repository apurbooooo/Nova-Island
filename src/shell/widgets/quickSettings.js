import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {toolView} from './desktopShared.js';
import {Theme, bindTheme, box, card, icon, iconButton, inkFor, label, pillButton, rgbaCss} from '../ui/kit.js';

// Large tile: either a toggle (active state) or a launcher into GNOME's own controls.
function tile({name = null, iconName, title, callback, toggle = false}) {
    const content = box({style_class: 'nova-qs-tile-content', x_expand: true});
    const glyphBin = new St.Bin({style_class: 'nova-qs-tile-icon', child: icon(iconName, 16),
        y_align: Clutter.ActorAlign.CENTER});
    const text = box({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    const heading = label(title, 'nova-qs-tile-title');
    const state = label('', 'nova-qs-tile-state');
    text.add_child(heading);
    text.add_child(state);
    content.add_child(glyphBin);
    content.add_child(text);
    if (!toggle)
        content.add_child(icon('go-next-symbolic', 14, 'nova-faint'));
    const button = new St.Button({name, style_class: 'nova-qs-tile', child: content, x_expand: true,
        can_focus: true, reactive: true, accessible_name: title});
    button.connect('clicked', callback);
    let active = false;
    const paint = theme => {
        button.style = active ? `background-color: ${theme.accent}; color: ${inkFor(theme.accent)};` : '';
        glyphBin.style = active ? `background-color: ${rgbaCss(inkFor(theme.accent), 0.14)};` : '';
        state.style = active ? `color: ${rgbaCss(inkFor(theme.accent), 0.7)};` : '';
    };
    bindTheme(button, paint);
    return {
        actor: button,
        glyph: glyphBin.child,
        set(stateText, isActive = false) {
            state.text = stateText;
            active = isActive;
            if (toggle)
                button.accessible_name = `${title}, ${stateText}`;
            paint(Theme);
        },
    };
}

function sliderRow(iconName, accessibleName, onIcon) {
    const row = box({style_class: 'nova-qs-slider-row'});
    const toggle = iconButton({iconName, accessibleName, callback: onIcon,
        style_class: 'nova-icon-btn nova-icon-btn-filled'});
    const slider = new Slider(0);
    slider.add_style_class_name('nova-slider');
    slider.x_expand = true;
    slider.y_align = Clutter.ActorAlign.CENTER;
    slider.accessible_name = accessibleName;
    bindTheme(slider, theme => {
        slider.style = `-barlevel-active-background-color: ${theme.accent}; color: #ffffff;`;
    });
    const value = label('', 'nova-qs-value', {x_align: Clutter.ActorAlign.END});
    row.add_child(toggle);
    row.add_child(slider);
    row.add_child(value);
    return {row, toggle, slider, value};
}

export function createQuickSettingsWidget(lifecycle, onChanged, settings) {
    const view = toolView('quick-settings', _('Quick Settings'), {fit: {minWidth: 456, maxHeight: 520}});
    const control = Volume.getMixerControl();
    const actions = SystemActions.getDefault();
    const color = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'});
    const notifications = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
    const allowed = () => settings.get('quick-settings-enabled', false) && Main.sessionMode.hasWindows && !Main.sessionMode.isLocked;
    const native = () => {
        if (allowed()) {
            onChanged('close');
            Main.panel.statusArea.quickSettings.menu.open();
        }
    };

    const grid = box({vertical: true, style_class: 'nova-qs-grid', x_expand: true});
    const rowOne = box({style_class: 'nova-qs-row', x_expand: true});
    const rowTwo = box({style_class: 'nova-qs-row', x_expand: true});
    const network = tile({name: 'nova-quick-settings-network', iconName: 'network-wireless-symbolic',
        title: _('Wi-Fi & Bluetooth'), callback: native});
    network.set(_('Open network controls'));
    const audio = tile({name: 'nova-quick-settings-audio', iconName: 'audio-speakers-symbolic',
        title: _('Sound Output'), callback: native});
    const night = tile({name: 'nova-quick-settings-night-light', iconName: 'night-light-symbolic',
        title: _('Night Light'), toggle: true, callback: () => {
            if (allowed() && color.is_writable('night-light-enabled'))
                color.set_boolean('night-light-enabled', !color.get_boolean('night-light-enabled'));
        }});
    const dnd = tile({name: 'nova-quick-settings-dnd', iconName: 'notifications-disabled-symbolic',
        title: _('Do Not Disturb'), toggle: true, callback: () => {
            if (allowed() && notifications.is_writable('show-banners'))
                notifications.set_boolean('show-banners', !notifications.get_boolean('show-banners'));
        }});
    rowOne.add_child(network.actor);
    rowOne.add_child(audio.actor);
    rowTwo.add_child(night.actor);
    rowTwo.add_child(dnd.actor);
    grid.add_child(rowOne);
    grid.add_child(rowTwo);
    view.content.add_child(grid);

    const sliders = card('nova-qs-slider-card', true, {x_expand: true});
    let syncing = false;
    const volume = sliderRow('audio-volume-high-symbolic', _('Volume'), () => {
        const output = control.get_default_sink();
        if (output && allowed()) {
            output.change_is_muted(!output.is_muted);
            sync();
        }
    });
    volume.slider.connect('notify::value', () => {
        const output = control.get_default_sink();
        if (syncing || !output || !allowed())
            return;
        output.volume = Math.round(volume.slider.value * control.get_vol_max_norm());
        if (output.is_muted && volume.slider.value > 0)
            output.change_is_muted(false);
        output.push_volume();
        volume.value.text = `${Math.round(volume.slider.value * 100)}%`;
    });
    const brightness = sliderRow('display-brightness-symbolic', _('Brightness'), null);
    brightness.toggle.reactive = brightness.toggle.can_focus = false;
    brightness.slider.connect('notify::value', () => {
        const scale = Main.brightnessManager?.globalScale;
        if (syncing || !scale || !allowed())
            return;
        scale.value = Math.max(0, Math.min(1, brightness.slider.value));
        brightness.value.text = `${Math.round(brightness.slider.value * 100)}%`;
    });
    sliders.add_child(volume.row);
    sliders.add_child(brightness.row);
    view.content.add_child(sliders);

    const footer = box({style_class: 'nova-qs-footer', x_expand: true});
    const settingsButton = pillButton({text: _('NOVA Settings'), iconName: 'emblem-system-symbolic',
        callback: () => onChanged('preferences'), style_class: 'nova-btn nova-btn-ghost'});
    footer.add_child(settingsButton);
    footer.add_child(new St.Widget({x_expand: true}));
    const lock = pillButton({text: _('Lock'), iconName: 'system-lock-screen-symbolic', callback: () => {
        if (allowed() && actions.canLockScreen) {
            onChanged('close');
            actions.activateLockScreen();
        }
    }});
    const power = pillButton({text: _('Power Off…'), iconName: 'system-shutdown-symbolic', callback: () => {
        if (allowed() && actions.canPowerOff) {
            onChanged('close');
            actions.activatePowerOff();
        }
    }});
    footer.add_child(lock);
    footer.add_child(power);
    view.content.add_child(footer);

    let output = null;
    let outputSignal = 0;
    let brightnessScale = null;
    let brightnessSignal = 0;
    function sync() {
        const next = control.get_default_sink();
        if (next !== output) {
            if (output && outputSignal)
                output.disconnect(outputSignal);
            output = next;
            outputSignal = output ? output.connect('notify', () => sync()) : 0;
        }
        syncing = true;
        volume.row.visible = Boolean(output);
        if (output) {
            const level = output.volume / control.get_vol_max_norm();
            if (!volume.slider._dragging)
                volume.slider.value = Math.max(0, Math.min(1, output.is_muted ? 0 : level));
            volume.value.text = output.is_muted ? _('Muted') : `${Math.round(level * 100)}%`;
            volume.toggle.child.icon_name = output.is_muted ? 'audio-volume-muted-symbolic'
                : level < 0.34 ? 'audio-volume-low-symbolic' : level < 0.67
                    ? 'audio-volume-medium-symbolic' : 'audio-volume-high-symbolic';
            volume.toggle.accessible_name = output.is_muted ? _('Unmute') : _('Mute');
            const headphones = /head(phone|set)/i.test(output.get_port?.()?.human_port ?? '');
            audio.glyph.icon_name = headphones ? 'audio-headphones-symbolic' : 'audio-speakers-symbolic';
            audio.set(output.description || _('Default output'));
        } else {
            audio.set(_('No output device'));
        }
        const scale = Main.brightnessManager?.globalScale;
        if (scale !== brightnessScale) {
            if (brightnessScale && brightnessSignal)
                brightnessScale.disconnect(brightnessSignal);
            brightnessScale = scale;
            brightnessSignal = scale ? scale.connect('notify::value', sync) : 0;
        }
        brightness.row.visible = Boolean(scale);
        if (scale) {
            brightness.slider.value = Math.max(0, Math.min(1, scale.value));
            brightness.value.text = `${Math.round(scale.value * 100)}%`;
        }
        sliders.visible = volume.row.visible || brightness.row.visible;
        syncing = false;
        night.actor.visible = global.backend.get_monitor_manager().night_light_supported;
        const nightOn = color.get_boolean('night-light-enabled');
        night.set(nightOn ? _('On') : _('Off'), nightOn);
        const quiet = !notifications.get_boolean('show-banners');
        dnd.set(quiet ? _('On') : _('Off'), quiet);
        lock.visible = actions.canLockScreen;
        power.visible = actions.canPowerOff;
    }
    lifecycle.connect(control, 'default-sink-changed', sync);
    lifecycle.connect(actions, 'notify', sync);
    lifecycle.connect(color, 'changed::night-light-enabled', sync);
    lifecycle.connect(notifications, 'changed::show-banners', sync);
    if (Main.brightnessManager)
        lifecycle.connect(Main.brightnessManager, 'changed', sync);
    lifecycle.connect(global.backend.get_monitor_manager(), 'notify::night-light-supported', sync);
    lifecycle.connect(view.expanded, 'notify::mapped', () => { if (view.expanded.mapped) sync(); });
    lifecycle.add(() => {
        if (output && outputSignal)
            output.disconnect(outputSignal);
        if (brightnessScale && brightnessSignal)
            brightnessScale.disconnect(brightnessSignal);
    });
    sync();
    return {...view, configure: sync};
}
