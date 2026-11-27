import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import {COLOR_PATTERN} from '../shared/studio.js';
import Gio from 'gi://Gio';

import {MediaManager, NAME_PREFIX} from '../media/mpris.js';
import {writeSettings} from '../shared/presets.js';
import {color, combo, group, spin, toggle, watch} from './controls.js';

export function addMediaControls(page, settings, window) {
    toggle(group(page, 'Media Player'), settings, 'media-enabled', 'Enable Media Player',
        'Turn on to show available MPRIS players in the island.');
    const section = (title, description) => {
        const item = group(page, title, description);
        settings.bind('media-enabled', item, 'sensitive', Gio.SettingsBindFlags.GET);
        return item;
    };
    const whenEnabled = (key, row) => {
        if (row)
            settings.bind(key, row, 'sensitive', Gio.SettingsBindFlags.GET);
    };
    const layout = section('Expanded media');
    combo(layout, settings, 'media-expanded-layout', 'Artwork layout',
        [['wide', 'Side by side'], ['stacked', 'Stacked']], window);
    toggle(layout, settings, 'media-artwork', 'Show artwork');
    whenEnabled('media-artwork', spin(layout, settings, 'artwork-size', 'Artwork size', 'Side length in logical pixels when artwork is shown.'));
    whenEnabled('media-artwork', toggle(layout, settings, 'remote-artwork', 'Load artwork from the internet',
        'Allows requests to URLs supplied by media players. Turn on Show artwork to display covers.'));

    toggle(layout, settings, 'media-artwork-cache', 'Cache album artwork',
        'Keeps recently decoded covers in memory. Turning this off clears the cache.');
    for (const [key, title] of [
        ['expanded-width', 'Expanded width'], ['expanded-height', 'Expanded height'],
        ['media-control-size', 'Playback control size'], ['expanded-spacing', 'Content spacing'],
        ['media-title-size', 'Track title size'], ['media-artist-size', 'Artist size'],
    ])
        spin(layout, settings, key, title);

    const playback = section('Playback and previews');
    toggle(playback, settings, 'media-animations', 'Animate media',
        'Enables thumbnail transitions and visualizer motion when system animations are available.');
    toggle(playback, settings, 'media-visualizer', 'Playback visualizer', 'Animated bars follow playback state.');
    whenEnabled('media-visualizer', spin(playback, settings, 'visualizer-intensity', 'Visualizer intensity (%)'));
    toggle(playback, settings, 'track-previews', 'Preview new tracks');
    whenEnabled('track-previews', spin(playback, settings, 'track-preview-duration', 'Track preview duration (ms)'));

    if (settings.settings_schema.has_key('default-player') || settings.settings_schema.has_key('player-priority')) {
        const players = section('Players');
        if (settings.settings_schema.has_key('default-player'))
            addPlayerChoice(players, settings, window);
        if (settings.settings_schema.has_key('player-priority'))
            addPriority(players, settings, window);
    }

    const lyrics = section('Lyrics', 'Looking up lyrics sends the track’s title, artist, album, and duration to LRCLIB.');
    toggle(lyrics, settings, 'lyrics-enabled', 'Enable lyrics');
    combo(lyrics, settings, 'lyrics-mode', 'Lyrics display',
        [['auto', 'Automatic'], ['synced', 'Prefer timed lyrics'], ['plain', 'Plain lyrics']], window);
    if (!settings.settings_schema.has_key('lyrics-current-size'))
        return;
    const style = section('Lyrics appearance', 'Preview with sample lyrics');
    const sample = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, margin_top: 16, margin_bottom: 16});
    const verses = ['The city falls quiet', 'Under the evening sky', 'A light across the water'];
    const labels = verses.map(text => {
        const label = new Gtk.Label({label: text, use_markup: true, wrap: true});
        sample.append(label);
        return label;
    });
    sample.add_css_class('nova-lyrics-sample');
    sample.halign = Gtk.Align.CENTER;
    sample.valign = Gtk.Align.CENTER;
    const css = new Gtk.CssProvider();
    css.load_from_string('.nova-lyrics-sample { background-color: #101820; border-radius: 14px; padding: 16px; }');
    const display = window.get_display();
    Gtk.StyleContext.add_provider_for_display(display, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    window.connect('close-request', () => {
        Gtk.StyleContext.remove_provider_for_display(display, css);
        return false;
    });
    style.add(new Adw.Bin({child: sample}));
    const sync = () => {
        const ink = key => {
            const value = settings.get_string(key);
            return COLOR_PATTERN.test(value) ? value : '#ffffff';
        };
        sample.spacing = settings.get_int('lyrics-spacing');
        sample.set_size_request(Math.min(400, Math.round(settings.get_int('lyrics-width') * 0.5)),
            Math.round(settings.get_int('lyrics-height') * 0.32));
        const plain = settings.get_string('lyrics-mode') === 'plain';
        for (const [index, label] of labels.entries()) {
            const active = index === 1 && !plain;
            const size = settings.get_int(plain ? 'lyrics-font-size' : active ? 'lyrics-current-size' : 'lyrics-neighbor-size');
            label.opacity = active || plain ? 1 : settings.get_int('lyrics-inactive-opacity') / 100;
            const word = settings.get_boolean('lyrics-word-highlight') ? ink('lyrics-word-color') : ink('lyrics-current-color');
            const content = active ? `Under the <span foreground="${word}">evening</span> sky` : verses[index];
            label.set_markup(`<span size="${size * 768}" foreground="${active ? ink('lyrics-current-color') : '#b4bcca'}">${content}</span>`);
        }
    };
    watch(settings, window, 'changed', sync);
    sync();
    spin(style, settings, 'lyrics-font-size', 'Plain lyrics size');
    spin(style, settings, 'lyrics-current-size', 'Current line size');
    spin(style, settings, 'lyrics-neighbor-size', 'Surrounding line size');
    spin(style, settings, 'lyrics-width', 'Lyrics panel width');
    spin(style, settings, 'lyrics-height', 'Lyrics panel height');
    spin(style, settings, 'lyrics-spacing', 'Line spacing');
    spin(style, settings, 'lyrics-inactive-opacity', 'Inactive line opacity (%)');
    spin(style, settings, 'lyrics-scroll-duration', 'Scroll duration (ms)');
    for (const [key, title] of [['lyrics-current-color', 'Current line color'], ['lyrics-word-color', 'Word highlight color']])
        color(style, settings, key, title, window, (name, value) => settings.set_string(name, value));
    combo(style, settings, 'lyrics-transition', 'Line transition',
        [['slide', 'Slide and fade'], ['fade', 'Fade'], ['none', 'Instant']], window);
    toggle(style, settings, 'lyrics-auto-scroll', 'Follow current line');
    toggle(style, settings, 'lyrics-word-highlight', 'Highlight timed words');
    toggle(style, settings, 'reduce-motion', 'Reduce motion', 'Applies throughout NOVA Island.');

}

function addPlayerChoice(players, settings, window) {
    const updateChoices = combo(players, settings, 'default-player', 'Default player', [['', 'Automatic']],
        window, value => writeSettings(settings, [['default-player', value], ['last-player', '']]
            .filter(([key]) => settings.settings_schema.has_key(key))),
        'Manual switching in the island remembers the last selected player.');
    const updatePlayers = () => {
        const options = manager.players.map(player => [player.name, player.identity]);
        const current = settings.get_string('default-player');
        if (current && !options.some(([name]) => name === current))
            options.push([current, `${current.slice(NAME_PREFIX.length)} (offline)`]);
        updateChoices([['', 'Automatic'], ...options]);
    };
    const manager = new MediaManager(updatePlayers);
    updatePlayers();
    watch(settings, window, 'changed::default-player', updatePlayers);
    window.connect('close-request', () => {
        manager.destroy();
        return false;
    });
}

function addPriority(players, settings, window) {
    const priority = new Adw.EntryRow({title: 'Priority · comma-separated MPRIS names', show_apply_button: true});
    const sync = () => priority.text = settings.get_strv('player-priority').join(', ');
    sync();
    watch(settings, window, 'changed::player-priority', sync);
    priority.connect('apply', () => {
        const list = [...new Set(priority.text.split(',').map(name => name.trim()).filter(Boolean))];
        if (list.length > 32 || list.some(name => !name.startsWith(NAME_PREFIX) || !Gio.dbus_is_name(name))) {
            window.add_toast(new Adw.Toast({title: 'Enter valid names such as org.mpris.MediaPlayer2.vlc'}));
            return;
        }
        settings.set_strv('player-priority', list);
        sync();
    });
    players.add(priority);
}
