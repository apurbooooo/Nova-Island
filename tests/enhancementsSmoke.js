import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {sleep, waitTestWindows} from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'nova-island@fromapurbo';
let keepAlive = 0;
export function finish() {
    if (keepAlive) GLib.Source.remove(keepAlive);
    keepAlive = 0;
}
const assert = (ok, message) => { if (!ok) throw new Error(message); };
function find(actor, name) {
    if (actor?.name === name) return actor;
    for (const child of actor?.get_children() ?? []) {
        const result = find(child, name);
        if (result) return result;
    }
    return null;
}
async function until(condition, description) {
    for (let i = 0; i < 300; i++) {
        if (condition()) return;
        await sleep(20);
    }
    throw new Error(`Timed out: ${description}`);
}
export async function run() {
    // The compositor test helper exits after 30 s without D-Bus calls.
    // Keep it alive during screenshot capture so harness teardown succeeds.
    await waitTestWindows();
    keepAlive = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
        void waitTestWindows();
        return GLib.SOURCE_CONTINUE;
    });
    await until(() => Main.extensionManager.lookup(UUID)?.stateObj, 'extension');
    const extension = Main.extensionManager.lookup(UUID).stateObj;
    const settings = extension.getSettings();
    const preview = () => find(Main.layoutManager.uiGroup, 'nova-island-preview');
    const actor = name => find(preview(), name);
    const island = () => find(Main.panel, 'nova-island');
    const seat = global.stage.get_context().get_backend().get_default_seat();
    const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const press = async key => {
        keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
        await sleep(80);
    };
    const move = async target => {
        const [x, y] = target.get_transformed_position();
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + target.width / 2, y + target.height / 2);
        await sleep(50);
    };
    const screenshot = async name => {
        const directory = GLib.getenv('NOVA_TEST_SCREENSHOTS');
        if (!directory) return;
        await sleep(400);
        const p = preview();
        const file = Gio.File.new_for_path(`${directory}/${name}.png`);
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        try {
            await new Shell.Screenshot().screenshot_area(Math.round(p.x), Math.round(p.y),
                Math.ceil(p.width), Math.ceil(p.height), stream);
        } finally { stream.close(null); }
    };
    const select = async id => {
        actor(`nova-module-${id}`).emit('clicked', 0);
        await until(() => actor(`nova-${id}`)?.mapped || (id === 'clock' && actor('nova-clock-large-time')?.mapped), id);
        await sleep(300);
    };
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), 20, 690);
    Main.overview.hide();
    settings.set_boolean('hover-expand', false);
    settings.set_boolean('reduce-motion', false);
    settings.set_int('mouse-leave-delay', 1500);
    for (const id of ['emoji', 'system-monitor', 'clipboard', 'screenshot', 'quick-settings'])
        settings.set_boolean(`${id}-enabled`, true);
    settings.set_string('default-expanded-module', 'emoji');
    await until(() => island()?.mapped, 'panel');
    island().emit('clicked', 0);
    await until(() => actor('nova-emoji-results')?.mapped, 'emoji');
    await sleep(450);
    assert(island().has_style_class_name('nova-island-pinned'), 'test preview must be pinned');
    let destroyed = 0;
    const cells = actor('nova-emoji-results').get_children();
    cells.forEach(cell => cell.connect('destroy', () => destroyed++));
    cells.find(cell => cell.visible).emit('clicked', 0);
    await sleep(100);
    // Baseline reproduction deliberately uses the unchanged released ZIP.
    if (GLib.getenv('NOVA_BASELINE')) {
        print(`BASELINE: copying destroyed ${destroyed}/${cells.length} Emoji actors`);
        assert(destroyed > 0, 'expected to reproduce released Emoji rebuilding');
        return;
    }
    assert(destroyed === 0, 'copy destroyed Emoji actors');
    await select('clipboard');
    await select('emoji');
    assert(destroyed === 0, 'remap destroyed Emoji actors');
    const search = actor('nova-emoji-search');
    search.set_text('penguin');
    await sleep(100);
    const visible = () => actor('nova-emoji-results').get_children().filter(cell => cell.visible);
    assert(visible().length === 1, 'emoji search');
    const penguin = visible()[0];
    search.grab_key_focus();
    await sleep(100);
    await press(Clutter.KEY_Down);
    assert(global.stage.get_key_focus() === penguin, 'Down did not enter Emoji grid');
    penguin.emit('clicked', 0);
    assert(global.stage.get_key_focus() === penguin, 'copy lost keyboard focus');
    search.set_text('nothingmatchesnova');
    await sleep(100);
    assert(visible().length === 0, 'empty search');
    search.set_text('penguin');
    await sleep(100);
    assert(visible()[0] === penguin, 'search recreated retained cell');
    const categories = actor('nova-emoji').get_children()[2].get_children();
    for (const category of categories) {
        category.emit('clicked', 0);
        await sleep(80);
    }
    assert(destroyed === 0, 'category switch destroyed cells');
    await screenshot('emoji-categories');
    categories[1].emit('clicked', 0);
    await sleep(250);
    const positions = actor('nova-emoji-results').get_children().map(cell => `${cell.x},${cell.y}`);
    assert(positions.length === 59 && new Set(positions).size === 59, 'Emoji cells overlap after category switching');
    const gridWidth = actor('nova-emoji-results').get_parent().get_parent().width;
    assert(actor('nova-emoji-results').get_children().every(cell => cell.x + cell.width <= gridWidth + 1),
        'Emoji cells extend beyond horizontal viewport');
    await screenshot('emoji-open');
    print('PASS Emoji retained actors across copy, remap, search, empty state and all categories; focus retained');

    await select('clock');
    if (!GLib.getenv('NOVA_SKIP_FONT_CAPTURES')) {
    const families = ['Inter', 'Roboto', 'Poppins', 'Montserrat', 'Nunito Sans', 'DM Sans',
        'Manrope', 'Outfit', 'Space Grotesk', 'Plus Jakarta Sans'];
    const compactStyle = island().get_child().get_children().find(c => c.visible)?.style;
    for (const family of families) {
        settings.set_string('clock-font', family);
        await sleep(80);
        const text = actor('nova-clock-large-time').clutter_text;
        const font = text.get_layout().get_iter().get_run_readonly().item.analysis.font.describe().get_family();
        assert(font === family, `${family} resolved to ${font}`);
        const compactFont = find(island(), 'nova-clock-compact-time').clutter_text.get_layout()
            .get_iter().get_run_readonly().item.analysis.font.describe().get_family();
        assert(compactFont === family, `compact ${family} resolved to ${compactFont}`);
        await screenshot(`clock-${family.toLowerCase().replaceAll(' ', '-')}`);
    }
    settings.set_string('clock-font', '');
    assert(!actor('nova-clock-large-time').style.includes('font-family'), 'system default changed');
    assert(island().get_child().get_children().find(c => c.visible)?.style === compactStyle, 'compact container spacing changed');
    print('PASS all ten clock families resolved in real compact/expanded St/Pango; system default and compact spacing preserved');
    }

    const ids = ['clock', 'clipboard', 'emoji', 'screenshot', 'system-monitor', 'quick-settings'];
    for (const id of ['media', 'notifications', 'productivity']) settings.set_boolean(`${id}-enabled`, false);
    const selected = () => ids.find(id => actor(`nova-module-${id}`).has_style_class_name('nova-media-selected'));
    const wheel = async (direction, navigation = true) => {
        if (navigation) await move(island());
        // Actual virtual pointer input passes through Clutter picking/controllers.
        pointer.notify_discrete_scroll(GLib.get_monotonic_time(), direction, Clutter.ScrollSource.WHEEL);
        await sleep(550);
    };
    await select('clock');
    await move(island());
    print(`Before wheel: ${selected()}, mapped ${preview().mapped}, pinned ${island().has_style_class_name('nova-island-pinned')}`);
    for (let i = 1; i <= ids.length; i++) {
        await wheel(Clutter.ScrollDirection.DOWN);
        assert(selected() === ids[i % ids.length], `wheel next/wrap ${i}: got ${selected()}, expected ${ids[i % ids.length]}`);
    }
    for (let i = 1; i <= ids.length; i++) {
        await wheel(Clutter.ScrollDirection.UP);
        assert(selected() === ids[(ids.length - i) % ids.length], 'wheel previous/wrap');
    }
    await move(island());
    // Mutter's native virtual input takes motion units: 10 = one Clutter step.
    for (let i = 0; i < 3; i++) {
        pointer.notify_scroll_continuous(GLib.get_monotonic_time(), 0, 2,
            Clutter.ScrollSource.FINGER, Clutter.ScrollFinishFlags.NONE);
        await sleep(30);
    }
    assert(selected() === 'clock', 'touchpad noise switched module');
    pointer.notify_scroll_continuous(GLib.get_monotonic_time(), 0, 5,
        Clutter.ScrollSource.FINGER, Clutter.ScrollFinishFlags.NONE);
    await sleep(550);
    assert(selected() === 'clipboard', 'accumulated touchpad motion did not switch exactly once');
    await select('clock');
    settings.set_boolean('clipboard-enabled', false);
    await sleep(300);
    await wheel(Clutter.ScrollDirection.DOWN);
    assert(selected() === 'emoji', `disabled module not skipped: ${selected()}`);
    await select('system-monitor');
    await sleep(2400);
    await until(() => actor('nova-system-monitor-values').text.includes('CPU'), 'real CPU sample');
    await sleep(300);
    const p = preview();
    assert(p.width >= 820 && p.height < 540, `monitor bounds ${p.width}x${p.height}`);
    const grid = actor('nova-monitor-grid');
    const visibleCards = grid.get_children().filter(c => c.visible);
    await screenshot('system-monitor-landscape');
    print(`Monitor cards: ${JSON.stringify(visibleCards.map(c => [c.x, c.y, c.width, c.height]))}`);
    for (let a = grid; a; a = a.get_parent()) {
        print(`CHAIN ${a.name} ${a.width}x${a.height} xalign=${a.x_align} xexpand=${a.x_expand}`);
        if (a === p) break;
    }
    assert(visibleCards[0].x !== visibleCards[1].x && visibleCards[0].y === visibleCards[1].y, 'cards not side by side');
    for (const card of visibleCards) assert(card.width >= 245, `card too narrow: ${card.width}`);
    await screenshot('system-monitor-landscape');
    await move(actor('nova-system-monitor'));
    await wheel(Clutter.ScrollDirection.DOWN, false);
    assert(selected() === 'system-monitor', 'content wheel changed module');
    await move(actor('nova-settings'));
    await wheel(Clutter.ScrollDirection.UP, false);
    assert(selected() === 'system-monitor', 'settings wheel changed module');
    await move(actor('nova-module-system-monitor'));
    await screenshot('module-navigation');
    print(`PASS real virtual wheel input: forward/back wraps, disabled skip, content/settings isolation; monitor ${p.width}x${p.height}`);
    settings.set_string('clock-font', 'Outfit');
    Main.extensionManager.disableExtension(UUID);
    await sleep(200);
    Main.extensionManager.enableExtension(UUID);
    await until(() => island()?.mapped, 'reenable');
    assert(Main.extensionManager.lookup(UUID).stateObj.getSettings().get_string('clock-font') === 'Outfit', 'font persistence');
    print('PASS font persistence after disable/enable');
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
    launcher.setenv('GSETTINGS_BACKEND', 'memory', true);
    const script = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('clockFontsPrefs.js').get_path();
    const child = launcher.spawnv(['gjs', '-m', script]);
    await until(() => global.get_window_actors().some(a => a.visible && a.meta_window.get_wm_class() === 'org.gnome.Shell.Extensions'), 'font preferences mapped');
    await sleep(400);
    const directory = GLib.getenv('NOVA_TEST_SCREENSHOTS');
    if (directory) {
        const stream = Gio.File.new_for_path(`${directory}/clock-font-preferences.png`)
            .replace(null, false, Gio.FileCreateFlags.NONE, null);
        try { await new Shell.Screenshot().screenshot_area(0, 0, 1280, 720, stream); }
        finally { stream.close(null); }
    }
    const [, output, errors] = await new Promise((resolve, reject) =>
        child.communicate_utf8_async(null, null, (proc, result) => {
            try { resolve(proc.communicate_utf8_finish(result)); } catch (error) { reject(error); }
        }));
    assert(child.get_successful() && output.includes('PASS GTK') && !errors.includes('JS ERROR'),
        `GTK font controls: ${output} ${errors}`);
    print(output.trim());
}
