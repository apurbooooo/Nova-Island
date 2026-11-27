# GNOME 51 compatibility

## Development host

| Component | Installed version |
| --- | --- |
| Distribution | CachyOS Linux |
| Session | GNOME Classic on Wayland |
| GNOME Shell and Mutter | 51.1 |
| GJS | 1.90.1 |
| GTK | 4.24.2 |
| Libadwaita | 1.10.0 |
| GLib | 2.90.1 |
| GNOME Desktop | 51.0 |

The GNOME 51 porting guide specifies synchronous `disable()`, `orientation` for St box layouts, modern Clutter event controllers, updated St button mask names, and `St.Settings.reducedMotion`. The extension follows those interfaces. [GNOME Shell 51 porting guide](https://gjs.guide/extensions/upgrading/gnome-shell-51.html)

The installed GI libraries expose the Clutter motion and key controllers, St animation settings and button masks, `GnomeDesktop.WallClock`, and Libadwaita spin rows. The adapter’s dependencies were checked against GNOME Shell 51.1’s embedded `panel.js`, `panelMenu.js`, `dateMenu.js`, and `sessionMode.js`.

GNOME’s extension examples use `Main.panel.addToStatusArea()`. Exact centering while preserving the original date button uses private Shell 51 APIs. The adapter reads `Main.panel._centerBox`, `_leftBox`, and `_rightBox`, along with `statusArea.dateMenu.container`, the date button’s `label_actor`, and its clock child box. The manifest targets GNOME 51. [GNOME extension API example](https://gjs.guide/extensions/topics/extension.html)

## Active desktop diagnosis on 27 November 2026

The active CachyOS desktop ran GNOME Classic 51.1 on Wayland at 1920 × 1080. NOVA 0.2.0 reported `ACTIVE`. Its installed panel adapter matched the repository version before this fix. The journal showed a mapped 1920 × 32 native panel, a mapped 203 × 32 center group holding the native date menu, and side groups requesting 382 px and 599 px. NOVA’s 96 × 25 fallback was parented to `uiGroup` at stage position (912, 40).

Classic’s configuration put `dateMenu` in the right group. Just Perfection was active with its clock-menu position set to center, and its implementation moves the existing date-menu container between panel boxes. NOVA 0.2.0 treated the configured right group as mandatory. The live parent check failed before geometry or mounting, leaving the stock clock intact and activating the floating pill. The earlier side-calendar width calculation was a separate issue. NOVA 0.2.1 follows the live parent, measures the icon presentation in its actual group, and makes floating fallback opt-in.

## Verification on GNOME Shell 51.1

| Check | Result |
| --- | --- |
| Bundle and schema | All JavaScript passed syntax validation. The strict schema check, extension packaging, ZIP integrity check, and repeated forced installation into an isolated data directory passed. |
| Standard GNOME | All 13 smoke groups passed in a headless Wayland session at 1280 × 720. |
| GNOME Classic | All 13 smoke groups passed in a headless Wayland session at 800 × 600. |
| Panel regressions | The smoke suite moved the original date-menu container between all three groups, mirrored the centered calendar in RTL, and exercised a center conflict, an oversized side group, opt-in fallback, and recovery. |
| Input and lifecycle | The suite exercised hover and animated collapse, pointer pinning, Enter, Space, Escape, focus-group registration, native calendar activation, live preferences, overview, fullscreen, lock-screen mode, and three disable/enable cycles. |
| Layout math | Synthetic asymmetric work-area and nonzero monitor-origin checks passed for LTR and RTL at scale inputs of 1, 1.25, and 2. |
| Just Perfection reproduction | An isolated 1920 × 1080 Classic session used the installed Just Perfection version and its clock placement settings. The live center group held the native date-menu container while the session configured it on the right. NOVA placed a 172 × 28 pill at (874, 2) inside the 1920 × 32 panel. Compositor screenshots confirmed the compact pill, hover preview, and the original calendar and notifications popup. |

The active desktop was inspected through D-Bus, installed sources and settings, and its journal. The live session’s screenshot service denied direct capture, and the running session still held the imported 0.2.0 module. Visual verification of 0.2.1 took place in the isolated compositor.

The isolated host logged a missing `libecal-2.0.so.3` for GNOME Calendar Server and a missing `GMenu` typelib for Classic’s Apps Menu. The original date popup opened and showed the calendar and notifications interface. Calendar event loading, physical fractional scaling, monitor hotplug, and screen-reader behavior still need coverage. The headless test verifies the Ctrl+Alt+Tab focus group through GNOME’s focus manager. [Test procedure](../README.md#test)

## 0.3.0 verification on 27 November 2026

| Check | Result |
| --- | --- |
| Studio | All built-in theme token sets, live Shell typography and alignment, the Clock module toggle, JSON file import and export, and malformed preset rejection passed. |
| Standard GNOME and GNOME Classic | Both GNOME Shell 51.1 headless Wayland runs passed all 14 smoke groups. The suites covered panel placement, the native calendar, RTL, reduced motion, fullscreen, lock mode, preferences launch, and repeated enable and disable. |
| Media in Shell | The Wayland test with two mock players passed compact and expanded rendering, local artwork upload, timed previews without focus theft, pointer and keyboard controls, player departure, unsupported capability states, and disable cleanup. |
| Media service | Private D-Bus tests passed discovery, playback, seek, shuffle, repeat, and player shutdown. HTTP artwork used a local test server. A live LRCLIB lookup returned both plain and timed lyrics. Injected failures exercised cached misses, network errors, and rate-limit cooldown. |
| Real players | VLC 3.0.24 passed discovery, duration, Play, Pause, and Seek. Brave 158 passed discovery, track metadata, Play, and Pause using a local media page. Firefox 161 did not expose a usable MPRIS player for the test page in the isolated session. Spotify was untested. |
| Bundle | JavaScript syntax, strict schema validation, ZIP integrity, and two forced upgrades over a copy of 0.2.1 passed. The upgrade retained one extension directory and the existing UUID and schema. |

The GTK Studio and Shell media views were inspected in compositor screenshots from isolated sessions. The active desktop retained the installed 0.2.1 extension. The production bundle was built from the tested source and the visual checks used test profiles and media. The host’s known Calendar Server and Classic Apps Menu dependencies remained separate from the extension tests.

Artwork decode was exercised with PNG. JPEG and WebP acceptance depend on the installed GdkPixbuf loaders. The visualizer uses playback state. Glass uses St translucency, border, and shadow. Monitor hotplug, physical fractional scaling, screen readers, Spotify, and Firefox playback on a regular desktop remain follow-up coverage.

## 0.3.2 karaoke verification on 27 November 2026

| Evidence | Result |
| --- | --- |
| Mock player and parser | Private D-Bus players and an injected monotonic clock covered exact word/line boundaries, gaps, forward and backward seeks, paused position, resume at 2× rate, duration clamp, stop, track replacement and player selection. Provider fixtures covered malformed/missing timing, plain text, cache hits/misses, rate limiting and network errors. |
| Live LRCLIB API | The production provider parsed “Diamond Heart” by Sophia Somajo into 74 lines with 536 word starts. “I Want to Live” by Borislav Slavov returned 47 LRC cues. Catalog contents may change. |
| GTK preferences | An in-memory GTK4/Libadwaita preferences window updated its preview on plain font-size and word-color changes. |
| Real Spotify MPRIS | The desktop client exposed a paused advertising item with an empty artist, duration 24.946 s and position 17.890 s. Audible song synchronization remains unverified. |
| GNOME Shell visual check | The 51.1 isolated Wayland compositor rendered the 620 × 540 panel with a synthetic track. Its screenshot shows the centered line, active word, surrounding lines and navigation. The Shell suites exercised the native panel, clock, media, seeking, plain text, reduced motion and disable cleanup. The active desktop extension was left installed at its previous version. |

The 32 ms refresh interval governs visual sampling. Player timestamp accuracy, recording/version matching, display scheduling and audio output latency affect what the listener sees and hears. The tests measure cue selection and clock interpolation. [Compositor capture](karaoke-preview.png) · [LRCLIB API](https://lrclib.net/docs)

## Notifications foundation on 27 November 2026

The installed Shell reports 51.1. Its notification JavaScript was not installed as loose files, so the matching [GNOME Shell 51.1 source](https://github.com/GNOME/gnome-shell/blob/51.1/js/ui/messageTray.js) was used to verify `source-added`, `source-removed`, `notification-added`, `getSources()`, source policy, and urgency values. The installed desktop notification schema provides the global banner setting. NOVA listens to those signals and retains only source names and titles while enabled and unlocked.

| Check | Result |
| --- | --- |
| Automated Shell integration | An isolated GNOME Shell 51.1 run passed incoming preview, configured peek duration, Do Not Disturb, Focus Mode critical priority, 20-item history bound, local clearing, lock hiding, and disable cleanup. |
| Existing Shell regression | The standard Shell smoke suite passed all existing groups after the module was added. |
| Real desktop applications | **UNVERIFIED.** The integration check used synthetic Shell notifications. Application-specific privacy, banner policy, and accessibility need active-desktop checks. |

Reproduce with the extension bundle and `tests/notificationsSmoke.js` using the headless Wayland command in the README. Enable Notifications in the Modules preferences. NOVA's Do Not Disturb and Focus Mode govern NOVA previews only. Native GNOME banners and the notification list continue to use their own policies. NOVA clears its session history on disable and lock.

## Productivity foundation on 27 November 2026

| Check | Actual result |
| --- | --- |
| Pure timing model | `gjs -m tests/productivity.js` passed exact elapsed calculations, pause/resume, one completion, focus/break transitions, lap persistence, paused recovery, reset, and malformed snapshot rejection. The clock was injected and simulated. |
| Shell integration | `tests/productivitySmoke.js` passed calendar actor creation, UTC world-clock display, stopwatch timing, countdown completion, focus activation/pause, module disable, extension disable/re-enable, and preserved paused state in isolated GNOME Shell 51.1 Wayland. |
| Regressions | Studio, media service, media Shell, notification Shell, and standard Shell smoke suites passed with Productivity present. |
| Real calendar events | **UNVERIFIED.** CalendarServer cannot start on this host because libecal-2.0.so.3 is missing. The view reports unavailable events. |
| Physical suspend/resume | **UNVERIFIED.** Timers use Linux monotonic awake time, which excludes suspend. Hardware sleep was not induced. |
| Active desktop visual and accessibility inspection | **UNVERIFIED.** Tests used an isolated compositor and programmatic actor assertions. |

Run `gjs -m tests/productivity.js` for timing tests. Use the README's isolated Shell packaging command with `tests/productivitySmoke.js` for integration. Enable Productivity in Modules, choose it as the default expanded module or use its tab, then select Calendar, World, Stopwatch, Timer, or Focus. Configure IANA zones and interval lengths on the Productivity preferences page. Reset applies a new duration to an existing countdown.

For desktop verification, use a calendar with known events, navigate between dates and months, and compare selected-day summaries with GNOME Calendar. Start a stopwatch and countdown, suspend the machine, then confirm they advance only by awake time. Restart Shell or log back in and confirm saved timers open paused. Exercise focus pause, break completion, native DND, keyboard navigation, and large text. Alerts require an enabled extension and running Shell. Persistent alarms across logout/reboot require a future companion service.

## Desktop Tools foundation on 27 November 2026

All five tools are disabled by default. Enable them in Modules. Clipboard additionally requires the explicit Capture clipboard switch in Desktop Tools preferences. Clipboard history stays in memory and is cleared on lock, capture off, module disable, or extension disable. Pinned entries expire only through hard limits or clearing. Sensitive-content filtering is heuristic and cannot guarantee exclusion of every secret.

| Evidence | Actual result |
| --- | --- |
| Automated module logic | `gjs -m tests/desktopTools.js` passed clipboard pin/limit/expiry/search/filter rules, image de-duplication, emoji search/recents, CPU/memory/network calculations and resets, cancelled I/O, and mock portal success, cancellation, refusal, and unavailable-service handling. |
| Shell 51.1 Wayland integration | `tests/desktopToolsSmoke.js` passed capture opt-in, real compositor text/PNG transfers using synthetic clipboard items, PRIMARY exclusion, sensitive-text filtering, search/clear, offline emoji copying, real procfs sampling, native Quick Settings menu open/close, screenshot selector open/cancel, lock hiding, and extension disable/re-enable cleanup. |
| Regression suites | Studio, media services, Productivity model, Notifications Shell, Productivity Shell, Media Shell, and standard Shell suites passed with all five factories registered. JavaScript syntax, schema compilation, and diff whitespace checks passed. |
| Isolated compositor visual inspection | Emoji and System Monitor captures were inspected. The monitor displayed live CPU, memory, network, thermal-zone and BAT0 capacity values from the host kernel. This was an isolated compositor view. |
| Real desktop verification | **UNVERIFIED.** Target-application paste, actual capture/export, interactive portal save, screen recording output, Wi-Fi/Bluetooth device operations, audio/display changes, Night Light, lock/power confirmation, assistive technologies, and localized layouts were not exercised on the active desktop. |
| GPU and other hardware | **UNVERIFIED** on other drivers and hardware. GPU utilization is shown only for readable DRM `gpu_busy_percent` counters. Missing sensors and unavailable volume/brightness are omitted. |

The emoji collection is an offline subset with symbols and kaomoji. Selection copies text for an explicit paste into the destination application. Arbitrary typing into other Wayland applications is outside this implementation. Clipboard history has configurable local session retention and no disk persistence. System Monitor aggregates all non-loopback network interfaces, including virtual interfaces.

Screenshot Studio delegates full-screen/window/area choice to GNOME. Recording remains in GNOME's native UI, with screen/area support according to the backend. Shell 51.1's window-recording path is unsupported. Screenshot Save a copy uses the file chooser portal and Copy image uses the last explicitly requested capture. Actual portal selection and export remain UNVERIFIED, and cancellation/service failure are covered using a mocked transport. Shell's native recording indicator and stop action remain responsible for an ongoing recording after NOVA is disabled.

To reproduce automated checks, run `gjs -m tests/desktopTools.js`. For integration, use the README's isolated Wayland packaging command with `tests/desktopToolsSmoke.js`. Optional `NOVA_TEST_SCREENSHOTS` captures the test Emoji and System Monitor views to an existing directory. The test uses synthetic clipboard payloads and native selectors, cancels capture, and avoids changing hardware settings.

For real desktop verification, first enable the desired tools. Copy ordinary text and a PNG, search, pin/unpin, select to restore, clear, then lock/unlock and confirm history is empty. Test password-manager secret hints and custom exclusions with disposable test values. Search an emoji, navigate with Down/Tab/Enter, and paste in a text application. In Screenshot Studio, explicitly select each capture mode and test cancellation, clipboard output, local Save a copy, recording indicators, and Stop. Check native DND and lockdown policies. Compare monitor readings with a system tool and test devices appearing/disappearing. Open Wi-Fi/Bluetooth controls and test pairing/authentication, then verify volume, available brightness, Night Light, Lock, and the native power confirmation dialog. Check narrow layouts, large text, reduced motion, and screen-reader labels. These manual checks remain open in the roadmap.
