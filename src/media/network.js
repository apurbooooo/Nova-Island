import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async');
Gio._promisify(Gio.InputStream.prototype, 'close_async');
Gio._promisify(Soup.Session.prototype, 'send_async');

const PRIORITY = GLib.PRIORITY_DEFAULT;

export async function readLimited(stream, maxBytes, cancellable) {
    try {
        const chunks = [];
        let total = 0;
        while (total <= maxBytes) {
            const chunk = await stream.read_bytes_async(Math.min(16384, maxBytes + 1 - total), PRIORITY, cancellable);
            if (chunk.get_size() === 0) {
                const data = new Uint8Array(total);
                let offset = 0;
                for (const bytes of chunks) {
                    data.set(bytes, offset);
                    offset += bytes.length;
                }
                return data;
            }
            total += chunk.get_size();
            chunks.push(chunk.get_data());
        }
        throw new Error('Response exceeds its size limit');
    } finally {
        await stream.close_async(PRIORITY, null);
    }
}

export class HttpClient {
    #session = new Soup.Session({timeout: 8, idle_timeout: 12, user_agent: 'NOVA-Island/0.3.2'});

    async get(uri, maxBytes, cancellable) {
        const parsed = GLib.Uri.parse(uri, GLib.UriFlags.NONE);
        if (!['http', 'https'].includes(parsed.get_scheme()) || !parsed.get_host() || parsed.get_userinfo())
            throw new Error('Unsupported network URI');

        const job = new Gio.Cancellable();
        if (cancellable.is_cancelled())
            job.cancel();
        const cancelId = cancellable.connect(() => job.cancel());
        let timeout = GLib.timeout_add_once(PRIORITY, 10000, () => {
            timeout = 0;
            job.cancel();
        });
        try {
            const message = Soup.Message.new('GET', uri);
            message.add_flags(Soup.MessageFlags.NO_REDIRECT);
            const stream = await this.#session.send_async(message, PRIORITY, job);
            const status = message.get_status();
            const headers = message.get_response_headers();
            if (status !== 200 || headers.get_content_length() > maxBytes) {
                await stream.close_async(PRIORITY, null);
                const error = new Error(status === 200 ? 'Response exceeds its size limit' : `HTTP ${status}`);
                error.status = status;
                const retry = headers.get_one('Retry-After');
                const delay = /^\d+$/.test(retry ?? '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
                error.retryAfter = Number.isFinite(delay) ? Math.max(1000, delay) : 60000;
                throw error;
            }
            return await readLimited(stream, maxBytes, job);
        } finally {
            if (timeout)
                GLib.Source.remove(timeout);
            if (cancelId)
                cancellable.disconnect(cancelId);
        }
    }

    destroy() {
        this.#session.abort();
    }
}

export class MemoryCache {
    #items = new Map();

    constructor(limit) {
        this.limit = limit;
    }

    clear() {
        this.#items.clear();
    }

    get(key) {
        const item = this.#items.get(key);
        if (!item)
            return undefined;
        this.#items.delete(key);
        if (item.until <= Date.now())
            return undefined;
        this.#items.set(key, item);
        return item.value;
    }

    put(key, value, ttl) {
        this.#items.delete(key);
        this.#items.set(key, {value, until: Date.now() + ttl});
        if (this.#items.size > this.limit)
            this.#items.delete(this.#items.keys().next().value);
    }
}
