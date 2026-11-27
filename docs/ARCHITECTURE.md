# NOVA Island architecture

NOVA Island is a GNOME Shell 51 extension for Wayland. The Shell process owns the island and handles input, animation, and widget rendering. The preferences process owns the GTK4 and Libadwaita interface. GSettings provides typed, persistent configuration and live change notifications across both processes.

## First milestone

| System | Responsibility |
| --- | --- |
| Island controller | Owns the compact button and the anchored preview, chooses widget views, and coordinates input, visibility, and animation. |
| Panel adapter | Validates the native panel and date menu, installs the compact button, and restores the stock clock and original actor tree on fallback or disable. |
| State manager | Holds the hidden, compact, and expanded states and whether the current expansion is pinned. |
| Event bus | An instance of GNOME Shell’s signal emitter per enable cycle. It conveys state and widget changes to the controller. |
| Widget registry | Maps stable IDs to widget factories. Factories receive the lifecycle and a change callback. Clock and Media Player share the same contract. The registry selects eligible modules by available data, view, priority, and expanded preference. |
| Animation engine | Runs interruptible compositor transitions on geometry and content. Applies values directly when motion is reduced. |
| Layout engine | Computes safe panel and preview bounds from the panel allocation, neighboring indicators, work area, and St theme scale. |
| Lifecycle manager | Disconnects signals, cancels pending work, and destroys actors in reverse registration order. Enable failures use the same cleanup path. |
| Theme manager | Applies the glass opacity and visual state classes. The bundled Shell stylesheet defines color, type, spacing, radius, and elevation. |
| Settings manager | Reads typed settings and observes changes through the Shell lifecycle. Preferences bind their native controls directly to the same schema. |
| Notification manager | Planned. It will translate supported notification events into sanitized previews and apply priority and focus policy before requesting a temporary peek. |

## Panel integration

GNOME’s `addToStatusArea()` centers the middle group as a whole. `panelAdapter.js` uses a balanced `St.Widget` to keep the pill at the panel midpoint. It determines placement from the native date menu container’s current parent. In standard GNOME the parent is usually the center group. In stock GNOME Classic it is the right group, and an extension such as Just Perfection can move it. NOVA uses the live parent and leaves that container in its group.

When the date menu is centered, the slot sits inside the existing container and allocates the pill and the original date button side by side. With a side date menu, the slot contains the pill alone and the date button stays in its side group. A calendar icon temporarily takes the clock label’s place in the original date button. This preserves the menu, notification indicator, and activation behavior. Restoration reinstates the clock label, accessibility metadata, and native container child.

The adapter validates Shell 51’s private panel boxes, the native date button’s container and clock actors, panel ancestry, and mapping. It reacts to changes in actor parenting, relayout, theme, text direction, session mode, work area, and monitor. The geometry follows GNOME’s work-area-relative center allocation, offsets the pill to the physical panel midpoint, and counts the calendar in the group that actually contains it. A centered calendar mirrors to the left in RTL.

The adapter reports `panel-integrated`, `panel-unavailable`, or `floating-fallback` in the journal when placement or its reason changes. A blocked or incompatible slot restores the stock clock. With **Floating fallback** enabled and room below the panel, the controller can still open a preview from the floating pill. Overview, fullscreen, and locked sessions suspend both kinds of pill.

## Input and visibility

In the default configuration the pill stays inside the top bar. The expanded preview sits below the current panel allocation and uses GNOME Shell chrome without reserving workspace. It follows the primary work area, and the stored offsets apply to this preview.

Hovering opens the preview. Leaving starts one cancellable timer, and moving into either surface cancels it. Primary activation pins or collapses the preview, and Escape collapses it while the pill is focused. The controller registers the pill with GNOME’s Ctrl+Alt+Tab switcher. Opening the native calendar closes the NOVA preview.

Overview, primary-monitor fullscreen, and session modes without windows close the preview and return the stock panel. Teardown cancels the leave timer and queued layout before disconnecting observers and restoring the native actors. When Shell exits, the controller cancels callbacks that could otherwise run after Shell destroys its actor tree. The clock continues to follow GNOME’s wall-clock notifications and time format.

## Design tokens

The Shell stylesheet exposes reusable St classes for the glass surface, compact and expanded content spacing, and three text roles. The Shell theme manager applies the shared palette and validated appearance values. GTK previews consume the same tokens in the preferences process.

| Role | Token |
| --- | --- |
| Surface | `.nova-island` supplies the fully rounded panel shape and compact shadow. `.nova-island-popover` supplies the 24 px radius and soft shadow. Both use a 1 px cool-toned border and a fill of RGB 9, 11, 17 at 94% opacity by default. Color, border geometry, opacity, and shadow are editable. |
| Accent and focus | `.nova-island-dot` uses the periwinkle accent. The pinned and focus states increase border contrast. |
| Spacing | `.nova-island-compact` uses a 9 px gap and 1 × 14 px padding. `.nova-island-preview` uses a 6 px gap and 10 × 20 px padding. |
| Type | `.nova-island-time`, `.nova-island-preview-time`, and `.nova-island-preview-date` define compact, display, and supporting type respectively. |
| Motion | The defaults are a 340 ms expansion, 250 ms collapse, and 230 ms content fade. Presets change easing and geometry amplitude. Transition generations guard against stale completion callbacks. |

## Settings and presets

The existing settings schema and path are retained. The preferences process binds controls to GSettings and renders an isolated GTK sample. The Shell process reads the same keys through `SettingsManager`. Built-in themes share one token table. Applying a theme or preset batches writes and validates the data first. The version 1 JSON preset stores editable keys. Saved preset lists and the last manually selected player are local state.

| New settings | GSettings keys |
| --- | --- |
| Appearance | `border-radius`, `border-thickness`, `border-opacity`, `shadow-intensity`, `shadow-blur`, `shadow-spread`, `surface-color`, `border-color`, `accent-color`, `text-color`, `secondary-text-color`, `clock-font-size`, `compact-spacing`, `expanded-spacing`, `content-alignment`, `theme`, `saved-presets` |
| Motion and input | `expand-duration`, `collapse-duration`, `content-fade-duration`, `animation-intensity`, `animation-style`, `hover-expand`, `click-to-pin` |
| Modules | `clock-enabled`, `clock-compact`, `clock-expanded`, `clock-priority`, `media-enabled`, `media-compact`, `media-expanded`, `media-priority`, `default-expanded-module` |
| Media | `media-expanded-layout`, `media-title-size`, `media-artist-size`, `media-control-size`, `media-animations`, `media-artwork-cache`, `media-artwork`, `remote-artwork`, `artwork-size`, `media-visualizer`, `visualizer-intensity`, `track-previews`, `track-preview-duration`, `default-player`, `last-player`, `player-priority`, `lyrics-enabled`, `lyrics-mode` |

The existing `glass-opacity` setting now accepts 0–100 percent and keeps its 94 percent default. Existing dimensions, offsets, animation speed, reduced motion, leave delay, and floating fallback retain their keys and defaults.

## Media runtime

`MediaManager` subscribes to D-Bus name-owner changes and attaches cancellable proxies for the root and player interfaces. A player client handles properties, capabilities, and commands independently of the St view. It anchors playback time to reported position, rate, playback status, and Seeked signals. The view refreshes its progress display only while it is visible and playback is active. Player commands use the unique owner, so disconnects or name reuse during a command cannot redirect it.

The widget presents Clock or Media through the same controller. Temporary media previews use the normal expansion state and a bounded timer. A playback change preserves the last allocated panel anchor while the compact text or icon relayout completes. The optional visualizer updates visible bars only during playback and obeys reduced motion.

Artwork and lyrics use cancellable asynchronous I/O. The artwork cache stores up to 20 decoded images or failures in memory. Successful art expires after ten minutes and failures after 30 seconds. Local inputs must be regular files. Artwork requests require a direct HTTPS response or loopback HTTP. Artwork limits are 2 MiB and 4,096 pixels per side before decode, with images downscaled before upload to St. The lyrics cache holds up to 24 entries with a 30-minute success lifetime and short miss or error lifetimes. Requests have a deadline, bounded response bodies, and a cooldown after rate limits. With lyrics enabled, a change to the selected track signature triggers an exact lookup on LRCLIB. A miss triggers a search with artist, title, and duration matching. The HTTP implementation uses asynchronous libsoup and Gio. On disable, NOVA cancels requests and releases its memory caches. [MPRIS player specification](https://specifications.freedesktop.org/mpris/latest/Player_Interface.html) · [LRCLIB API](https://lrclib.net/docs)

## Module boundaries

- `extension.js` composes Shell modules under `src/shell/`.
- `prefs.js` is the preferences entry point and uses Gio, GTK4, and Libadwaita.
- `schemas/` defines the persistent contract. Future shared JavaScript must stay process-independent.
- Features that must work while the extension is disabled, such as persistent alarms, belong in a separately managed companion process. Design its versioned D-Bus interface and failure handling when the first persistent feature needs it.
- Feature modules own their platform adapters. Widgets receive presentation data through small interfaces and keep I/O, retention policy, and privileged operations out of the controller.

## Karaoke rendering in 0.3.2

On a cache miss, the provider sends the bounded HTTP payload to a short-lived GJS subprocess through an asynchronous pipe. The worker performs JSON decoding, search-result selection and Lyricsfile YAML or LRC parsing. It returns a normalized document. A word document is limited to 2,048 lines and 8,192 words. YAML parsing uses the bundled js-yaml 5.5.0 with aliases disabled and nesting limited to 16. Cancelling a track lookup also terminates its parser. Shell decodes the normalized result once and caches it.

Word mode requires a positive provider flag and usable timestamps that map to the original line text. Cues store absolute seconds and word character ranges. Optional end times clear the highlight in gaps. Lines without word timings can still follow their supplied line start. The worker falls back to LRC, then plain text. The playback path uses binary search over sorted cues.

The panel reuses five labels. It measures wrapped rows when the visible window or styling changes, and uses Clutter translation, scale and opacity for transitions. Word color changes use escaped Pango markup. A visible, advancing timed view samples the local monotonic playback clock every 32 ms. D-Bus changes and seeks refresh it immediately. The tick stops on pause, collapse, end or teardown. The island controller sizes the active lyrics view through the existing scaled, monitor-clamped geometry function.
