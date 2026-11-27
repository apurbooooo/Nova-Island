import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ClipboardHistory, sensitiveText} from './clipboardHistory.js';

const MAX_TRANSFER = 2 * 1024 * 1024;

export class ClipboardManager {
    constructor(settings, changed) {
        this.settings = settings;
        this.changed = changed;
        this.history = new ClipboardHistory();
        this.selection = global.display.get_selection();
        this.signal = 0;
        this.job = null;
        this.generation = 0;
        this.deadline = 0;
        this.expiry = 0;
        this.sessionSignal = Main.sessionMode.connect('updated', () => {
            this.cancel();
            if (Main.sessionMode.isLocked)
                this.history.clear();
            this.configure();
            this.changed();
        });
        this.configure();
    }

    allowed() {
        return this.settings.get('clipboard-enabled', false) && this.settings.get('clipboard-capture', false) &&
            Main.sessionMode.hasWindows && !Main.sessionMode.isLocked;
    }

    cancel() {
        this.generation++;
        this.job?.cancel();
        this.job = null;
        if (this.deadline)
            GLib.Source.remove(this.deadline);
        this.deadline = 0;
    }

    configure() {
        this.cancel();
        this.history.limit = this.settings.get('clipboard-limit', 30);
        this.history.maxAge = this.settings.get('clipboard-retention', 30) * 60000;
        this.history.prune();
        if (this.allowed() && !this.signal) {
            this.signal = this.selection.connect('owner-changed', (_selection, type) => {
                if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                    this.capture();
            });
            this.expiry = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
                this.history.prune();
                this.changed();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!this.allowed() && this.signal) {
            this.selection.disconnect(this.signal);
            this.signal = 0;
            GLib.Source.remove(this.expiry);
            this.expiry = 0;
        }
        if (!this.settings.get('clipboard-enabled', false) || !this.settings.get('clipboard-capture', false))
            this.history.clear();
    }

    capture() {
        this.cancel();
        if (!this.allowed())
            return;
        const type = Meta.SelectionType.SELECTION_CLIPBOARD;
        const mimes = this.selection.get_mimetypes(type) ?? [];
        // Password managers advertise this hint to prevent clipboard retention.
        if (mimes.includes('x-kde-passwordManagerHint'))
            return;
        const mime = mimes.includes('image/png') ? 'image/png' :
            ['text/plain;charset=utf-8', 'text/plain'].find(value => mimes.includes(value));
        if (!mime)
            return;
        const generation = this.generation;
        const cancellable = new Gio.Cancellable();
        this.job = cancellable;
        const stream = Gio.MemoryOutputStream.new_resizable();
        this.deadline = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            this.deadline = 0;
            cancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });
        this.selection.transfer_async(type, mime, MAX_TRANSFER + 1, stream, cancellable, (_selection, result) => {
            try {
                this.selection.transfer_finish(result);
                stream.close(null);
                if (generation !== this.generation || cancellable.is_cancelled() || !this.allowed())
                    return;
                const bytes = stream.steal_as_bytes();
                if (!bytes.get_size() || bytes.get_size() > MAX_TRANSFER)
                    return;
                const image = mime === 'image/png';
                const text = image ? '' : new TextDecoder('utf-8', {fatal: true}).decode(bytes.get_data());
                if (!image && (!text.trim() || sensitiveText(text, this.settings.get('clipboard-exclusions', []))))
                    return;
                this.history.add(image ? 'image/png' : 'text/plain', image ? GLib.base64_encode(bytes.get_data()) : text,
                    bytes.get_size(), image ? 'PNG image' : text);
                this.changed();
            } catch {
                // Unavailable, cancelled, invalid UTF-8, or refused by the selection owner.
            } finally {
                stream.close(null);
                if (generation === this.generation)
                    this.cancel();
            }
        });
    }

    copy(item) {
        this.cancel();
        const clipboard = St.Clipboard.get_default();
        if (item.type === 'image/png')
            clipboard.set_content(St.ClipboardType.CLIPBOARD, item.type, new GLib.Bytes(GLib.base64_decode(item.data)));
        else
            clipboard.set_text(St.ClipboardType.CLIPBOARD, item.data);
    }

    clear() {
        this.cancel();
        this.history.clear();
        this.changed();
    }

    destroy() {
        this.cancel();
        if (this.signal)
            this.selection.disconnect(this.signal);
        if (this.expiry)
            GLib.Source.remove(this.expiry);
        Main.sessionMode.disconnect(this.sessionSignal);
        this.history.clear();
    }
}
