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
- [x] **Notifications foundation.** Verify Shell 51.1 source and tray signals, add opt-in previews, 20-item session history, configurable peek duration, priority rules, NOVA Do Not Disturb and Focus Mode, local dismissal, and lock-screen clearing. Cover these paths in an isolated Shell 51.1 session.
- [ ] **Notifications desktop verification.** Exercise real application notifications, accessibility, and privacy behavior in the active desktop before calling the module complete.
- [x] **Productivity foundation.** Add calendar navigation, event-source integration, configurable world clocks, stopwatch with laps, countdown completion alerts, focus/break intervals, and NOVA Focus Mode integration. Verify monotonic timing, paused recovery, and isolated Shell lifecycle checks.
- [ ] **Productivity desktop verification.** Verify real calendar events, physical suspend/resume, localized layouts, accessibility, and long sessions on the active desktop. These checks remain UNVERIFIED.
- [ ] **Persistent alarms.** Design and verify a companion service before promising delivery while logged out or after reboot.

## Milestone 3 · Desktop tools

- [x] **Clipboard foundation.** Add opt-in Wayland CLIPBOARD capture, session-local searchable text/PNG history, pins, item/byte/age limits, secret hints and text exclusions, clear/delete, cancellation, and lock/disable cleanup. Verify transfers in isolated Shell 51.1.
- [x] **Emoji foundation.** Add a curated offline collection of emoji, symbols, and kaomoji, search, keyboard selection, clipboard insertion workflow, and persisted recent items.
- [x] **Screenshot Studio foundation.** Open native GNOME screenshot/recording selectors, retain an explicitly requested capture for clipboard export, and implement Save a copy through the file chooser portal. Verify selector cancellation and mock portal responses.
- [x] **System monitor foundation.** Sample CPU, memory, network, and available Linux temperature/battery/GPU counters asynchronously while visible. Read native volume and brightness when available.
- [x] **Quick Settings foundation.** Expose native device-menu access, audio/volume, available brightness and Night Light, lock, and the native power confirmation path. Verify native menu opening in isolated Shell 51.1.
- [ ] **Desktop Tools verification.** Verify interactive screenshot export and recording, portal file selection, target-app paste, radio and display controls, power confirmation, screen readers, localization, and other GPU/sensor drivers on the active desktop. These paths remain UNVERIFIED.

## Milestone 4 · Customization Studio

- [x] Extend dimensions and placement with configurable color, glass, border, shadow, typography, spacing, and motion.
- [x] Add theme presets, a GTK preview, module visibility and priority, versioned import and export, and strict preset validation.
- [ ] Evaluate supported compositor blur and broaden live preview coverage for media.
- [ ] Expand keyboard and assistive-technology coverage and publish a repeatable stability and performance matrix.
