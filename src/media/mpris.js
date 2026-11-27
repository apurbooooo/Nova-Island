import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio, 'bus_get');
Gio._promisify(Gio.DBusConnection.prototype, 'call');
Gio._promisify(Gio.DBusProxy, 'new', 'new_finish');
Gio._promisify(Gio.DBusProxy.prototype, 'call');

const BUS = 'org.freedesktop.DBus';
const PROPERTIES = 'org.freedesktop.DBus.Properties';
const PATH = '/org/mpris/MediaPlayer2';
const ROOT = 'org.mpris.MediaPlayer2';
const PLAYER = `${ROOT}.Player`;
export const NAME_PREFIX = `${ROOT}.`;
const playerName = name => name.startsWith(NAME_PREFIX) && name.length > NAME_PREFIX.length;
const clampPosition = (value, duration) => Math.max(0, Math.min(value, duration || Number.MAX_SAFE_INTEGER));
const microseconds = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const text = (value, max = 512) => typeof value === 'string' ? value.trim().slice(0, max) : '';

class MprisClient {
    #connection;
    #player;
    #root;
    #owner;
    #cancellable;
    #ids = [];
    #position = 0;
    #checkedAt;
    #now;
    #status = 'Stopped';
    #rate = 1;
    #track;
    #positionVersion = 0;
    #readOnly = new Set();

    constructor(connection, name, root, player, cancellable, changed, now) {
        this.#now = now;
        this.#connection = connection;
        this.name = name;
        this.#root = root;
        this.#player = player;
        this.#owner = player.get_name_owner();
        this.#cancellable = cancellable;
        this.#track = this.#readTrack();
        this.#status = this.status;
        this.#rate = this.#playbackRate();
        this.#markPosition(microseconds(this.#get('Position')));
        this.#ids.push([root, root.connect('g-properties-changed', () => changed(this))]);
        this.#ids.push([player, player.connect('g-properties-changed', (_proxy, properties) => {
            const track = this.#readTrack();
            const reset = track.key !== this.#track.key;
            const position = this.position;
            this.#track = track;
            const status = this.status;
            const rate = this.#playbackRate();
            const reported = properties.lookup_value('Position', null);
            if (reset || status !== this.#status || rate !== this.#rate) {
                this.#markPosition(reset ? 0 : position);
                this.#status = status;
                this.#rate = rate;
                if (!reported && status !== 'Stopped')
                    this.#refreshPosition(() => changed(this));
            }
            if (reported)
                this.#markPosition(microseconds(reported.deepUnpack()));
            changed(this, reset);
        })]);
        this.#ids.push([player, player.connect('g-signal', (_proxy, _sender, signal, parameters) => {
            if (signal === 'Seeked') {
                this.#markPosition(microseconds(parameters.deepUnpack()[0]));
                changed(this);
            }
        })]);
        this.#refreshPosition(() => changed(this));
        this.#checkWritable(() => changed(this));
    }

    #get(key) {
        return this.#player.get_cached_property(key)?.recursiveUnpack();
    }

    #playbackRate() {
        const rate = this.#get('Rate');
        return Number.isFinite(rate) ? rate : 1;
    }

    get identity() {
        return text(this.#root.get_cached_property('Identity')?.deepUnpack()) || this.name.slice(NAME_PREFIX.length);
    }

    get status() {
        const status = this.#get('PlaybackStatus');
        return ['Playing', 'Paused', 'Stopped'].includes(status) ? status : 'Stopped';
    }

    get track() {
        return this.#track;
    }

    #readTrack() {
        const meta = this.#get('Metadata') ?? {};
        const title = text(meta['xesam:title']);
        const artist = Array.isArray(meta['xesam:artist'])
            ? meta['xesam:artist'].slice(0, 12).map(value => text(value, 128)).filter(Boolean).join(', ') : text(meta['xesam:artist']);
        const album = text(meta['xesam:album']);
        const id = text(meta['mpris:trackid']);
        return {
            title, artist, album,
            key: title || artist ? JSON.stringify([id, title, artist, album]) : '',
            artwork: text(meta['mpris:artUrl'] || meta['mpris:ArtUrl'] || meta.artUrl || meta.ArtUrl, 4096),
            duration: microseconds(meta['mpris:length']),
        };
    }

    get rate() {
        return this.#rate;
    }

    get position() {
        if (this.#status === 'Stopped')
            return 0;
        const elapsed = this.#status === 'Playing' ? (this.#now() - this.#checkedAt) * this.#rate : 0;
        return clampPosition(this.#position + elapsed, this.track.duration);
    }

    get capabilities() {
        const control = this.#get('CanControl') === true;
        return Object.fromEntries(Object.entries({
            play: this.#get('CanPlay'), pause: this.#get('CanPause'),
            next: this.#get('CanGoNext'), previous: this.#get('CanGoPrevious'), seek: this.#get('CanSeek'),
            shuffle: typeof this.#get('Shuffle') === 'boolean' && !this.#readOnly.has('Shuffle'),
            repeat: ['None', 'Track', 'Playlist'].includes(this.#get('LoopStatus')) && !this.#readOnly.has('LoopStatus'),
        }).map(([key, value]) => [key, control && value === true]));
    }

    get shuffle() {
        return this.#get('Shuffle') === true;
    }

    get repeat() {
        return this.#get('LoopStatus') ?? 'None';
    }

    #markPosition(value) {
        this.#positionVersion++;
        this.#position = value;
        this.#checkedAt = this.#now();
    }

    async #refreshPosition(changed) {
        const version = this.#positionVersion;
        try {
            const [position] = (await this.#properties('Get', new GLib.Variant('(ss)', [PLAYER, 'Position']))).recursiveUnpack();
            if (version === this.#positionVersion && !this.#cancellable.is_cancelled()) {
                this.#markPosition(microseconds(position));
                changed();
            }
        } catch {
            // Position is optional in incomplete players; continue from the last known sample.
        }
    }

    async #checkWritable(changed) {
        try {
            const [xml] = (await this.#connection.call(this.#owner, PATH, 'org.freedesktop.DBus.Introspectable',
                'Introspect', null, new GLib.VariantType('(s)'), Gio.DBusCallFlags.NO_AUTO_START,
                2500, this.#cancellable)).deepUnpack();
            if (this.#cancellable.is_cancelled() || xml.length > 65536)
                return;
            const iface = Gio.DBusNodeInfo.new_for_xml(xml).lookup_interface(PLAYER);
            for (const key of ['Shuffle', 'LoopStatus']) {
                const property = iface?.lookup_property(key);
                if (property && !(property.flags & Gio.DBusPropertyInfoFlags.WRITABLE))
                    this.#readOnly.add(key);
            }
            changed();
        } catch {
            // Some players expose properties without a useful introspection document.
        }
    }

    #properties(method, args) {
        return this.#connection.call(this.#owner, PATH, PROPERTIES, method, args, null,
            Gio.DBusCallFlags.NO_AUTO_START, 2500, this.#cancellable);
    }

    async command(action, amount = 0) {
        if (action === 'toggle')
            action = this.status === 'Playing' ? 'pause' : 'play';
        if (!this.capabilities[action] || this.#cancellable.is_cancelled())
            return false;

        const methods = {play: 'Play', pause: 'Pause', next: 'Next', previous: 'Previous', seek: 'Seek'};
        try {
            if (action === 'shuffle' || action === 'repeat') {
                const loop = {None: 'Playlist', Playlist: 'Track', Track: 'None'};
                const property = action === 'shuffle'
                    ? ['Shuffle', new GLib.Variant('b', !this.shuffle)]
                    : ['LoopStatus', new GLib.Variant('s', loop[this.repeat])];
                await this.#properties('Set', new GLib.Variant('(ssv)', [PLAYER, ...property]));
            } else {
                const args = action === 'seek' ? new GLib.Variant('(x)', [amount]) : null;
                await this.#connection.call(this.#owner, PATH, PLAYER, methods[action], args, null,
                    Gio.DBusCallFlags.NO_AUTO_START, 2500, this.#cancellable);
            }
            return true;
        } catch (error) {
            const remote = Gio.DBusError.get_remote_error(error);
            if (['org.freedesktop.DBus.Error.PropertyReadOnly', 'org.freedesktop.DBus.Error.NotSupported',
                'org.freedesktop.DBus.Error.UnknownProperty', 'org.freedesktop.DBus.Error.InvalidArgs'].includes(remote)) {
                if (action === 'shuffle')
                    this.#readOnly.add('Shuffle');
                if (action === 'repeat')
                    this.#readOnly.add('LoopStatus');
            }
            return false;
        }
    }

    destroy() {
        this.#cancellable.cancel();
        for (const [proxy, id] of this.#ids)
            proxy.disconnect(id);
    }
}

export class MediaManager {
    #changed;
    #cancellable = new Gio.Cancellable();
    #entries = new Map();
    #connection;
    #signal = 0;
    #preferences = {};
    #active = null;

    #now;

    constructor(changed, now = () => GLib.get_monotonic_time()) {
        this.#now = now;
        this.#changed = changed;
        this.#discover();
    }

    get players() {
        return [...this.#entries.values()].flatMap(entry => entry.client ? [entry.client] : [])
            .sort((a, b) => a.identity.localeCompare(b.identity) || a.name.localeCompare(b.name));
    }

    get active() {
        return this.#active;
    }

    configure(preferences) {
        this.#preferences = preferences;
        this.#update();
    }

    #update(client, trackChanged) {
        const players = this.players;
        const {last, preferred, priority = []} = this.#preferences;
        const rank = name => {
            const index = priority.indexOf(name);
            return index === -1 ? Number.MAX_SAFE_INTEGER : index;
        };
        const previous = this.#active;
        this.#active = players.find(player => player.name === last) ??
            players.find(player => player.name === preferred) ??
            players.sort((a, b) => Number(b.status === 'Playing') - Number(a.status === 'Playing') ||
                rank(a.name) - rank(b.name) || Number(b === previous) - Number(a === previous))[0] ??
            null;
        this.#changed(Boolean(trackChanged && client === this.#active && client.status === 'Playing' && client.track.key));
    }

    async #discover() {
        try {
            this.#connection = await Gio.bus_get(Gio.BusType.SESSION, this.#cancellable);
            if (this.#cancellable.is_cancelled())
                return;
            this.#signal = this.#connection.signal_subscribe(BUS, BUS, 'NameOwnerChanged',
                '/org/freedesktop/DBus', ROOT, Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE,
                (_conn, _sender, _object, _iface, _signal, args) => {
                    const [name, , owner] = args.deepUnpack();
                    if (!playerName(name))
                        return;
                    this.#remove(name);
                    if (owner)
                        this.#add(name);
                });
            const [names] = (await this.#connection.call(BUS, '/org/freedesktop/DBus', BUS, 'ListNames',
                null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, 2500, this.#cancellable)).deepUnpack();
            if (!this.#cancellable.is_cancelled())
                names.filter(playerName).forEach(name => this.#add(name));
        } catch {
            // The session bus may shut down before startup completes.
        }
    }

    async #add(name) {
        if (this.#entries.has(name) || this.#cancellable.is_cancelled())
            return;
        const cancellable = new Gio.Cancellable();
        const entry = {cancellable, client: null};
        this.#entries.set(name, entry);
        try {
            const make = iface => Gio.DBusProxy.new(this.#connection,
                Gio.DBusProxyFlags.DO_NOT_AUTO_START, null, name, PATH, iface, cancellable);
            const [root, player] = await Promise.all([make(ROOT), make(PLAYER)]);
            if (cancellable.is_cancelled() || !player.get_name_owner() ||
                root.get_name_owner() !== player.get_name_owner() ||
                !root.get_cached_property('Identity') || !player.get_cached_property('PlaybackStatus'))
                return;
            entry.client = new MprisClient(this.#connection, name, root, player, cancellable,
                (client, changed) => this.#update(client, changed), this.#now);
            this.#update();
        } catch {
            // A player can disappear before its interfaces are ready.
        }
    }

    #remove(name) {
        const entry = this.#entries.get(name);
        if (!entry)
            return;
        entry.client?.destroy();
        entry.cancellable.cancel();
        this.#entries.delete(name);
        this.#update();
    }

    destroy() {
        this.#cancellable.cancel();
        if (this.#signal)
            this.#connection.signal_unsubscribe(this.#signal);
        for (const entry of this.#entries.values()) {
            entry.client?.destroy();
            entry.cancellable.cancel();
        }
        this.#entries.clear();
        this.#active = null;
    }
}
