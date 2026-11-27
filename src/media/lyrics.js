import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {HttpClient, MemoryCache} from './network.js';

const normalize = value => typeof value === 'string' ? value.trim().slice(0, 32000) : '';

const clean = value => normalize(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
export {parseLyrics} from './lyricTiming.js';
Gio._promisify(Gio.Subprocess.prototype, 'communicate_async');
const queryString = params => Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');

export class LyricsProvider {
    #network;
    #cache = new MemoryCache(24);
    #retryAfter = 0;

    constructor(network = new HttpClient()) {
        this.#network = network;
    }

    async load({title, artist, album, duration}, cancellable) {
        title = clean(title);
        artist = clean(artist);
        album = clean(album);
        if (!title || !artist)
            return {message: 'Title and artist are needed to look up lyrics.'};
        const params = {track_name: title, artist_name: artist};
        if (album)
            params.album_name = album;
        const seconds = Math.round(duration / 1000000);
        if (seconds >= 1 && seconds <= 3600)
            params.duration = seconds;
        const query = queryString(params);
        const cached = this.#cache.get(query);
        if (cached !== undefined)
            return cached;
        if (Date.now() < this.#retryAfter)
            return {message: 'Lyrics service is busy. Try again later.', retry: true};

        try {
            let data;
            try {
                data = await this.#request('get', query, cancellable, params);
            } catch (error) {
                if (error.status !== 404)
                    throw error;
                data = await this.#request('search', queryString({track_name: title, artist_name: artist}), cancellable, params);
                if (!data)
                    throw error;
            }
            this.#cache.put(query, data, 1800000);
            return data;
        } catch (error) {
            if (cancellable.is_cancelled())
                return null;
            if (error.status === 429 || error.status === 503)
                this.#retryAfter = Date.now() + (error.retryAfter ?? 60000);
            const busy = Date.now() < this.#retryAfter;
            const result = {message: busy ? 'Lyrics service is busy. Try again later.' :
                error.status === 404 ? 'Lyrics unavailable' : 'Could not load lyrics. Check your connection.',
                retry: error.status !== 404};
            this.#cache.put(query, result, error.status === 404 ? 300000 : 15000);
            return result;
        }
    }

    async #request(endpoint, query, cancellable, params) {
        const bytes = await this.#network.get(`https://lrclib.net/api/${endpoint}?${query}`, 1024 * 1024, cancellable);
        cancellable.set_error_if_cancelled();
        const worker = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('lyricsWorker.js').get_path();
        const proc = Gio.Subprocess.new(['gjs', '-m', worker, endpoint, JSON.stringify(params)],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
        const id = cancellable.connect(() => proc.force_exit());
        try {
            const [output] = await proc.communicate_async(new GLib.Bytes(bytes), cancellable);
            if (!proc.get_successful())
                throw new Error('Invalid lyrics response');
            return JSON.parse(new TextDecoder().decode(output.get_data()));
        } finally {
            if (id)
                cancellable.disconnect(id);
        }
    }

    destroy() {
        this.#network.destroy();
    }
}
