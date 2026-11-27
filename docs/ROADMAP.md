# NOVA Island roadmap

## Milestone 1 · Shell foundation

- [x] Add native Shell chrome, compact and expanded clock views, hover, pinning, and configurable leave delay.
- [x] Add live GSettings preferences for geometry, placement, opacity, and animation.
- [x] Add synchronous lifecycle teardown and reduced-motion handling.
- [x] Verify activation, input, visibility, preferences, and teardown in GNOME 51.1 headless Wayland.
- [x] Integrate the compact pill into the native top bar and anchor the date preview below it.
- [x] Preserve GNOME’s calendar and notification menu and restore the stock clock when the center slot is unavailable.
- [x] Run the panel smoke suite in standard GNOME and GNOME Classic.
- [x] Follow the live date-menu parent in standard GNOME and Classic, including Just Perfection’s clock placement.
- [x] Log placement changes and offer an opt-in floating fallback with the stock clock visible.
- [x] Verify centered placement, hover preview, and the original calendar in an isolated GNOME Classic reproduction with Just Perfection.
- [ ] Review appearance at fractional scaling, in high contrast, and with long localized dates.
- [ ] Exercise monitor changes and windowed nested Wayland interaction across more hardware.

## Milestone 2 · Dynamic content

- [x] **Media.** Discover MPRIS players and support switching, playback controls, artwork, and progress.
- [x] Add a playback-state visualizer, configurable previews, and opt-in timed and plain LRCLIB lyrics.
- [x] Ship the 0.3.2 karaoke view with word, line and plain modes, manual navigation, live settings and compositor coverage.
- [ ] Compare audible lyrics against a matching word-timed recording during real Spotify playback.
- [ ] Broaden coverage to Firefox and Spotify after VLC and Brave verification, and investigate an audio-data visualizer.
- [ ] **Notifications.** Verify Shell notification hooks, then build the notification manager, previews, bounded history, configurable peek duration and automatic expansion, priority rules, Do Not Disturb, and focus mode. Respect Shell privacy and lock-screen state.
- [ ] **Productivity.** Add calendar, world clocks, stopwatch, countdown, Pomodoro, and focus sessions. Use monotonic time for elapsed timers. Add persistent alarms through the companion service and recover scheduled alarms after session restarts.

## Milestone 3 · Desktop tools

- [ ] **Clipboard.** Validate user-authorized Wayland clipboard APIs before offering history. Add searchable, pinnable text and images, local retention controls, and sensitive-content filtering. Keep capture opt-in and expose a clear-off switch and history deletion.
- [ ] **Emoji.** Add an offline searchable picker for emoji, symbols, and kaomoji, with local recent items.
- [ ] **Screenshot Studio.** Use Shell or XDG Desktop Portal consent flows for fullscreen, window, and area capture and recording where supported. Add user-directed clipboard export and save location.
- [ ] **System monitor.** Add CPU, memory, GPU, temperature, battery, network rates, volume, and brightness. Subscribe to service signals where possible and sample counters only while needed. Omit unavailable sensors gracefully.
- [ ] **Quick settings.** Add Wi-Fi, Bluetooth, audio, brightness, Night Light, lock, and power using supported interfaces. Reflect unavailable features and preserve authentication or confirmation where the platform requires it.

## Milestone 4 · Customization Studio

- [x] Extend dimensions and placement with configurable color, glass, border, shadow, typography, spacing, and motion.
- [x] Add theme presets, a GTK preview, module visibility and priority, versioned import and export, and strict preset validation.
- [ ] Evaluate supported compositor blur and broaden live preview coverage for media.
- [ ] Expand keyboard and assistive-technology coverage and publish a repeatable stability and performance matrix.
