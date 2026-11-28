import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ClipboardHistory, sensitiveText} from '../src/desktop/clipboardHistory.js';
import {searchEmoji, addRecent} from '../src/desktop/emoji.js';
import {cpuSample, cpuUsage, memoryUsage, networkSample, networkRate} from '../src/desktop/metrics.js';
import {PortalRequest} from '../src/desktop/portal.js';
import {readFile} from '../src/desktop/io.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
let now = 0;
const history = new ClipboardHistory(() => now);
history.limit = 2;
history.maxAge = 100;
history.add('text/plain', 'one', 3, 'one');
history.items[0].pinned = true;
history.add('text/plain', 'two', 3, 'two');
history.add('text/plain', 'three', 5, 'three');
assert(history.items.length === 2 && history.items.some(item => item.data === 'one'), 'pin evicted early');
assert(history.search('THREE').length === 1, 'case insensitive search');
now = 101;
history.prune();
assert(history.items.length === 1 && history.items[0].pinned, 'retention expiry');
history.maxBytes = 2;
history.prune();
assert(history.items.length === 0, 'pinned item bypassed hard limit');
history.add('image/png', 'base64', 1, 'PNG image');
history.add('image/png', 'base64', 1, 'PNG image');
assert(history.items.length === 1, 'duplicate image');
history.clear();
assert(!history.items.length, 'clear retains entries');
assert(sensitiveText('password=secret') && sensitiveText('123456') && sensitiveText('private work', ['private']), 'secret filter');
assert(!sensitiveText('Hello world'), 'ordinary text filtered');
assert(searchEmoji('heart').length >= 4 && searchEmoji('kaomoji hug').length === 1, 'emoji search');
assert(searchEmoji('not-a-real-emoji').length === 0, 'unknown search');
const recent = addRecent(addRecent([], '😀'), '😀');
assert(recent.length === 1 && searchEmoji('', recent)[0][0] === '😀', 'recent ordering');
const first = cpuSample('cpu  100 0 100 800 0 0 0 0 0 0\n');
const second = cpuSample('cpu  150 0 150 900 0 0 0 0 0 0\n');
assert(cpuUsage(first, second) === 50 && cpuUsage(second, first) === null, 'CPU delta/reset');
assert(memoryUsage('MemTotal: 1000 kB\nMemAvailable: 400 kB').used === 600 * 1024, 'memory units');
assert(memoryUsage('missing') === null, 'missing memory fabricated');
const net = networkSample(' lo: 90 0 0 0 0 0 0 0 80 0 0 0 0 0 0 0\n eth0: 20 0 0 0 0 0 0 0 40 0 0 0 0 0 0 0');
assert(!net.lo && networkRate({eth0: {rx: 10, tx: 20}}, net, 2).tx === 10, 'network deltas');
assert(networkRate(net, {eth0: {rx: 0, tx: 0}}, 1).rx === 0, 'network reset');

// Mock portal transport exercises immediate cancellation, success, refusal, and missing service.
for (const code of [0, 1, 2]) {
    let callback;
    let unsubscribed = 0;
    const connection = {
        get_unique_name: () => ':1.42',
        signal_subscribe(_sender, _interface, _member, path, _arg, _flags, handler) { callback = handler; this.path = path; return 1; },
        signal_unsubscribe() { unsubscribed++; },
        async call() {
            callback(null, null, null, null, null, new GLib.Variant('(ua{sv})', [code, {uris: new GLib.Variant('as', ['file:///tmp/test.png'])}]));
            return new GLib.Variant('(o)', [this.path]);
        },
    };
    const request = new PortalRequest(connection);
    assert(await request.saveFile('Save', 'image.png') === (code === 0 ? 'file:///tmp/test.png' : null), 'portal response');
    assert(unsubscribed === 1 && request.signal === 0 && request.timeout === 0, 'portal cleanup');
}
const unavailable = new PortalRequest({get_unique_name: () => ':1.5', signal_subscribe: () => 1,
    signal_unsubscribe() {}, async call() { throw new Error('No portal'); }});
assert(await unavailable.saveFile('Save', 'image.png') === null, 'portal failure');
let closed = 0;
let disconnected = 0;
const pending = new PortalRequest({get_unique_name: () => ':1.8', signal_subscribe: () => 1,
    signal_unsubscribe() { disconnected++; },
    async call(_bus, _path, _interface, method) {
        if (method === 'Close')
            closed++;
        return new GLib.Variant('(o)', ['/org/freedesktop/portal/desktop/request/1_8/mock']);
    }});
const pendingResult = pending.saveFile('Save', 'image.png');
pending.cancel();
assert(await pendingResult === null && closed >= 1 && disconnected === 1 && !pending.timeout,
    'pending portal cancellation leaked');
const cancelled = new Gio.Cancellable();
cancelled.cancel();
try {
    await readFile('/proc/stat', cancelled);
    throw new Error('cancelled read succeeded');
} catch (error) {
    assert(error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED), 'unexpected cancellation error');
}
print('PASS clipboard bounds, pins, expiry, sensitive filters; emoji search/recents; metric deltas; mock portal success/refusal/failure; cancelled I/O');
