import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.DBusConnection, 'new_for_address', 'new_for_address_finish');
Gio._promisify(Gio.DBusConnection.prototype, 'call');
Gio._promisify(Gio.DBusConnection.prototype, 'close');

const root = '<node><interface name="org.mpris.MediaPlayer2">' +
    '<property name="Identity" type="s" access="read"/></interface></node>';
const playerInterface = 'org.mpris.MediaPlayer2.Player';
const types = {PlaybackStatus: 's', Metadata: 'a{sv}', Position: 'x', Rate: 'd', CanControl: 'b',
    CanPlay: 'b', CanPause: 'b', CanGoNext: 'b', CanGoPrevious: 'b', CanSeek: 'b', Shuffle: 'b', LoopStatus: 's'};
const methods = ['Play', 'Pause', 'Next', 'Previous'].map(name => `<method name="${name}"/>`).join('');
const path = '/org/mpris/MediaPlayer2';

export async function mockPlayer(suffix, identity, {playing = false, artwork = '', limited = false} = {}) {
    const flags = Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION;
    const connection = await Gio.DBusConnection.new_for_address(GLib.getenv('DBUS_SESSION_BUS_ADDRESS'),
        flags, null, null);
    const name = `org.mpris.MediaPlayer2.${suffix}`;
    const writable = new Set(limited ? [] : ['Shuffle', 'LoopStatus']);
    const properties = Object.entries(types).filter(([key]) => key !== 'LoopStatus' || !limited)
        .map(([key, type]) => `<property name="${key}" type="${type}" access="${writable.has(key) ? 'readwrite' : 'read'}"/>`).join('');
    const playerXml = `<node><interface name="${playerInterface}">${methods}${properties}
        <method name="Seek"><arg direction="in" type="x"/></method>
        <signal name="Seeked"><arg type="x"/></signal></interface></node>`;
    const calls = [];
    let serial = 0;
    const metadata = title => ({
        'mpris:trackid': new GLib.Variant('o', `/track/${++serial}`),
        'mpris:length': new GLib.Variant('x', 120000000),
        'mpris:artUrl': new GLib.Variant('s', artwork),
        'xesam:title': new GLib.Variant('s', title),
        'xesam:artist': new GLib.Variant('as', ['NOVA Test Artist']),
        'xesam:album': new GLib.Variant('s', 'NOVA Test Album'),
    });
    const model = {
        PlaybackStatus: playing ? 'Playing' : 'Paused',
        Metadata: metadata(`${identity} first track`),
        Position: 15000000, Rate: 1, CanControl: true, CanPause: true, CanPlay: true,
        CanGoNext: !limited, CanGoPrevious: !limited, CanSeek: !limited, Shuffle: false, LoopStatus: 'None',
    };
    const set = (key, value) => {
        model[key] = value;
        player.emit_property_changed(key, new GLib.Variant(types[key], value));
        player.flush();
    };
    const target = {
        Play() {
            calls.push('Play');
            set('PlaybackStatus', 'Playing');
        },
        Pause() {
            calls.push('Pause');
            set('PlaybackStatus', 'Paused');
        },
        Next() { calls.push('Next'); },
        Previous() { calls.push('Previous'); },
        Seek(amount) {
            calls.push(['Seek', amount]);
            model.Position += amount;
            player.emit_signal('Seeked', new GLib.Variant('(x)', [model.Position]));
        },
    };
    for (const key of Object.keys(model)) {
        Object.defineProperty(target, key, {
            get: () => model[key],
            set: value => set(key, value),
        });
    }
    const base = Gio.DBusExportedObject.wrapJSObject(root, {Identity: identity});
    const player = Gio.DBusExportedObject.wrapJSObject(playerXml, target);
    base.export(connection, path);
    player.export(connection, path);
    await connection.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
        'RequestName', new GLib.Variant('(su)', [name, 0]), null, Gio.DBusCallFlags.NONE, 3000, null);
    return {
        name, calls, model, set,
        seekTo(position) {
            model.Position = position;
            player.emit_signal('Seeked', new GLib.Variant('(x)', [position]));
        },
        changeTrack(title) { set('Metadata', metadata(title)); },
        async close() {
            if (connection.is_closed())
                return;
            player.unexport();
            base.unexport();
            await connection.close(null);
        },
    };
}

export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMoX3oJAAOFAe+H+mq0AAAAAElFTkSuQmCC';
