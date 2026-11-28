import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {sleep, waitTestWindows} from 'resource:///org/gnome/shell/ui/scripting.js';
import {CLOCK_FONTS} from '../src/shared/clockFonts.js';

const UUID = 'nova-island@fromapurbo';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let keepAlive = 0;
export function finish() { if (keepAlive) GLib.Source.remove(keepAlive); keepAlive = 0; }
function find(actor, name) {
    if (actor?.name === name) return actor;
    for (const child of actor?.get_children() ?? []) {
        const found = find(child, name);
        if (found) return found;
    }
    return null;
}
function styled(actor, style) {
    if (actor?.has_style_class_name?.(style)) return actor;
    for (const child of actor?.get_children() ?? []) {
        const found = styled(child, style);
        if (found) return found;
    }
    return null;
}
async function until(condition, description) {
    for (let i = 0; i < 350; i++) {
        if (condition()) return;
        await sleep(20);
    }
    throw new Error(`Timed out: ${description}`);
}
const family = label => label.clutter_text.get_layout().get_iter().get_run_readonly().item.analysis.font.describe().get_family();
const typography = label => {
    const font = label.get_theme_node().get_font();
    return {size: font.get_size(), weight: font.get_weight(), style: font.get_style(),
        stretch: font.get_stretch(), variant: font.get_variant(), align: label.x_align};
};
export async function run() {
    await waitTestWindows();
    keepAlive = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
        void waitTestWindows(); return GLib.SOURCE_CONTINUE;
    });
    await until(() => Main.extensionManager.lookup(UUID)?.stateObj, 'extension');
    const extension = Main.extensionManager.lookup(UUID).stateObj;
    const settings = extension.getSettings();
    const pill = () => find(Main.panel, 'nova-island');
    const preview = () => find(Main.layoutManager.uiGroup, 'nova-island-preview');
    const small = () => find(pill(), 'nova-clock-compact-time');
    const large = () => find(preview(), 'nova-clock-large-time');
    Main.overview.hide();
    settings.set_boolean('hover-expand', false);
    settings.set_boolean('reduce-motion', true);
    settings.set_boolean('media-enabled', false);
    settings.set_boolean('clipboard-enabled', true);
    settings.set_string('default-expanded-module', 'clock');
    await until(() => small()?.mapped, 'compact clock');
    pill().emit('clicked', 0);
    await until(() => large()?.mapped, 'expanded clock');
    const references = [small(), large()];
    const defaults = references.map(family);
    const before = references.map(typography);
    const date = styled(preview(), 'nova-island-preview-date');
    const weekday = styled(preview(), 'nova-clock-weekday');
    const unrelatedFonts = [family(date), family(weekday)];
    pill().emit('clicked', 0);

    const control = GLib.dir_make_tmp('nova-font-preferences-XXXXXX');
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
    launcher.setenv('NOVA_FONT_CONTROL_DIR', control, true);
    launcher.setenv('GSETTINGS_SCHEMA_DIR', extension.dir.get_child('schemas').get_path(), true);
    // Keep the test tool's keyfile backend and XDG directories: GTK and Shell
    // must communicate through real cross-process GSettings change signals.
    const driverPath = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('clockFontPreferencesDriver.js').get_path();
    const driver = launcher.spawnv(['gjs', '-m', driverPath]);
    const response = () => {
        try { return JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${control}/response.json`)[1])); }
        catch { return null; }
    };
    let serial = 0;
    const request = async (chosen, size = undefined) => {
        serial++;
        GLib.file_set_contents(`${control}/command.json`, JSON.stringify({serial, family: chosen, size}));
        await until(() => response()?.serial === serial, 'preferences response');
        const data = response();
        assert(data.status === 'applied', `GTK preferences: ${JSON.stringify(data)}`);
        assert(data.selected === chosen, 'dropdown did not save selected family');
        await until(() => settings.get_string('clock-font') === chosen, 'Shell received GSettings change');
        return data;
    };
    const screenshot = async (name, compact) => {
        const directory = GLib.getenv('NOVA_TEST_SCREENSHOTS');
        if (!directory) return;
        await sleep(50);
        const actor = compact ? pill() : preview();
        const [x, y] = actor.get_transformed_position();
        const stream = Gio.File.new_for_path(`${directory}/${name}.png`).replace(null, false, Gio.FileCreateFlags.NONE, null);
        try {
            await new Shell.Screenshot().screenshot_area(Math.floor(x), Math.floor(y),
                Math.ceil(actor.width), Math.ceil(actor.height), stream);
        } finally { stream.close(null); }
    };
    let driverClosed = false;
    try {
        await until(() => response()?.status === 'ready', 'actual GTK font selector');
        if (GLib.getenv('NOVA_EXPECT_FONT_FALLBACK')) {
            await request('Space Grotesk');
            await until(() => small().style.includes('Space Grotesk'), 'compact fallback style');
            assert(family(small()) !== 'Space Grotesk' && family(small()).length > 0, 'expected readable missing-font fallback');
            pill().emit('clicked', 0);
            await until(() => large().mapped, 'expanded fallback');
            assert(family(large()) !== 'Space Grotesk' && family(large()).length > 0, 'expanded missing-font fallback');
            assert(settings.get_string('clock-font') === 'Space Grotesk', 'fallback erased selection');
            await request('');
            await until(() => references.every((label, index) => family(label) === defaults[index]), 'System Default after fallback');
            print('PASS absent bundled family falls back readably in actual compact/expanded St.Labels; selection retained and System Default restored');
        } else {
            for (let i = 0; i < CLOCK_FONTS.length; i++) {
                const chosen = CLOCK_FONTS[i];
                if (preview().mapped) pill().emit('clicked', 0);
                const data = await request(chosen);
                assert(data.previewFamilies.every(value => value === chosen), `GTK previews for ${chosen}: ${data.previewFamilies}`);
                await until(() => family(small()) === chosen, `compact St/Pango family ${chosen}`);
                await screenshot(`${chosen.toLowerCase().replaceAll(' ', '-')}-compact`, true);
                pill().emit('clicked', 0);
                await until(() => large().mapped && family(large()) === chosen, `expanded St/Pango family ${chosen}`);
                assert(JSON.stringify([small(), large()].map(typography)) === JSON.stringify(before), `${chosen} changed size/weight/alignment`);
                assert(family(date) === unrelatedFonts[0] && family(weekday) === unrelatedFonts[1], 'clock family leaked to date/weekday');
                await screenshot(`${chosen.toLowerCase().replaceAll(' ', '-')}-expanded`, false);
                find(preview(), 'nova-module-clipboard').emit('clicked', 0);
                await until(() => find(preview(), 'nova-clipboard').mapped, 'switch away from Clock');
                find(preview(), 'nova-module-clock').emit('clicked', 0);
                await until(() => large().mapped, 'return to Clock');
                assert(small() === references[0] && large() === references[1], 'font selection recreated clock actors');
                assert(family(small()) === chosen && family(large()) === chosen, 'module switch lost font');
                // Change both live mapped labels several times without restarting.
                const alternate = CLOCK_FONTS[(i + 1) % CLOCK_FONTS.length];
                await request(alternate);
                await until(() => family(small()) === alternate && family(large()) === alternate, 'live mapped font update');
                await request(chosen);
                await until(() => family(small()) === chosen && family(large()) === chosen, 'live mapped font restored');
                print(`PASS ${chosen}: GTK dropdown/three rendered previews -> GSettings -> compact/expanded St.Labels, module return, live changes, size/weight/alignment retained`);
            }
            await request('');
            await until(() => references.every((label, index) => family(label) === defaults[index]), 'System Default restored');
            assert(references.every(label => !label.style.includes('font-family')), 'System Default retained inline family');
            await request('Manrope', 17);
            await until(() => small().get_theme_node().get_font().get_size() / Pango.SCALE === 17 &&
                large().get_theme_node().get_font().get_size() / Pango.SCALE === 61, 'font-size token preserved');
            await request('Manrope', 14);
            Main.extensionManager.disableExtension(UUID);
            await sleep(100);
            Main.extensionManager.enableExtension(UUID);
            await until(() => small()?.mapped && family(small()) === 'Manrope', 'font restored after re-enable');
            pill().emit('clicked', 0);
            await until(() => large()?.mapped && family(large()) === 'Manrope', 'expanded font restored after re-enable');
            assert(Main.extensionManager.lookup(UUID).stateObj.getSettings().get_string('clock-font') === 'Manrope', 'font setting not persistent');
            print('PASS System Default, independent size setting, fresh clock actors after disable/enable, and persisted selection');
        }
        GLib.file_set_contents(`${control}/command.json`, JSON.stringify({serial: ++serial, close: true}));
        const [, output, errors] = await new Promise((resolve, reject) => driver.communicate_utf8_async(null, null, (process, result) => {
            try { resolve(process.communicate_utf8_finish(result)); } catch (error) { reject(error); }
        }));
        driverClosed = true;
        assert(driver.get_successful() && !errors.includes('JS ERROR'), `GTK driver failed: ${output} ${errors}`);
    } finally {
        if (!driverClosed) driver.force_exit();
    }
}
