import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {CLOCK_FONTS, clockFont} from '../src/shared/clockFonts.js';
import {ModuleScroll} from '../src/shared/moduleScroll.js';
import {WidgetRegistry} from '../src/shell/widgetRegistry.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const scroll = new ModuleScroll();
assert(scroll.step(0, 1, 0, true) === 1, 'first notch immediate');
assert(scroll.step(0, 1, 20, true) === 0, 'noisy notch suppressed');
assert(scroll.step(0, -1, 160, true) === -1, 'up notch');
scroll.reset();
assert(scroll.step(0, 0.3, 0) === 0, 'substep');
assert(scroll.step(0, 0.3, 20) === 0, 'accumulate');
assert(scroll.step(0, 0.4, 40) === 1, 'smooth full step');
assert(scroll.step(0, 8, 60) === 0, 'smooth noisy burst');
assert(scroll.step(0, 8, 200) === 1, 'one switch for large delta');
assert(scroll.step(3, 0.1, 400) === 0, 'horizontal gesture ignored');
scroll.reset();
scroll.step(0, 0.8, 0);
assert(scroll.step(0, 0.4, 300) === 0, 'idle resets accumulator');
assert(scroll.step(0, -0.8, 350) === 0, 'reverse resets accumulator');
assert(scroll.step(0, -0.2, 370) === -1, 'reverse full step');
assert(clockFont('"; color: red;') === '', 'CSS family whitelist');
assert(CLOCK_FONTS.length === 10 && new Set(CLOCK_FONTS).size === 10, 'ten fonts');
const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent();
const [, contents] = root.get_child('fonts/manifest.json').load_contents(null);
const manifest = JSON.parse(new TextDecoder().decode(contents));
assert(manifest.fonts.length === 10, 'ten bundled files');
for (const item of manifest.fonts) {
    const font = root.get_child(`fonts/${item.file}`);
    const [, data] = font.load_contents(null);
    assert(data.length > 10000, `font data ${item.family}`);
    const [, license] = font.get_parent().get_child('OFL.txt').load_contents(null);
    assert(new TextDecoder().decode(license).includes('SIL OPEN FONT LICENSE'), `OFL ${item.family}`);
    const check = Gio.Subprocess.new(['fc-scan', '--format', '%{family}\n', font.get_path()], Gio.SubprocessFlags.STDOUT_PIPE);
    const [, output] = check.communicate_utf8(null, null);
    assert(check.get_successful() && output.trim().split(/[\n,]/).includes(item.family), `internal TTF family ${item.family}`);
    item.sha256 = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, data);
}
print('PASS wheel noise, smooth accumulation/reversal/idle reset, one switch per event; ten real font families and OFLs');

const registry = new WidgetRegistry();
const clock = {};
const media = {playing: true};
const notifications = {};
const widgets = new Map([['clock', clock], ['media', media], ['notifications', notifications]]);
const config = new Map([['media-priority', 100], ['clock-priority', 10]]);
for (const id of widgets.keys())
    config.set(`${id}-enabled`, true);
const settings = {get: (key, fallback) => config.get(key) ?? fallback};
assert(registry.select(widgets, settings, 'expanded') === clock, 'automatic opening prefers Time');
assert(registry.select(widgets, settings, 'compact') === media, 'compact pill prefers playing media');
assert(registry.candidates(widgets, settings, 'expanded').some(([id]) => id === 'notifications'),
    'notifications remain eligible for an event preview');
media.playing = false;
assert(registry.select(widgets, settings, 'compact') === clock, 'compact pill restores Time on pause');
config.set('default-expanded-module', 'media');
assert(registry.select(widgets, settings, 'expanded') === media, 'explicit Media default wins');
config.set('media-expanded', false);
assert(registry.select(widgets, settings, 'expanded') === clock, 'hidden explicit defaults fall back to Time');
config.set('clock-expanded', false);
assert(registry.select(widgets, settings, 'expanded') === notifications, 'hidden Time falls back to available modules');
print('PASS automatic Time, compact media, explicit defaults and expanded visibility');
