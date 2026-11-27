import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {HttpClient, MemoryCache, readLimited} from './network.js';

Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.File.prototype, 'read_async');
Gio._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_at_scale_async', 'new_from_stream_finish');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 4096;
const DECODE_SIZE = 200;

function dimensions(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (offset, value) => [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
    if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && tag(12, 'IHDR'))
        return [view.getUint32(16), view.getUint32(20)];
    if (bytes.length >= 30 && tag(0, 'RIFF') && tag(8, 'WEBP')) {
        if (tag(12, 'VP8X') && (bytes[20] & 2) === 0)
            return [1 + bytes[24] + 256 * bytes[25] + 65536 * bytes[26],
                1 + bytes[27] + 256 * bytes[28] + 65536 * bytes[29]];
        if (tag(12, 'VP8 ') && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a)
            return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
        if (tag(12, 'VP8L') && bytes[20] === 0x2f) {
            const size = view.getUint32(21, true);
            return [1 + (size & 0x3fff), 1 + ((size >>> 14) & 0x3fff)];
        }
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        for (let i = 2; i + 8 < bytes.length;) {
            if (bytes[i++] !== 0xff)
                break;
            while (bytes[i] === 0xff)
                i++;
            const marker = bytes[i++];
            if (marker === 0xda || marker === 0xd9 || i + 7 >= bytes.length)
                break;
            const length = view.getUint16(i);
            if (length < 2 || i + length > bytes.length)
                break;
            if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8)
                return [view.getUint16(i + 5), view.getUint16(i + 3)];
            i += length;
        }
    }
    return [0, 0];
}

export class ArtworkManager {
    #network = new HttpClient();
    #cache = new MemoryCache(20);

    #cacheEnabled = true;

    setCacheEnabled(enabled) {
        this.#cacheEnabled = enabled;
        if (!enabled)
            this.#cache.clear();
    }

    async load(uri, allowRemote, cancellable, trackKey = '') {
        if (!uri)
            return null;
        const remote = /^https?:\/\//i.test(uri);
        if (remote && !allowRemote)
            return null;
        // Some players overwrite a local cover at the same path for every track.
        const key = remote ? uri : JSON.stringify([uri, trackKey]);
        const cached = this.#cache.get(key);
        if (cached !== undefined)
            return cached;
        try {
            if (remote) {
                const location = GLib.Uri.parse(uri, GLib.UriFlags.NONE);
                if (location.get_scheme() === 'http' &&
                    !['127.0.0.1', '::1', 'localhost'].includes(location.get_host()))
                    throw new Error('Remote artwork requires HTTPS');
            }
            const bytes = remote ? await this.#network.get(uri, MAX_BYTES, cancellable)
                : await this.#local(uri, cancellable);
            const [width, height] = dimensions(bytes);
            if (!width || !height || width > MAX_SIDE || height > MAX_SIDE)
                throw new Error('Unsupported artwork format or dimensions');
            const stream = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(bytes));
            let pixbuf;
            try {
                pixbuf = await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream,
                    DECODE_SIZE, DECODE_SIZE, true, cancellable);
            } finally {
                stream.close(null); // In-memory stream, no file or network I/O.
            }
            if (cancellable.is_cancelled())
                return null;
            if (this.#cacheEnabled)
                this.#cache.put(key, pixbuf, 600000);
            return pixbuf;
        } catch (error) {
            if (!cancellable.is_cancelled()) {
                console.warn(`[NOVA Island] ${remote ? 'Remote' : 'Local'} artwork: ${error.message}`);
                if (this.#cacheEnabled)
                    this.#cache.put(key, null, 30000);
            }
            return null;
        }
    }

    async #local(uri, cancellable) {
        if (!/^file:\/\/(?:localhost)?\//i.test(uri))
            throw new Error('Artwork must be a local file URI');
        const file = Gio.File.new_for_uri(uri);
        if (!file.is_native())
            throw new Error('Artwork must be a native file');
        const info = await file.query_info_async('standard::type,standard::size',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, cancellable);
        if (info.get_file_type() !== Gio.FileType.REGULAR || info.get_size() > MAX_BYTES)
            throw new Error('Artwork is not a small regular file');
        const stream = await file.read_async(GLib.PRIORITY_DEFAULT, cancellable);
        return readLimited(stream, MAX_BYTES, cancellable);
    }

    destroy() {
        this.#cache.clear();
        this.#network.destroy();
    }
}
