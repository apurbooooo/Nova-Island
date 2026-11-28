import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {sleep} from 'resource:///org/gnome/shell/ui/scripting.js';

import {mockPlayer, PNG} from './mockMpris.js';

const UUID = 'nova-island@fromapurbo';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

async function waitFor(condition, description) {
    for (let i = 0; i < 250; i++) {
        if (condition())
            return;
        await sleep(20);
    }
    throw new Error(`Timed out waiting for ${description}`);
}

function find(actor, name) {
    if (actor.name === name)
        return actor;
    for (const child of actor.get_children()) {
        const found = find(child, name);
        if (found)
            return found;
    }
    return null;
}

async function screenshot(name) {
    const output = GLib.getenv('NOVA_TEST_SCREENSHOTS');
    if (!output)
        return;
    const file = Gio.File.new_for_path(GLib.build_filenamev([output, `${name}.png`]));
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    try {
        const {width} = Main.layoutManager.primaryMonitor;
        const lyrics = name.startsWith('karaoke');
        await new Shell.Screenshot().screenshot_area(Math.floor(width / 2) - (lyrics ? 340 : 265), 0, lyrics ? 680 : 530, lyrics ? 620 : 390, stream);
    } finally {
        stream.close(null);
    }
}

export async function run() {
    const manager = Main.extensionManager;
    await waitFor(() => manager.lookup(UUID)?.state === ExtensionState.ACTIVE, 'extension activation');
    const extension = manager.lookup(UUID);
    const settings = extension.stateObj.getSettings();
    const island = () => find(Main.panel, 'nova-island');
    const clockMapped = () => island()?.get_child().get_children().some(child =>
        child.mapped && child.has_style_class_name?.('nova-island-compact'));
    const miniTitle = () => find(island(), 'nova-media-mini-title');
    const preview = () => find(Main.uiGroup, 'nova-island-preview');
    const inPreview = name => find(preview(), `nova-media-${name}`);
    const seat = global.stage.get_context().get_backend().get_default_seat();
    const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const press = key => {
        keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
    };
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), 40, 400);
    const click = async actor => {
        await sleep(80);
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + w / 2, y + h / 2);
        await sleep(55);
        const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x + w / 2, y + h / 2);
        assert(picked && actor.contains(picked),
            `Picking ${actor.name} hit ${picked} at ${x},${y} (${w} × ${h}); reactive=${actor.reactive}`);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    };

    Main.overview.hide();
    await waitFor(() => !Main.overview.visible && island()?.mapped, 'initial Clock module');
    settings.set_boolean('hover-expand', false);
    settings.set_boolean('reduce-motion', true);
    settings.set_boolean('track-previews', true);
    settings.set_int('track-preview-duration', 1200);
    settings.set_string('default-expanded-module', 'auto');

    const [descriptor, path] = GLib.file_open_tmp('nova-shell-cover-XXXXXX');
    GLib.close(descriptor);
    GLib.file_set_contents(path, GLib.base64_decode(PNG));
    const first = await mockPlayer('NovaOne', 'NOVA One');
    let second;
    try {
        await waitFor(() => find(preview(), 'nova-module-media').visible, 'paused player discovered');
        assert(clockMapped(), 'A paused player displaced the compact clock');
        first.set('PlaybackStatus', 'Playing');
        await waitFor(() => miniTitle()?.mapped && miniTitle().text === 'NOVA One first track', 'compact media');
        await click(island());
        await waitFor(() => preview().mapped && !inPreview('title').mapped, 'automatic Time while media is playing');
        await click(island());
        await waitFor(() => !preview().mapped, 'close automatic Time');
        first.changeTrack('Track paused during preview');
        await waitFor(() => preview().mapped && inPreview('title').text === 'Track paused during preview',
            'automatic preview before pause');
        first.set('PlaybackStatus', 'Paused');
        await waitFor(() => clockMapped() && !preview().mapped, 'automatic preview closes on pause');
        first.set('PlaybackStatus', 'Playing');
        await waitFor(() => miniTitle().mapped, 'compact media after resume');
        const focus = global.stage.get_key_focus();
        first.changeTrack('A fresh track from NOVA One');
        await waitFor(() => preview()?.mapped && inPreview('title').mapped &&
            inPreview('title').text === 'A fresh track from NOVA One', 'automatic media preview');
        assert(global.stage.get_key_focus() === focus, 'Track preview stole keyboard focus');
        assert(!island().has_style_class_name('nova-island-pinned'), 'Automatic preview pinned itself');
        assert(inPreview('art').content === null, 'Fallback artwork missing');
        await sleep(180);
        await screenshot('media-expanded');
        await waitFor(() => !preview()?.mapped, 'track-change expiry');

        second = await mockPlayer('NovaTwo', 'NOVA Two',
            {limited: true, artwork: Gio.File.new_for_path(path).get_uri()});
        await click(island());
        await waitFor(() => preview()?.mapped && find(preview(), 'nova-module-media')?.mapped,
            'module tabs');
        await click(find(preview(), 'nova-module-media'));
        await waitFor(() => inPreview('switch').mapped && inPreview('toggle').has_allocation() && preview().height === settings.get_int('expanded-height'),
            'playback controls');
        assert(inPreview('elapsed').text !== '' && inPreview('duration').text === '2:00', 'Missing playback time');
        await click(inPreview('toggle'));
        await waitFor(() => first.calls.includes('Pause'), 'pointer playback controls');
        await waitFor(clockMapped, 'clock after pausing from the media tab');
        assert(preview().mapped, 'Playback state update hid the preview while interacting');
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), 40, 400);
        await waitFor(() => !preview().mapped && clockMapped(), 'leaving a selected tab returns to the clock');
        settings.set_string('default-expanded-module', 'auto');
        await click(island());
        await waitFor(() => preview().mapped && !inPreview('title').mapped, 'reopens to the automatic clock');
        await click(island());
        await waitFor(() => !preview().mapped, 'automatic clock preview closed');
        settings.set_string('default-expanded-module', 'media');
        await click(island());
        await waitFor(() => inPreview('switch').mapped, 'explicit media default');
        await click(inPreview('switch'));
        await waitFor(() => inPreview('title').text === 'NOVA Two first track', 'manual player switch');
        await waitFor(() => inPreview('art').content, 'paused player artwork in the expanded view');
        assert(clockMapped(), 'Selecting a paused player displaced the compact clock');
        second.set('PlaybackStatus', 'Playing');
        await waitFor(() => miniTitle().mapped && miniTitle().text === 'NOVA Two first track' &&
            find(island(), 'nova-media-small-art').content, 'playing track title and artwork in the compact view');
        second.set('PlaybackStatus', 'Paused');
        await waitFor(clockMapped, 'compact clock after pausing a different player');
        await click(inPreview('lyrics'));
        await waitFor(() => inPreview('lyric-text')?.mapped && inPreview('lyric-text')?.text.includes('off'), 'disabled lyrics explanation');
        assert(inPreview('lyrics-title').text === 'NOVA Two first track' &&
            inPreview('lyrics-artist').text === 'NOVA Test Artist' &&
            inPreview('lyrics-album').text === 'NOVA Test Album', 'Lyrics header track metadata');
        assert(inPreview('lyrics-art').content === inPreview('art').content &&
            inPreview('lyrics-sync').text === 'Off', 'Lyrics header artwork and status');
        const bars = inPreview('lyrics-visualizer');
        assert(!bars.visible && bars.get_children().length === 4, 'Lyrics visualizer while paused');
        second.set('PlaybackStatus', 'Playing');
        await waitFor(() => bars.mapped, 'four playing visualizer bars in lyrics view');
        second.set('PlaybackStatus', 'Paused');
        await waitFor(() => !bars.visible, 'lyrics visualizer hides on pause');
        await click(inPreview('lyrics'));
        const {HttpClient} = await import(extension.dir.get_child('src/media/network.js').get_uri());
        const originalGet = HttpClient.prototype.get;
        let lookups = 0;
        try {
            HttpClient.prototype.get = async function (uri, ...args) {
                if (!uri.startsWith('https://lrclib.net/'))
                    return originalGet.call(this, uri, ...args);
                lookups++;
                await sleep(80);
                return new TextEncoder().encode(JSON.stringify({
                    plainLyrics: 'Full verse\nSecond line', syncedLyrics: '[00:01]Timed verse\n[00:30]Next verse',
                }));
            };
            settings.set_boolean('lyrics-enabled', true);
            await waitFor(() => inPreview('lyrics-status').text === 'Synced', 'automatic lyrics before opening view');
            await click(inPreview('lyrics'));
            await waitFor(() => inPreview('lyric-text')?.mapped && inPreview('lyric-text')?.text === 'Timed verse',
                'timestamped line rendered');
            await waitFor(() => preview().width === 620 && preview().height === 540, 'dedicated lyrics geometry');
            assert(inPreview('lyrics-sync').text === 'Synced', 'Lyrics header sync status');
            second.seekTo(32000000);
            await waitFor(() => inPreview('lyric-text')?.text === 'Next verse', 'synchronized lyrics follow seeking');
            settings.set_string('lyrics-mode', 'plain');
            await waitFor(() => inPreview('lyric-text')?.text === 'Full verse\nSecond line', 'plain lyrics rendered');
            assert(lookups === 1, 'View changes repeated lyrics lookup');
            const lines = ['A quiet street', 'Before the dawn', 'Under the evening sky', 'One light stays on', 'Across the water']
                .map((text, i) => ({text, start_ms: i * 6000,
                    words: text.split(' ').map((part, j) => ({text: part, start_ms: i * 6000 + j * 1200}))}));
            HttpClient.prototype.get = async () => new TextEncoder().encode(JSON.stringify({
                hasWordSync: true, lyricsfile: JSON.stringify({lines}),
            }));
            settings.set_string('lyrics-mode', 'auto');
            second.changeTrack('Evening sky');
            second.seekTo(15200000);
            await waitFor(() => inPreview('lyric-text')?.text === lines[2].text, 'word-synced track replacement');
            await sleep(180);
            assert(!inPreview('lyric-text').get_transition('translation-y'), 'Reduced motion animated the row');
            await screenshot('karaoke-word');
            settings.set_boolean('reduce-motion', false);
            second.set('PlaybackStatus', 'Playing');
            second.seekTo(18100000);
            await waitFor(() => inPreview('lyric-text')?.text === lines[3].text, 'animated line change');
            second.set('PlaybackStatus', 'Paused');
            second.seekTo(15200000);
            await waitFor(() => inPreview('lyric-text')?.text === lines[2].text, 'backward seek after animation');
            settings.set_boolean('reduce-motion', true);
            const nav = inPreview('lyrics-view').get_last_child();
            await click(nav.get_last_child());
            await waitFor(() => inPreview('lyric-text')?.text === lines[3].text, 'browse independent of player');
            await click(nav.get_child_at_index(1));
            await waitFor(() => inPreview('lyric-text')?.text === lines[2].text, 'return to playback');
            settings.set_boolean('lyrics-enabled', false);
            await waitFor(() => inPreview('lyric-text')?.text.includes('off'), 'live lyrics disable explanation');
            await click(inPreview('lyrics'));
        } finally {
            HttpClient.prototype.get = originalGet;
        }
        settings.set_int('artwork-size', 80);
        settings.set_int('media-control-size', 20);
        await waitFor(() => inPreview('art').width === 80 && inPreview('toggle').child.icon_size === 20,
            'live media dimensions');
        assert(settings.get_string('last-player') === second.name, 'Player preference not remembered');
        assert(!inPreview('next').reactive && !inPreview('seek-forward').reactive && !inPreview('repeat').reactive,
            'Unsupported controls are active');

        settings.set_int('expanded-width', 260);
        settings.set_int('expanded-height', 150);
        settings.set_int('media-control-size', 32);
        settings.set_string('media-expanded-layout', 'stacked');
        second.changeTrack('Long title '.repeat(20));
        await waitFor(() => preview().width === 260 && preview().height === 150, 'small preview dimensions');
        await sleep(200);
        const main = inPreview('title').get_parent().get_parent().get_parent();
        const scroller = main.get_parent();
        const adjustment = scroller.vadjustment;
        assert(adjustment.upper > adjustment.page_size, 'small view must scroll to lower controls');
        adjustment.value = adjustment.upper - adjustment.page_size;
        await sleep(100);
        const [px, py] = preview().get_transformed_position();
        const [cx, cy] = inPreview('toggle').get_transformed_position();
        assert(cx >= px && cx < px + 260 && cy >= py && cy < py + 150, 'play button unreachable after scrolling');
        print('PASS narrow stacked view with long title, maximum controls and scroll');
        await second.close();
        await waitFor(() => inPreview('title').text === 'A fresh track from NOVA One', 'fallback player');
        assert(island().has_style_class_name('nova-island-pinned'), 'Player departure lost pinned state');
        island().grab_key_focus();
        press(Clutter.KEY_Down);
        await waitFor(() => preview().contains(global.stage.get_key_focus()), 'keyboard focus in the media preview');
        press(Clutter.KEY_Escape);
        await waitFor(() => !preview().mapped && global.stage.get_key_focus() === island(),
            'Escape returns focus to the island');
        settings.set_boolean('media-enabled', false);
        await waitFor(() => clockMapped() && !inPreview('title').mapped, 'module disabled live');
        settings.set_boolean('media-enabled', true);
        await waitFor(() => find(preview(), 'nova-module-media').visible && clockMapped(), 'paused player rediscovered on enable');
        first.set('PlaybackStatus', 'Playing');
        await waitFor(() => miniTitle().mapped, 'compact media restored on play');
        first.set('PlaybackStatus', 'Stopped');
        await waitFor(clockMapped, 'clock after stopping playback');

        manager.disableExtension(UUID);
        await waitFor(() => extension.state === ExtensionState.INACTIVE && !island() && !preview(), 'media actor cleanup');
        first.changeTrack('Unobserved track');
        await sleep(150);
        assert(!island() && !preview(), 'Media event resurrected a disabled actor');
        print('PASS compact and expanded media, automatic preview, widget tabs, pointer and keyboard controls, switching, capability states, and disable cleanup');
    } finally {
        await second?.close();
        await first.close();
        GLib.unlink(path);
    }
}
