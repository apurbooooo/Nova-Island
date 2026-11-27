import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {ArtworkManager} from '../src/media/artwork.js';
import {LyricsProvider, parseLyrics} from '../src/media/lyrics.js';
import {MediaManager} from '../src/media/mpris.js';
import {activeCue, cueAt} from '../src/media/lyricTiming.js';
import {mockPlayer, PNG} from './mockMpris.js';


function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

async function waitFor(condition, description) {
    for (let i = 0; i < 180; i++) {
        if (condition())
            return;
        await new Promise(resolve => GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 20, resolve));
    }
    throw new Error(`Timed out: ${description}`);
}

async function checkMpris() {
    let trackChanges = 0;
    const a = await mockPlayer('NovaOne', 'NOVA One');
    let now = 0;
    const manager = new MediaManager(track => trackChanges += Number(track), () => now);
    let b;
    try {
        await waitFor(() => manager.active?.name === a.name, 'initial discovery');
        b = await mockPlayer('NovaTwo', 'NOVA Two', {playing: true, limited: true});
        await waitFor(() => manager.players.length === 2 && manager.active?.name === b.name, 'new player and playing priority');
        assert(!await manager.active.command('next') && !await manager.active.command('repeat'),
            'Unsupported controls were allowed');
        assert(!await manager.active.command('shuffle'), 'Read-only shuffle write succeeded');
        assert(!manager.active.capabilities.shuffle, 'Rejected shuffle was not marked unavailable');
        manager.configure({last: a.name});
        const player = manager.active;
        assert(player.track.artist === 'NOVA Test Artist' && player.track.album === 'NOVA Test Album' &&
            player.track.duration === 120000000, 'Bad metadata unpack');
        assert(await player.command('toggle'), 'Play failed');
        await waitFor(() => player.status === 'Playing', 'playback status');
        a.changeTrack('Test replacement track');
        await waitFor(() => trackChanges === 1 && player.track.title === 'Test replacement track', 'track event');
        assert(await player.command('seek', 10000000), 'Seek failed');
        await waitFor(() => player.position >= 25000000, 'Seeked position');
        assert(await player.command('pause'), 'Pause failed');
        await waitFor(() => player.status === 'Paused', 'paused anchor');
        a.seekTo(5000000);
        await waitFor(() => player.position === 5000000, 'backward seek');
        now += 800000;
        assert(player.position === 5000000, 'Paused position advanced');
        a.set('Rate', 2);
        await player.command('play');
        await waitFor(() => player.status === 'Playing', 'resume');
        a.seekTo(6000000);
        await waitFor(() => player.position === 6000000, 'resume anchor');
        now += 250000;
        assert(player.position === 6500000, '2x interpolation');
        a.set('Position', 119900000);
        await waitFor(() => player.position === 119900000, 'reported position property');
        now += 1000000;
        assert(player.position === 120000000, 'Duration clamp');
        a.set('PlaybackStatus', 'Stopped');
        await waitFor(() => player.position === 0, 'stop resets position');
        assert(await player.command('shuffle') && await player.command('repeat'), 'Shuffle or repeat failed');
        assert(await player.command('next') && await player.command('previous'), 'Track controls failed');
        await waitFor(() => player.shuffle && player.repeat === 'Playlist', 'updated status');
        assert(a.calls.includes('Play') && a.calls.includes('Pause') &&
            a.calls.includes('Next') && a.calls.includes('Previous'), 'Missing method calls');
        const pending = player.command('next');
        await a.close();
        await pending;
        await waitFor(() => manager.active?.name === b.name, 'player departure');
        print('PASS MPRIS discovery, properties, track events, controls, capability checks, switching, and departure');
    } finally {
        manager.destroy();
        await a.close();
        await b?.close();
    }
}

async function checkArtworkAndLyrics() {
    const asset = new ArtworkManager();
    const cancel = new Gio.Cancellable();
    const [descriptor, path] = GLib.file_open_tmp('nova-cover-XXXXXX');
    GLib.close(descriptor);
    const png = GLib.base64_decode(PNG);
    GLib.file_set_contents(path, png);
    const local = Gio.File.new_for_path(path).get_uri();
    const server = new Soup.Server();
    let requests = 0;
    server.add_handler('/cover.png', (_server, message) => {
        requests++;
        message.set_status(200, null);
        message.set_response('image/png', Soup.MemoryUse.COPY, png);
    });
    server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
    const uri = server.get_uris()[0].to_string() + 'cover.png';
    try {
        assert(await asset.load(local, false, cancel), 'Valid local PNG failed');
        assert(!await asset.load('file:///nonexistent/nova-cover.png', false, cancel), 'Missing artwork was accepted');
        assert(!await asset.load(uri, false, cancel) && requests === 0, 'Disabled remote artwork made a request');
        const image = await asset.load(uri, true, cancel);
        assert(image && image === await asset.load(uri, true, cancel) && requests === 1, 'Remote artwork cache failed');
        asset.setCacheEnabled(false);
        await asset.load(uri, true, cancel);
        await asset.load(uri, true, cancel);
        assert(requests === 3, 'Disabling the artwork cache did not clear and bypass it');
        print('PASS local and HTTP artwork, remote permission, missing-art fallback, and cache');
    } finally {
        asset.destroy();
        server.disconnect();
        GLib.unlink(path);
    }
    const lrc = parseLyrics('[offset:+100]\n[00:04.10]Second\n[00:01.5][00:02.2]First');
    assert(lrc.length === 3 && lrc[0].seconds === 1.4 && lrc[2].text === 'Second', 'Bad LRC parsing');
    const source = [
        'lines:', '- text: "One, two!\\nThree"', '  start_ms: 2000', '  end_ms: 5000', '  words:',
        '  - {text: "One,", start_ms: 2100, end_ms: 2400}', '  - {text: "two!", start_ms: 2700}',
        '  - {text: "Three", start_ms: 3900}', '- {text: After, start_ms: 6000}',
    ].join('\n');
    const record = {hasWordSync: true, lyricsfile: source, syncedLyrics: '[00:02]Fallback'};
    const mock = new LyricsProvider({get: () => new TextEncoder().encode(JSON.stringify(record)), destroy() {}});
    const songKey = {artist: 'Sample', title: 'Word fixture'};
    const {mode, timed} = await mock.load(songKey, cancel);
    assert(mode === 'word' && timed.length === 2 && cueAt(timed, 1.999) === -1 && activeCue(timed, 2) === 0,
        'Word document and line onset');
    assert(activeCue(timed, 5) === -1 && activeCue(timed, 6) === 1, 'Line gap and next onset');
    const words = timed[0].words;
    assert(activeCue(words, 2.099) === -1 && activeCue(words, 2.1) === 0 && activeCue(words, 2.4) === -1 &&
        activeCue(words, 2.7) === 1 && timed[0].text.slice(words[2].start, words[2].end) === 'Three', 'Word timing or layout');
    record.lyricsfile = 'lines: [{text: untimed, words: [{text: untimed}]}]';
    assert((await mock.load({...songKey, title: 'Missing stamps'}, cancel)).mode === 'line', 'False word timing');
    mock.destroy();
    let lyricRequests = 0;
    const provider = new LyricsProvider({
        get() {
            lyricRequests++;
            if (lyricRequests === 1)
                return new TextEncoder().encode(JSON.stringify({plainLyrics: 'Untimed line'}));
            throw Object.assign(new Error('rate limit'), {status: 429, retryAfter: 60000});
        },
        destroy() {},
    });
    const song = {artist: 'Test artist', title: 'Track'};
    assert((await provider.load(song, cancel)).plain === 'Untimed line', 'Plain lyrics missing');
    assert((await provider.load(song, cancel)).timed.length === 0 && lyricRequests === 1, 'Plain lyrics were marked timed');
    assert((await provider.load({...song, title: 'Second'}, cancel)).message.includes('busy'), 'Network error not reported');
    assert((await provider.load({...song, title: 'Third'}, cancel)).message.includes('busy') &&
        lyricRequests === 2, 'Rate-limit cooldown ignored');
    provider.destroy();
    let misses = 0;
    const absent = new LyricsProvider({
        get() {
            misses++;
            throw Object.assign(new Error('not found'), {status: 404});
        },
        destroy() {},
    });
    assert((await absent.load(song, cancel)).message === 'Lyrics unavailable', 'A missing match was not reported');
    await absent.load(song, cancel);
    assert(misses === 2, 'Missing lyrics were requested twice');
    absent.destroy();
    const fallback = new LyricsProvider({
        get(uri) {
            if (uri.includes('/api/get?'))
                throw Object.assign(new Error('miss'), {status: 404});
            assert(uri.includes('track_name=Track') && uri.includes('artist_name=Test%20artist'), 'Bad search query');
            const rows = [
                {trackName: 'Track', artistName: 'Other', duration: 120, plainLyrics: 'Wrong artist'},
                {trackName: 'TRACK', artistName: 'Test artist', duration: 120, plainLyrics: 'Search result'},
            ];
            return new TextEncoder().encode(JSON.stringify(rows));
        },
        destroy() {},
    });
    const found = await fallback.load({...song, artist: ' Test  artist ', duration: 120000000}, cancel);
    assert(found.plain === 'Search result' && !found.timed.length, 'Incorrect search fallback match');
    fallback.destroy();
    const offline = new LyricsProvider({get() { throw new Error('Offline'); }, destroy() {}});
    assert((await offline.load(song, cancel)).message.includes('connection'), 'Network failure missing');
    offline.destroy();
    print('PASS synced and plain lyrics parsing, cached hits and misses, network failure and rate limiting');
}

await checkMpris();
await checkArtworkAndLyrics();
