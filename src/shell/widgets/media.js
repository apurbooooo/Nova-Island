import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {KaraokeView} from './karaoke.js';
import {ArtworkManager} from '../../media/artwork.js';
import {LyricsProvider} from '../../media/lyrics.js';
import {MediaManager} from '../../media/mpris.js';
import {motionEnabled} from '../animationEngine.js';

const SECOND = 1000000;
const row = style_class => new St.BoxLayout({style_class});
const column = style_class => new St.BoxLayout({style_class, orientation: Clutter.Orientation.VERTICAL});
const label = (name, style_class, text = '') => {
    const actor = new St.Label({name, style_class, text});
    actor.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return actor;
};
const icon = (icon_name, icon_size = 15) => new St.Icon({icon_name, icon_size});
const clock = value => {
    const seconds = Math.floor(value / SECOND);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

function action(name, description, iconName, handler) {
    const button = new St.Button({name, style_class: 'nova-media-action', can_focus: true,
        reactive: true, accessible_name: description, child: icon(iconName)});
    button.connect('clicked', handler);
    return button;
}

function art(size, name) {
    const fallback = icon('audio-x-generic-symbolic', Math.round(size * 0.48));
    const image = new St.Bin({name, width: size, height: size, child: fallback,
        y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER,
        style_class: 'nova-artwork', content_gravity: Clutter.ContentGravity.RESIZE_ASPECT});
    return {image, fallback};
}

function setArtwork(cover, content) {
    cover.image.content = content;
    cover.fallback.visible = !content;
    if (content)
        cover.image.add_style_class_name('nova-artwork-loaded');
    else
        cover.image.remove_style_class_name('nova-artwork-loaded');
}

export function createMediaWidget(lifecycle, onChanged, settings) {
    const compact = row('nova-media-compact');
    const small = art(20, 'nova-media-small-art');
    const miniStatus = icon('media-playback-pause-symbolic', 12);
    const miniTitle = label('nova-media-mini-title', 'nova-media-mini-title');
    miniTitle.x_expand = true;
    miniTitle.y_align = miniStatus.y_align = Clutter.ActorAlign.CENTER;
    const visualizer = row('nova-visualizer');
    visualizer.y_align = Clutter.ActorAlign.CENTER;
    const bars = [0, 1, 2].map(() => new St.Widget({style_class: 'nova-visualizer-bar',
        y_align: Clutter.ActorAlign.END, scale_y: 0.35}));
    bars.forEach(bar => {
        bar.set_pivot_point(0.5, 1);
        visualizer.add_child(bar);
    });
    [small.image, miniStatus, miniTitle, visualizer].forEach(child => compact.add_child(child));

    const expanded = column('nova-media-expanded');
    expanded.y_align = Clutter.ActorAlign.FILL;
    expanded.x_align = Clutter.ActorAlign.FILL;
    const header = row('nova-media-header');
    const playerName = label('nova-media-player', 'nova-media-secondary');
    playerName.x_expand = true;
    const switchPlayer = action('nova-media-switch', 'Switch media player', 'object-flip-horizontal-symbolic', () => {
        const players = manager?.players ?? [];
        if (players.length < 2)
            return;
        const selected = (players.indexOf(active) + 1) % players.length;
        settings.set('last-player', players[selected].name);
    });
    const lyricToggle = new St.Button({name: 'nova-media-lyrics', label: 'Lyrics',
        style_class: 'nova-media-action', can_focus: true, reactive: true});
    lyricToggle.connect('clicked', () => {
        showLyrics = !showLyrics;
        if (showLyrics && lyricsResult?.retry)
            lyricsKey = undefined;
        renderView();
        updateTimers();
        onChanged(false);
    });
    [playerName, switchPlayer, lyricToggle].forEach(child => header.add_child(child));
    expanded.add_child(header);

    const main = column('nova-media-main');
    main.x_expand = true;
    const hero = row('nova-media-hero');
    const large = art(100, 'nova-media-art');
    const info = column('nova-media-info');
    info.x_expand = true;
    info.y_align = Clutter.ActorAlign.CENTER;
    const title = label('nova-media-title', 'nova-media-title');
    const artist = label('nova-media-artist', 'nova-media-secondary');
    const album = label('nova-media-album', 'nova-media-secondary');
    [title, artist, album].forEach(child => info.add_child(child));
    [large.image, info].forEach(child => hero.add_child(child));
    main.add_child(hero);

    const controls = row('nova-media-controls');
    controls.x_align = Clutter.ActorAlign.CENTER;
    const makeControl = (id, description, iconName, delta) =>
        action(`nova-media-${id}`, description, iconName, () => void send(id, delta));
    const shuffle = makeControl('shuffle', 'Toggle shuffle', 'media-playlist-shuffle-symbolic');
    const previous = makeControl('previous', 'Previous track', 'media-skip-backward-symbolic');
    const back = makeControl('seek-back', 'Seek back 10 seconds', 'media-seek-backward-symbolic', -10 * SECOND);
    const play = makeControl('toggle', 'Play', 'media-playback-start-symbolic');
    play.add_style_class_name('nova-media-play');
    const forward = makeControl('seek-forward', 'Seek forward 10 seconds', 'media-seek-forward-symbolic', 10 * SECOND);
    const next = makeControl('next', 'Next track', 'media-skip-forward-symbolic');
    const repeat = makeControl('repeat', 'Change repeat mode', 'media-playlist-repeat-symbolic');
    [shuffle, previous, back, play, forward, next, repeat].forEach(child => controls.add_child(child));

    const progress = new St.DrawingArea({name: 'nova-media-progress', style_class: 'nova-media-progress',
        x_expand: true, clip_to_allocation: true});
    let fraction = 0;
    let progressColor = [0.74, 0.81, 1];
    lifecycle.connect(progress, 'repaint', area => {
        const [width, height] = area.get_surface_size();
        const context = area.get_context();
        const filled = width * fraction;
        const rtl = area.get_text_direction() === Clutter.TextDirection.RTL;
        context.setSourceRGB(...progressColor);
        context.rectangle(rtl ? width - filled : 0, 0, filled, height);
        context.fill();
        context.$dispose();
    });
    const times = row('nova-media-times');
    const elapsed = label('nova-media-elapsed', 'nova-media-secondary');
    const duration = label('nova-media-duration', 'nova-media-secondary');
    elapsed.x_expand = true;
    times.add_child(elapsed);
    times.add_child(duration);
    // Keep transport buttons reachable even at the smallest width and largest icon size.
    const controlsScroll = new St.ScrollView({x_expand: true, hscrollbar_policy: St.PolicyType.AUTOMATIC,
        vscrollbar_policy: St.PolicyType.NEVER});
    controlsScroll.set_child(controls);
    [progress, times, controlsScroll].forEach(child => main.add_child(child));
    const playerScroll = new St.ScrollView({x_expand: true, y_expand: true,
        hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
    playerScroll.set_child(main);
    expanded.add_child(playerScroll);

    const karaoke = new KaraokeView(settings);
    expanded.add_child(karaoke.actor);

    const artwork = new ArtworkManager();
    const lyrics = new LyricsProvider();
    let manager;
    let active;
    let track = {};
    let showLyrics = false;
    let artKey;
    let lyricsKey;
    let coverJob;
    let lyricsJob;
    let lyricsResult;
    let refreshSource = 0;
    let refreshInterval = 0;
    let visualizerSource = 0;
    let beat = 0;
    let destroyed = false;

    function setControl(button, enabled) {
        button.reactive = enabled;
        button.can_focus = enabled;
        button.opacity = enabled ? 255 : 90;
    }

    function renderProgress() {
        const position = active?.position ?? 0;
        const length = track.duration ?? 0;
        fraction = length > 0 ? Math.max(0, Math.min(1, position / length)) : 0;
        if (progress.mapped)
            progress.queue_repaint();
        elapsed.text = clock(position);
        duration.text = length > 0 ? clock(length) : '–:–';
        if (showLyrics)
            karaoke.update(active?.status === 'Stopped' ? -1 : position / SECOND,
                active?.status === 'Playing', Boolean(length && position >= length));
    }

    function atPlaybackBoundary() {
        return active.rate < 0 ? active.position <= 0 : track.duration > 0 && active.position >= track.duration;
    }

    function updateTimers() {
        const playing = active?.status === 'Playing';
        const progressActive = playing && expanded.mapped && active.rate !== 0 &&
            (!showLyrics || karaoke.stage.visible) && !atPlaybackBoundary();
        const interval = showLyrics && karaoke.stage.visible ? 32 : 500;
        if (refreshSource && refreshInterval !== interval) {
            GLib.Source.remove(refreshSource);
            refreshSource = 0;
        }
        refreshInterval = interval;
        if (progressActive && !refreshSource) {
            refreshSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
                if (atPlaybackBoundary()) {
                    renderProgress();
                    refreshSource = 0;
                    return GLib.SOURCE_REMOVE;
                }
                if (showLyrics)
                    karaoke.update(active.position / SECOND, true);
                else
                    renderProgress();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!progressActive && refreshSource) {
            GLib.Source.remove(refreshSource);
            refreshSource = 0;
        }

        visualizer.visible = settings.get('media-visualizer', true);
        const animate = visualizer.visible && playing && compact.mapped && settings.get('media-animations', true) && motionEnabled(settings) &&
            settings.get('visualizer-intensity', 65) > 0;
        if (animate && !visualizerSource) {
            visualizerSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                beat++;
                const strength = settings.get('visualizer-intensity', 65) / 100;
                bars.forEach((bar, index) => bar.ease({
                    scale_y: 0.28 + strength * (0.36 + 0.36 * Math.sin(beat * 1.7 + index * 2.1)),
                    duration: 185,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                }));
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!animate && visualizerSource) {
            GLib.Source.remove(visualizerSource);
            visualizerSource = 0;
            bars.forEach(bar => {
                bar.remove_all_transitions();
                bar.scale_y = 0.35;
            });
        }
    }

    function renderLyrics() {
        const requested = settings.get('lyrics-enabled', false) && active;
        const key = requested ? JSON.stringify([active.name, track.key, track.duration]) : null;
        if (key === lyricsKey)
            return;
        lyricsKey = key;
        lyricsJob?.cancel();
        lyricsJob = null;
        lyricsResult = null;
        if (!key)
            return;
        const job = new Gio.Cancellable();
        lyricsJob = job;
        lyrics.load(track, job).then(result => {
            if (job.is_cancelled() || destroyed)
                return;
            lyricsResult = result;
            renderView();
            updateTimers();
        });
    }

    function renderView() {
        const enabled = settings.get('lyrics-enabled', false);
        renderLyrics();
        let status = 'Off';
        if (enabled) {
            if (!lyricsResult)
                status = 'Loading…';
            else if (lyricsResult.timed?.length && settings.get('lyrics-mode', 'auto') !== 'plain')
                status = lyricsResult.mode === 'word' ? 'Word-synced' : 'Synced';
            else
                status = lyricsResult.plain ? 'Plain' : lyricsResult.retry ? 'Connection error' : 'Unavailable';
        }
        lyricToggle.label = showLyrics ? '‹ Player' : `Lyrics · ${status}`;
        lyricToggle.accessible_name = showLyrics ? 'Back to playback controls' : lyricToggle.label;
        playerScroll.visible = !showLyrics;
        karaoke.actor.visible = showLyrics;
        karaoke.setContent(lyricsResult, settings.get('lyrics-mode', 'auto') === 'plain', status, track.title,
            !enabled ? 'Lyrics are off. Enable lyrics in NOVA Island Settings → Media.' :
                lyricsResult ? lyricsResult.message : 'Loading lyrics…');
        if (showLyrics)
            renderProgress();
    }

    function updateArtwork() {
        const enabled = settings.get('media-artwork', true);
        const allowRemote = settings.get('remote-artwork', true);
        const size = settings.get('artwork-size', 100);
        large.image.set_size(size, size);
        large.fallback.icon_size = Math.round(size * 0.42);
        small.image.visible = large.image.visible = enabled;
        const uri = enabled && (compact.mapped || expanded.mapped) ? track.artwork : '';
        const key = JSON.stringify([uri, allowRemote, track.key, active?.name]);
        if (key === artKey)
            return;

        artKey = key;
        coverJob?.cancel();
        setArtwork(small, null);
        setArtwork(large, null);
        if (!uri)
            return;
        const job = new Gio.Cancellable();
        coverJob = job;
        artwork.load(uri, allowRemote, job, artKey).then(pixbuf => {
            if (!pixbuf || job.is_cancelled() || destroyed)
                return;
            try {
                const content = St.ImageContent.new_with_preferred_size(pixbuf.width, pixbuf.height);
                const context = global.stage.get_context().get_backend().get_cogl_context();
                const format = pixbuf.has_alpha ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;
                if (content.set_bytes(context, pixbuf.read_pixel_bytes(), format,
                    pixbuf.width, pixbuf.height, pixbuf.rowstride)) {
                    setArtwork(small, content);
                    setArtwork(large, content);
                    if (settings.get('media-animations', true) && motionEnabled(settings)) {
                        for (const cover of [small, large]) {
                            cover.image.opacity = 145;
                            cover.image.ease({opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                        }
                    }
                } else {
                    console.warn('[NOVA Island] Artwork texture upload was rejected');
                }
            } catch (error) {
                console.warn(`[NOVA Island] Artwork texture upload: ${error.message}`);
            }
        });
    }

    async function send(id, amount = 0) {
        const player = active;
        if (!player)
            return;
        await player.command(id.startsWith('seek-') ? 'seek' : id, amount);
        if (!destroyed && active === player)
            refresh();
    }

    function refresh(peek = false) {
        const selected = manager?.active;
        active = selected;
        track = active?.track ?? {};
        const playing = active?.status === 'Playing';
        const paused = active?.status === 'Paused';
        miniStatus.icon_name = playing ? 'media-playback-start-symbolic' :
            paused ? 'media-playback-pause-symbolic' : 'media-playback-stop-symbolic';
        miniTitle.text = track.title || active?.identity || 'Media';
        title.text = track.title || 'No track information';
        artist.text = track.artist || 'Unknown artist';
        album.text = track.album ?? '';
        album.visible = Boolean(track.album);
        const status = active?.status ?? 'Stopped';
        playerName.text = active ? `${active.identity} · ${status}` : 'No media player';
        switchPlayer.visible = (manager?.players.length ?? 0) > 1;
        if (switchPlayer.visible)
            switchPlayer.accessible_name = `Switch player · ${active.identity}`;
        play.child.icon_name = playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        play.accessible_name = playing ? 'Pause' : 'Play';
        const cap = active?.capabilities ?? {};
        setControl(play, playing ? cap.pause : cap.play);
        setControl(previous, cap.previous);
        setControl(next, cap.next);
        setControl(back, cap.seek);
        setControl(forward, cap.seek);
        setControl(shuffle, cap.shuffle);
        setControl(repeat, cap.repeat);
        shuffle.accessible_name = active?.shuffle ? 'Shuffle on' : 'Shuffle off';
        repeat.accessible_name = `Repeat: ${active?.repeat ?? 'None'}`;
        if (active?.shuffle)
            shuffle.add_style_class_name('nova-media-selected');
        else
            shuffle.remove_style_class_name('nova-media-selected');
        if (active && active.repeat !== 'None')
            repeat.add_style_class_name('nova-media-selected');
        else
            repeat.remove_style_class_name('nova-media-selected');
        renderView();
        renderProgress();
        updateTimers();
        updateArtwork();
        onChanged(peek);
    }

    function configure() {
        karaoke.configure();
        artwork.setCacheEnabled(settings.get('media-artwork-cache', true));
        for (const button of controls.get_children())
            button.child.icon_size = settings.get('media-control-size', 22);
        if (settings.get('media-enabled', true)) {
            manager ??= new MediaManager(refresh);
            manager.configure({
                last: settings.get('last-player', ''),
                preferred: settings.get('default-player', ''),
                priority: settings.get('player-priority', []),
            });
        } else if (manager) {
            manager.destroy();
            manager = null;
            refresh();
        }
        const stacked = settings.get('media-expanded-layout', 'wide') === 'stacked';
        hero.orientation = stacked ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
        hero.x_align = stacked ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL;
        updateArtwork();
        updateTimers();
    }

    for (const actor of [compact, expanded]) {
        lifecycle.connect(actor, 'notify::mapped', () => {
            updateTimers();
            updateArtwork();
            renderLyrics();
        });
    }
    const motionChanged = () => {
        karaoke.configure();
        updateTimers();
    };
    lifecycle.connect(St.Settings.get(), 'notify::reduced-motion', motionChanged);
    lifecycle.connect(St.Settings.get(), 'notify::enable-animations', motionChanged);
    lifecycle.add(() => {
        destroyed = true;
        manager?.destroy();
        coverJob?.cancel();
        lyricsJob?.cancel();
        artwork.destroy();
        lyrics.destroy();
        if (refreshSource)
            GLib.Source.remove(refreshSource);
        if (visualizerSource)
            GLib.Source.remove(visualizerSource);
    });
    configure();

    return {
        compact, expanded, configure,
        get lyricsOpen() { return showLyrics; },
        get available() {
            return Boolean(active);
        },
        describe() {
            return `${track.title || active?.identity || 'Media Player'} · ${active?.status ?? 'Stopped'}`;
        },
        applyTheme(tokens, alignment) {
            compact.style = `spacing: ${Math.min(8, tokens['compact-spacing'])}px;`;
            expanded.style = `spacing: ${tokens['expanded-spacing']}px;`;
            for (const secondary of [artist, album, playerName, elapsed, duration])
                secondary.style = `color: ${tokens['secondary-text-color']};`;
            for (const actor of [title, artist, album])
                actor.x_align = alignment;
            title.style = `font-size: ${settings.get('media-title-size', 22)}px;`;
            artist.style += ` font-size: ${settings.get('media-artist-size', 15)}px;`;
            main.style = hero.style = `spacing: ${tokens['expanded-spacing']}px;`;
            const accent = tokens['accent-color'];
            progressColor = accent.slice(1).match(/../g).map(pair => parseInt(pair, 16) / 255);
            if (progress.mapped)
                progress.queue_repaint();
            bars.forEach(actor => actor.style = `background-color: ${accent};`);
        },
    };
}
