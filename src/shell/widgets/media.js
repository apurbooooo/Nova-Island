import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {KaraokeView} from './karaoke.js';
import {ArtworkManager} from '../../media/artwork.js';
import {LyricsProvider} from '../../media/lyrics.js';
import {MediaManager} from '../../media/mpris.js';
import {motionEnabled} from '../animationEngine.js';
import {hexToRgb, inkFor, rgbaCss} from '../ui/kit.js';

Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

const SECOND = 1000000;
const BACKDROP_DIR = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'nova-island-backdrops']);
const BACKDROP_SAMPLE_SIZE = 36;

// Downsample once per cover and enlarge smoothly so both views can reuse the same soft artwork.
async function writeBackdrop(pixbuf, key, cancellable) {
    const path = GLib.build_filenamev([BACKDROP_DIR,
        `${GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, key, -1)}-${BACKDROP_SAMPLE_SIZE}.png`]);
    if (GLib.file_test(path, GLib.FileTest.EXISTS))
        return path;
    const scale = BACKDROP_SAMPLE_SIZE / Math.max(pixbuf.width, pixbuf.height);
    const width = Math.max(1, Math.round(pixbuf.width * scale));
    const height = Math.max(1, Math.round(pixbuf.height * scale));
    const tiny = pixbuf.scale_simple(width, height, GdkPixbuf.InterpType.BILINEAR);
    const pixels = tiny.get_pixels();
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = y * tiny.rowstride + x * tiny.n_channels;
            for (let channel = 0; channel < 3; channel++)
                pixels[offset + channel] = Math.round(pixels[offset + channel] * 0.58);
        }
    }
    const dark = GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(pixels), GdkPixbuf.Colorspace.RGB,
        tiny.has_alpha, 8, width, height, tiny.rowstride);
    const [, buffer] = dark.scale_simple(width * 4, height * 4, GdkPixbuf.InterpType.BILINEAR).save_to_bufferv('png', [], []);
    GLib.mkdir_with_parents(BACKDROP_DIR, 0o700);
    await Gio.File.new_for_path(path).replace_contents_bytes_async(new GLib.Bytes(buffer), null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable);
    return path;
}
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

function createVisualizer(name, count) {
    const actor = row('nova-visualizer');
    actor.name = name;
    actor.y_align = Clutter.ActorAlign.CENTER;
    const bars = Array.from({length: count}, () => new St.Widget({style_class: 'nova-visualizer-bar',
        y_align: Clutter.ActorAlign.END, scale_y: 0.35}));
    for (const bar of bars) {
        bar.set_pivot_point(0.5, 1);
        actor.add_child(bar);
    }
    return {actor, bars};
}

export function createMediaWidget(lifecycle, onChanged, settings) {
    const compact = row('nova-media-compact');
    const small = art(20, 'nova-media-small-art');
    const miniStatus = icon('media-playback-pause-symbolic', 12);
    const miniTitle = label('nova-media-mini-title', 'nova-media-mini-title');
    miniTitle.x_expand = true;
    miniTitle.y_align = miniStatus.y_align = Clutter.ActorAlign.CENTER;
    const compactVisualizer = createVisualizer('nova-media-compact-visualizer', 3);
    miniStatus.add_style_class_name('nova-media-mini-status');
    [small.image, miniTitle, compactVisualizer.actor, miniStatus].forEach(child => compact.add_child(child));

    const expanded = column('nova-media-expanded');
    expanded.x_expand = expanded.y_expand = true;
    // Player and lyrics share one atmosphere: two crossfading blurred-artwork
    // layers under a dark scrim, behind the existing foreground column.
    const surface = new St.Widget({name: 'nova-media-surface', layout_manager: new Clutter.BinLayout(),
        x_expand: true, y_expand: true});
    const backdrops = [0, 1].map(() => new St.Widget({style_class: 'nova-media-backdrop',
        x_expand: true, y_expand: true, opacity: 0}));
    const scrim = new St.Widget({style_class: 'nova-media-scrim', x_expand: true, y_expand: true});
    [...backdrops, scrim, expanded].forEach(child => surface.add_child(child));
    let backdropRadius = '';
    let backdropFront = 0;
    let backdropKey;
    let backdropJob;
    const backdropImages = ['', ''];
    expanded.y_align = Clutter.ActorAlign.FILL;
    expanded.x_align = Clutter.ActorAlign.FILL;
    const header = row('nova-media-header');
    const source = row('nova-media-source');
    source.x_expand = true;
    const liveDot = new St.Widget({style_class: 'nova-media-live-dot', y_align: Clutter.ActorAlign.CENTER});
    const playerName = label('nova-media-player', 'nova-media-secondary');
    playerName.y_align = Clutter.ActorAlign.CENTER;
    source.add_child(liveDot);
    source.add_child(playerName);
    const switchPlayer = action('nova-media-switch', 'Switch media player', 'object-flip-horizontal-symbolic', () => {
        const players = manager?.players ?? [];
        if (players.length < 2)
            return;
        const selected = (players.indexOf(active) + 1) % players.length;
        settings.set('last-player', players[selected].name);
    });
    const lyricContent = row('nova-media-lyrics-content');
    const lyricIcon = icon('accessories-text-editor-symbolic', 14);
    const lyricBadge = new St.Bin({child: lyricIcon, style_class: 'nova-media-lyrics-icon',
        y_align: Clutter.ActorAlign.CENTER});
    const lyricCopy = column('nova-media-lyrics-copy');
    lyricCopy.y_align = Clutter.ActorAlign.CENTER;
    const lyricAction = label('nova-media-lyrics-action', 'nova-media-lyrics-action', 'Show lyrics');
    const lyricStatus = label('nova-media-lyrics-status', 'nova-media-lyrics-status');
    const lyricArrow = icon('go-next-symbolic', 12);
    lyricArrow.y_align = Clutter.ActorAlign.CENTER;
    lyricCopy.add_child(lyricAction);
    lyricCopy.add_child(lyricStatus);
    [lyricBadge, lyricCopy, lyricArrow].forEach(child => lyricContent.add_child(child));
    const lyricToggle = new St.Button({name: 'nova-media-lyrics', child: lyricContent, label_actor: lyricAction,
        style_class: 'nova-media-action nova-media-lyrics-toggle', can_focus: true, reactive: true,
        y_align: Clutter.ActorAlign.CENTER});
    lyricToggle.set_pivot_point(0.5, 0.5);
    lyricToggle.connect('clicked', () => {
        showLyrics = !showLyrics;
        if (showLyrics && lyricsResult?.retry)
            lyricsKey = undefined;
        renderView();
        updateTimers();
        onChanged(false);
        if (settings.get('media-animations', true) && motionEnabled(settings)) {
            lyricToggle.set_scale(0.95, 0.95);
            lyricToggle.ease({scale_x: 1, scale_y: 1, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            const incoming = showLyrics ? karaoke.actor : playerScroll;
            incoming.remove_all_transitions();
            incoming.opacity = 185;
            incoming.translation_y = 6;
            incoming.ease({opacity: 255, translation_y: 0, duration: 220,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
    });
    [source, switchPlayer, lyricToggle].forEach(child => header.add_child(child));
    expanded.add_child(header);

    const main = column('nova-media-main');
    main.x_expand = true;
    const hero = row('nova-media-hero');
    const large = art(132, 'nova-media-art');
    const info = column('nova-media-info');
    info.x_expand = true;
    info.y_align = Clutter.ActorAlign.CENTER;
    const title = label('nova-media-title', 'nova-media-title');
    const artist = label('nova-media-artist', 'nova-media-artist');
    const album = label('nova-media-album', 'nova-media-album');
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
        const radius = height / 2;
        const rtl = area.get_text_direction() === Clutter.TextDirection.RTL;
        const pill = (x, w) => {
            if (w <= 0)
                return;
            const r = Math.min(radius, w / 2);
            context.newSubPath();
            context.arc(x + w - r, radius, r, -Math.PI / 2, Math.PI / 2);
            context.arc(x + r, radius, r, Math.PI / 2, 1.5 * Math.PI);
            context.closePath();
        };
        context.setSourceRGBA(1, 1, 1, 0.14);
        pill(0, width);
        context.fill();
        const filled = Math.max(fraction > 0 ? height : 0, width * fraction);
        context.setSourceRGB(...progressColor);
        pill(rtl ? width - filled : 0, filled);
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
    lifecycle.connect(controlsScroll, 'notify::allocation', () => {
        const policy = controlsScroll.width < 380 ? St.PolicyType.AUTOMATIC : St.PolicyType.NEVER;
        if (controlsScroll.hscrollbar_policy !== policy)
            controlsScroll.hscrollbar_policy = policy;
    });
    const timeline = column('nova-media-timeline');
    timeline.add_child(progress);
    timeline.add_child(times);
    main.add_child(timeline);
    main.add_child(controlsScroll);
    const playerScroll = new St.ScrollView({x_expand: true, y_expand: true, overlay_scrollbars: true,
        hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
    playerScroll.set_child(main);
    expanded.add_child(playerScroll);

    const lyricsHeader = row('nova-lyrics-track-header');
    lyricsHeader.name = 'nova-media-lyrics-header';
    const lyricsCover = art(48, 'nova-media-lyrics-art');
    const lyricsInfo = column('nova-lyrics-track-info');
    lyricsInfo.x_expand = true;
    lyricsInfo.y_align = Clutter.ActorAlign.CENTER;
    const lyricsTitle = label('nova-media-lyrics-title', 'nova-lyrics-track-title');
    const lyricsArtist = label('nova-media-lyrics-artist', 'nova-lyrics-track-detail');
    const lyricsAlbum = label('nova-media-lyrics-album', 'nova-lyrics-track-detail');
    const lyricsSync = label('nova-media-lyrics-sync', 'nova-lyrics-heading');
    [lyricsTitle, lyricsArtist, lyricsAlbum, lyricsSync].forEach(actor => lyricsInfo.add_child(actor));
    const lyricsVisualizer = createVisualizer('nova-media-lyrics-visualizer', 4);
    [lyricsCover.image, lyricsInfo, lyricsVisualizer.actor].forEach(actor => lyricsHeader.add_child(actor));
    const visualizers = [compactVisualizer, lyricsVisualizer];
    const covers = [small, large, lyricsCover];
    const karaoke = new KaraokeView(settings, lyricsHeader);
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

    function resetLyricsMotion() {
        if (settings.get('media-animations', true) && motionEnabled(settings))
            return;
        lyricToggle.remove_all_transitions();
        lyricToggle.set_scale(1, 1);
        for (const view of [playerScroll, karaoke.actor]) {
            view.remove_all_transitions();
            view.opacity = 255;
            view.translation_y = 0;
        }
    }

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

        const showVisualizer = Boolean(playing) && settings.get('media-visualizer', true);
        compactVisualizer.actor.visible = showVisualizer;
        lyricsVisualizer.actor.visible = showVisualizer;
        miniStatus.visible = !showVisualizer;
        const animate = showVisualizer && (compact.mapped || (surface.mapped && showLyrics)) &&
            settings.get('media-animations', true) && motionEnabled(settings) &&
            settings.get('visualizer-intensity', 65) > 0;
        if (animate && !visualizerSource) {
            visualizerSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                beat++;
                const strength = settings.get('visualizer-intensity', 65) / 100;
                for (const {actor, bars} of visualizers) {
                    if (actor.mapped) {
                        bars.forEach((bar, index) => bar.ease({
                            scale_y: 0.28 + strength * (0.36 + 0.36 * Math.sin(beat * 1.7 + index * 2.1)),
                            duration: 185,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        }));
                    }
                }
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!animate && visualizerSource) {
            GLib.Source.remove(visualizerSource);
            visualizerSource = 0;
            visualizers.flatMap(({bars}) => bars).forEach(bar => {
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
        lyricAction.text = showLyrics ? 'Back to player' : 'Show lyrics';
        lyricStatus.text = status;
        lyricsTitle.text = title.text;
        lyricsArtist.text = artist.text;
        lyricsAlbum.text = album.text;
        lyricsAlbum.visible = album.visible;
        lyricsSync.text = status;
        lyricStatus.visible = !showLyrics;
        lyricIcon.icon_name = showLyrics ? 'go-previous-symbolic' : 'accessories-text-editor-symbolic';
        lyricArrow.visible = !showLyrics;
        lyricToggle.accessible_name = showLyrics ? lyricAction.text : `${lyricAction.text} · ${status}`;
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
        const size = settings.get('artwork-size', 132);
        large.image.set_size(size, size);
        large.fallback.icon_size = Math.round(size * 0.42);
        covers.forEach(({image}) => image.visible = enabled);
        const uri = enabled && (compact.mapped || expanded.mapped) ? track.artwork : '';
        const key = JSON.stringify([uri, allowRemote, track.key, active?.name]);
        if (key === artKey)
            return;

        artKey = key;
        coverJob?.cancel();
        covers.forEach(cover => setArtwork(cover, null));
        // Unmapping only pauses loading; keep the backdrop until the track has none.
        if (!enabled || !track.artwork)
            showBackdrop(null, null);
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
                    covers.forEach(cover => setArtwork(cover, content));
                    updateBackdrop(pixbuf, key);
                    if (settings.get('media-animations', true) && motionEnabled(settings)) {
                        for (const cover of covers) {
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

    function showBackdrop(path, key) {
        if (key === backdropKey)
            return;
        backdropKey = key;
        const previous = backdrops[backdropFront];
        backdropFront = 1 - backdropFront;
        const next = backdrops[backdropFront];
        backdropImages[backdropFront] = path ? ` background-image: url("file://${path}"); background-size: cover;` : '';
        next.style = backdropRadius + backdropImages[backdropFront];
        const animate = surface.mapped && settings.get('media-animations', true) && motionEnabled(settings);
        for (const [actor, opacity] of [[previous, 0], [next, path ? 255 : 0]]) {
            actor.remove_all_transitions();
            if (animate)
                actor.ease({opacity, duration: 420, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            else
                actor.opacity = opacity;
        }
        // The outgoing layer sits on top while it fades, so the change never flashes.
        surface.set_child_above_sibling(previous, next);
    }

    function updateBackdrop(pixbuf, key) {
        if (key === backdropKey)
            return;
        backdropJob?.cancel();
        const job = new Gio.Cancellable();
        backdropJob = job;
        writeBackdrop(pixbuf, key, job).then(path => {
            if (!job.is_cancelled() && !destroyed && key === artKey)
                showBackdrop(path, key);
        }).catch(error => {
            if (!job.is_cancelled())
                console.warn(`[NOVA Island] Artwork backdrop: ${error.message}`);
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
        miniTitle.opacity = small.image.opacity = playing ? 255 : 175;
        title.text = track.title || 'No track information';
        artist.text = track.artist || 'Unknown artist';
        album.text = track.album ?? '';
        album.visible = Boolean(track.album);
        const status = active?.status ?? 'Stopped';
        playerName.text = active ? `${active.identity} · ${status}` : 'No media player';
        liveDot.opacity = playing ? 255 : 90;
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
        resetLyricsMotion();
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
        info.x_align = stacked ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL;
        updateArtwork();
        updateTimers();
    }

    for (const actor of [compact, surface]) {
        lifecycle.connect(actor, 'notify::mapped', () => {
            updateTimers();
            updateArtwork();
            renderLyrics();
        });
    }
    const motionChanged = () => {
        karaoke.configure();
        resetLyricsMotion();
        updateTimers();
    };
    lifecycle.connect(St.Settings.get(), 'notify::reduced-motion', motionChanged);
    lifecycle.connect(St.Settings.get(), 'notify::enable-animations', motionChanged);
    lifecycle.add(() => {
        destroyed = true;
        manager?.destroy();
        coverJob?.cancel();
        backdropJob?.cancel();
        lyricsJob?.cancel();
        try {
            const dir = Gio.File.new_for_path(BACKDROP_DIR);
            const files = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            for (let info; (info = files.next_file(null));)
                dir.get_child(info.get_name()).delete(null);
        } catch {
            // Nothing was written this session.
        }
        artwork.destroy();
        lyrics.destroy();
        if (refreshSource)
            GLib.Source.remove(refreshSource);
        if (visualizerSource)
            GLib.Source.remove(visualizerSource);
    });
    configure();

    return {
        compact, expanded: surface, configure,
        get lyricsOpen() { return showLyrics; },
        get available() {
            return Boolean(active);
        },
        get playing() {
            return active?.status === 'Playing';
        },
        describe() {
            return `${track.title || active?.identity || 'Media Player'} · ${active?.status ?? 'Stopped'}`;
        },
        applyTheme(tokens, alignment) {
            compact.style = `spacing: ${Math.min(8, tokens['compact-spacing'])}px;`;
            expanded.style = `spacing: ${tokens['expanded-spacing']}px;`;
            for (const secondary of [album, elapsed, duration])
                secondary.style = `color: ${tokens['secondary-text-color']};`;
            playerName.style = `color: ${rgbaCss(tokens['text-color'], 0.62)};`;
            artist.style = `color: ${tokens['accent-color']};`;
            liveDot.style = `background-color: ${tokens['accent-color']};`;
            play.style = `background-color: ${tokens['accent-color']}; color: ${inkFor(tokens['accent-color'])};`;
            const accent = tokens['accent-color'];
            lyricToggle.style = `border-color: ${rgbaCss(accent, 0.45)}; color: ${accent};`;
            lyricBadge.style = `background-color: ${accent}; color: ${inkFor(accent)};`;
            lyricsSync.style = `color: ${accent};`;
            lyricStatus.style = `color: ${tokens['secondary-text-color']};`;
            // Beside artwork text reads best start-aligned; stacked follows the setting.
            const stacked = settings.get('media-expanded-layout', 'wide') === 'stacked';
            for (const actor of [title, artist, album])
                actor.x_align = stacked ? alignment : Clutter.ActorAlign.START;
            title.style = `font-size: ${settings.get('media-title-size', 22)}px;`;
            artist.style += ` font-size: ${settings.get('media-artist-size', 15)}px;`;
            main.style = `spacing: ${tokens['expanded-spacing']}px;`;
            hero.style = `spacing: ${tokens['expanded-spacing'] + 12}px;`;
            progressColor = hexToRgb(accent);
            if (progress.mapped)
                progress.queue_repaint();
            visualizers.flatMap(({bars}) => bars).forEach(actor => actor.style = `background-color: ${accent};`);
            // The surface sits flush under the island's top edge, above the dock.
            const radius = Math.max(0, tokens['border-radius'] - tokens['border-thickness']);
            backdropRadius = `border-radius: ${radius}px ${radius}px 0 0;`;
            backdrops.forEach((actor, index) => actor.style = backdropRadius + backdropImages[index]);
            scrim.style = `${backdropRadius} background-gradient-direction: vertical;` +
                ` background-gradient-start: rgba(3, 5, 12, 0.40);` +
                ` background-gradient-end: ${rgbaCss(tokens['surface-color'], Math.max(0.66, tokens['glass-opacity'] * 0.008))};`;
        },
    };
}
