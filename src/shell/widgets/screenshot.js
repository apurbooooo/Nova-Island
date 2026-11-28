import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Screenshot from 'resource:///org/gnome/shell/ui/screenshot.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {PortalRequest} from '../../desktop/portal.js';
import {readFile} from '../../desktop/io.js';
import {toolView} from './desktopShared.js';
import Clutter from 'gi://Clutter';
import {bindTheme, box, card, chip, icon, label, pillButton, rgbaCss, setChip, setEnabled} from '../ui/kit.js';

// Large action card: tinted icon, title, and description.
function actionCard({name, iconName, title, body, tint, callback}) {
    const content = box({vertical: true, style_class: 'nova-shot-card', x_expand: true});
    const badge = new St.Bin({style_class: 'nova-shot-icon', child: icon(iconName, 20),
        x_align: Clutter.ActorAlign.START});
    bindTheme(badge, theme => {
        const color = tint ?? theme.accent;
        badge.style = `background-color: ${rgbaCss(color, 0.18)}; color: ${color};`;
    });
    content.add_child(badge);
    content.add_child(label(title, 'nova-card-title'));
    content.add_child(label(body, 'nova-caption', {wrap: true}));
    const button = new St.Button({name, child: content, x_expand: true, can_focus: true, reactive: true,
        accessible_name: title, style_class: 'nova-card nova-card-button'});
    button.connect('clicked', callback);
    return button;
}

export function createScreenshotWidget(lifecycle, onChanged, settings) {
    const view = toolView('screenshot', _('Screenshot Studio'), {subtitle: _('Uses GNOME’s native capture tools'),
        fit: {minWidth: 456, maxHeight: 460}});
    const actions = box({style_class: 'nova-shot-actions', x_expand: true});
    view.content.add_child(actions);
    const result = card('', false, {x_expand: true, style: 'spacing: 12px;'});
    const preview = new St.Bin({style_class: 'nova-shot-preview', y_align: Clutter.ActorAlign.CENTER,
        child: icon('image-x-generic-symbolic', 20, 'nova-faint')});
    const resultText = box({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style: 'spacing: 4px;'});
    const resultTitle = label(_('No capture yet'), 'nova-card-title');
    const status = label(_('Choose screen, window, or area in GNOME’s capture controls.'), 'nova-caption', {wrap: true});
    const state = chip(_('Ready'), {tone: 'neutral'});
    state.x_align = Clutter.ActorAlign.START;
    resultText.add_child(resultTitle);
    resultText.add_child(status);
    resultText.add_child(state);
    result.add_child(preview);
    result.add_child(resultText);
    view.content.add_child(result);
    const buttons = box({style_class: 'nova-qs-footer', x_expand: true});
    view.content.add_child(buttons);
    let armed = false;
    let lastFile = null;
    let request = null;
    let job = new Gio.Cancellable();
    let generation = 0;
    let destroyed = false;
    const allowed = () => settings.get('screenshot-enabled', false) && Main.sessionMode.hasWindows && !Main.sessionMode.isLocked;
    const cancel = () => {
        generation++;
        armed = false;
        lastFile = null;
        request?.cancel();
        request = null;
        job.cancel();
        job = new Gio.Cancellable();
    };
    actions.add_child(actionCard({name: 'nova-screenshot-capture', iconName: 'camera-photo-symbolic',
        title: _('Screenshot'), body: _('Screen, window, or a selected area'), callback: async () => {
        if (!allowed())
            return;
        onChanged('close');
        armed = true;
        try { await Main.screenshotUI.open(); }
        catch { armed = false; setStatus(_('Capture unavailable'), 'danger', _('Unavailable')); }
    }}));
    actions.add_child(actionCard({name: 'nova-screenshot-record', iconName: 'media-record-symbolic',
        title: _('Record'), body: _('Full screen or an area, with GNOME’s stop control'), tint: '#ff7a7a',
        callback: () => {
            if (allowed()) {
                onChanged('close');
                armed = false;
                Screenshot.showScreenRecordingUI();
            }
        }}));
    const save = pillButton({text: _('Save a copy…'), iconName: 'document-save-symbolic', name: 'nova-screenshot-save',
        x_expand: true, callback: async () => {
        if (!lastFile || request || !allowed())
            return;
        const file = lastFile;
        const current = generation;
        const currentRequest = new PortalRequest();
        request = currentRequest;
        const uri = await currentRequest.saveFile(_('Save screenshot'), file.get_basename());
        if (request === currentRequest)
            request = null;
        if (!uri || destroyed || generation !== current || !allowed()) {
            if (!destroyed && generation === current)
                setStatus(_('Save cancelled or unavailable'), 'neutral', _('Cancelled'));
            return;
        }
        const destination = Gio.File.new_for_uri(uri);
        if (!destination.is_native()) {
            setStatus(_('Choose a local file'), 'warning', _('Not saved'));
            return;
        }
        file.copy_async(destination, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, job, null,
            (_file, result) => {
                try {
                    file.copy_finish(result);
                    if (!destroyed && generation === current)
                        setStatus(_('Saved a copy.'), 'success', _('Saved'));
                } catch {
                    if (!destroyed && generation === current)
                        setStatus(_('Could not save screenshot'), 'danger', _('Error'));
                }
            });
    }});
    const copy = pillButton({text: _('Copy image'), iconName: 'edit-copy-symbolic', name: 'nova-screenshot-copy',
        x_expand: true, primary: true, callback: async () => {
        if (!lastFile || !allowed())
            return;
        const current = generation;
        try {
            const bytes = await readFile(lastFile.get_path(), job, 20 * 1024 * 1024);
            if (!destroyed && generation === current && allowed()) {
                St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'image/png', bytes);
                setStatus(_('Image copied to the clipboard.'), 'success', _('Copied'));
            }
        } catch {
            if (!destroyed && generation === current)
                setStatus(_('Image unavailable or too large'), 'danger', _('Error'));
        }
    }});
    buttons.add_child(save);
    buttons.add_child(copy);
    const setReady = ready => {
        setEnabled(save, ready);
        setEnabled(copy, ready);
        copy.opacity = ready ? 255 : 120;
        if (!ready) {
            preview.style = null;
            preview.child.visible = true;
            resultTitle.text = _('No capture yet');
        }
    };
    function setStatus(text, tone, chipText) {
        status.text = text;
        setChip(state, chipText, tone);
        onChanged(false);
    }
    setReady(false);
    lifecycle.connect(Main.screenshotUI, 'screenshot-taken', (_ui, file) => {
        if (!armed || !allowed())
            return;
        armed = false;
        lastFile = file;
        setReady(true);
        resultTitle.text = file.get_basename();
        preview.child.visible = false;
        preview.style = `background-image: url("${file.get_uri()}");`;
        setStatus(_('Captured and copied to the clipboard by GNOME.'), 'success', _('Captured'));
    });
    lifecycle.connect(Main.screenshotUI, 'closed', () => { armed = false; });
    lifecycle.connect(Main.sessionMode, 'updated', () => {
        if (!allowed()) {
            cancel();
            setReady(false);
        }
    });
    lifecycle.add(() => { destroyed = true; cancel(); job.cancel(); });
    return {...view, configure() {
        if (!allowed()) {
            cancel();
            setReady(false);
        }
    }};
}
