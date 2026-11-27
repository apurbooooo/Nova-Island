import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS = 'org.freedesktop.portal.Desktop';
const PATH = '/org/freedesktop/portal/desktop';
const REQUEST = 'org.freedesktop.portal.Request';
Gio._promisify(Gio.DBusConnection.prototype, 'call');

// Subscribe before sending so immediate refusals cannot race with the Response signal.
export class PortalRequest {
    constructor(connection = Gio.DBus.session) {
        this.connection = connection;
        this.cancellable = new Gio.Cancellable();
        this.path = null;
        this.signal = 0;
        this.timeout = 0;
        this.resolve = null;
    }

    async saveFile(title, filename) {
        const token = `nova_${GLib.uuid_string_random().replace(/-/g, '')}`;
        const sender = this.connection.get_unique_name().slice(1).replace(/\./g, '_');
        this.path = `/org/freedesktop/portal/desktop/request/${sender}/${token}`;
        const response = new Promise(resolve => this.resolve = resolve);
        this.signal = this.connection.signal_subscribe(BUS, REQUEST, 'Response', this.path, null,
            Gio.DBusSignalFlags.NONE, (_connection, _sender, _path, _interface, _signal, parameters) => {
                const [code, results] = parameters.recursiveUnpack();
                this.finish(code === 0 ? results.uris?.[0] ?? null : null);
            });
        this.timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 120, () => {
            this.timeout = 0;
            this.cancel();
            return GLib.SOURCE_REMOVE;
        });
        try {
            const [path] = (await this.connection.call(BUS, PATH, 'org.freedesktop.portal.FileChooser', 'SaveFile',
                new GLib.Variant('(ssa{sv})', ['', title, {
                    handle_token: new GLib.Variant('s', token), current_name: new GLib.Variant('s', filename),
                }]), new GLib.VariantType('(o)'), Gio.DBusCallFlags.NONE, 10000, this.cancellable)).deepUnpack();
            if (path !== this.path)
                this.cancel();
        } catch {
            this.finish(null);
        }
        return response;
    }

    finish(value) {
        if (this.signal)
            this.connection.signal_unsubscribe(this.signal);
        this.signal = 0;
        if (this.timeout)
            GLib.Source.remove(this.timeout);
        this.timeout = 0;
        this.resolve?.(value);
        this.resolve = null;
    }

    cancel() {
        this.cancellable.cancel();
        if (this.path) {
            this.connection.call(BUS, this.path, REQUEST, 'Close', null, null,
                Gio.DBusCallFlags.NONE, 1000, null).catch(() => {});
        }
        this.finish(null);
    }
}
