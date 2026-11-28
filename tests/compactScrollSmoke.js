import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {sleep, waitTestWindows} from 'resource:///org/gnome/shell/ui/scripting.js';
import {mockPlayer} from './mockMpris.js';

const UUID = 'nova-island@fromapurbo';
const IDS = ['clock', 'media', 'notifications', 'productivity', 'clipboard', 'emoji',
    'screenshot', 'system-monitor', 'quick-settings'];
const assert = (ok, message) => { if (!ok) throw new Error(message); };
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
async function until(condition, description) {
    for (let i = 0; i < 300; i++) {
        if (condition()) return;
        await sleep(20);
    }
    throw new Error(`Timed out: ${description}`);
}
export async function run() {
    await waitTestWindows();
    keepAlive = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
        void waitTestWindows(); return GLib.SOURCE_CONTINUE;
    });
    await until(() => Main.extensionManager.lookup(UUID)?.stateObj, 'extension');
    const settings = Main.extensionManager.lookup(UUID).stateObj.getSettings();
    const pill = () => find(Main.panel, 'nova-island');
    const preview = () => find(Main.layoutManager.uiGroup, 'nova-island-preview');
    const actor = name => find(preview(), name);
    const compact = () => IDS[pill().get_child().get_children().findIndex(child => child.visible) - 1];
    const expanded = () => IDS.find(id => actor(`nova-module-${id}`)?.has_style_class_name('nova-media-selected'));
    const seat = global.stage.get_context().get_backend().get_default_seat();
    const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const moveTo = async (x, y) => {
        assert(Number.isFinite(x) && Number.isFinite(y), 'finite pointer coordinates');
        // Synchronize injected motion with the actual compositor pointer state.
        for (let i = 0; i < 300; i++) {
            pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
            await sleep(20);
            if (Math.abs(global.get_pointer()[0] - x) <= 1 && Math.abs(global.get_pointer()[1] - y) <= 1) {
                await sleep(60);
                return;
            }
        }
        throw new Error(`Virtual pointer did not reach ${x},${y}: ${global.get_pointer()}`);
    };
    const move = async target => {
        await until(() => target.has_allocation() && target.width > 0 && target.height > 0 &&
            target.get_transformed_position().every(Number.isFinite), 'target allocation');
        const [x, y] = target.get_transformed_position();
        await moveTo(x + target.width / 2, y + target.height / 2);
    };
    const wheel = async (direction, delay = 180) => {
        pointer.notify_discrete_scroll(GLib.get_monotonic_time(), direction, Clutter.ScrollSource.WHEEL);
        await sleep(delay);
    };
    const click = async () => {
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await sleep(200);
    };
    const down = Clutter.ScrollDirection.DOWN;
    const up = Clutter.ScrollDirection.UP;
    const screenshot = async name => {
        const directory = GLib.getenv('NOVA_TEST_SCREENSHOTS');
        if (!directory) return;
        const stream = Gio.File.new_for_path(`${directory}/${name}.png`)
            .replace(null, false, Gio.FileCreateFlags.NONE, null);
        try { await new Shell.Screenshot().screenshot_area(200, 0, 880, 660, stream); }
        finally { stream.close(null); }
    };
    const select = async id => {
        actor(`nova-module-${id}`).emit('clicked', 0);
        await sleep(400);
        assert(expanded() === id, `click selection ${id}`);
    };

    await moveTo(20, 690);
    Main.overview.hide();
    settings.set_boolean('hover-expand', false);
    settings.set_boolean('reduce-motion', true);
    settings.set_boolean('track-previews', false);
    settings.set_int('mouse-leave-delay', 1000);
    settings.set_boolean('notifications-auto-expand', false);
    settings.set_string('default-expanded-module', 'auto');
    IDS.forEach((id, index) => {
        settings.set_boolean(`${id}-enabled`, true);
        settings.set_int(`${id}-priority`, 100 - index * 10);
    });
    const player = await mockPlayer('NovaPillScroll', 'Pill scroll fixture');
    try {
        await until(() => pill()?.mapped && actor('nova-module-media')?.visible, 'nine available modules');
        const stable = pill();
        await until(() => stable.has_allocation() && stable.get_transformed_position().every(Number.isFinite), 'pill allocation');
        const [x, y] = stable.get_transformed_position();
        const width = stable.width;
        const height = stable.height;
        assert(compact() === 'clock' && !preview().mapped, 'automatic priority before manual scroll');
        await move(stable);
        for (let i = 1; i <= IDS.length; i++) {
            await wheel(down);
            assert(compact() === IDS[i % IDS.length], `compact next ${i}: ${compact()}`);
            assert(pill() === stable && !preview().mapped, 'scroll recreated pill or expanded it');
            assert(stable.width === width && stable.height === height &&
                stable.get_transformed_position()[0] === x && stable.get_transformed_position()[1] === y,
            'compact geometry changed');
        }
        for (let i = 1; i <= IDS.length; i++) {
            await wheel(up);
            assert(compact() === IDS[(IDS.length - i) % IDS.length], `compact previous ${i}: ${compact()}`);
        }
        await screenshot('compact-clock');
        print('PASS fixed compact pill: all nine modules, both directions/wrap, unchanged actor/geometry, stays collapsed');

        settings.set_boolean('media-enabled', false);
        await wheel(down);
        assert(compact() === 'notifications', 'disabled module not skipped');
        settings.set_boolean('notifications-enabled', false);
        await until(() => compact() === 'clock', 'invalid manual selection falls back to priority');
        settings.set_int('emoji-priority', 95);
        await wheel(down);
        assert(compact() === 'emoji', 'priority ordering ignored');
        settings.set_int('emoji-priority', 50);
        settings.set_boolean('media-enabled', true);
        settings.set_boolean('notifications-enabled', true);
        // Compact visibility flags are deliberately left at their 0.5.1 defaults:
        // explicit scrolling can select tools excluded from automatic compact mode.
        await wheel(up);
        await until(() => compact() === 'clipboard', 'priority order before Emoji');
        settings.set_boolean('clipboard-enabled', false);
        await until(() => compact() === 'clock', 'fallback after disabling current module');
        settings.set_boolean('clipboard-enabled', true);

        for (let i = 0; i < 4; i++)
            pointer.notify_discrete_scroll(GLib.get_monotonic_time(), down, Clutter.ScrollSource.WHEEL);
        await sleep(100);
        assert(compact() === 'media', 'burst skipped multiple modules');
        await sleep(100);
        await wheel(up);
        for (let i = 0; i < 3; i++) {
            pointer.notify_scroll_continuous(GLib.get_monotonic_time(), 0, 2,
                Clutter.ScrollSource.FINGER, Clutter.ScrollFinishFlags.NONE);
            await sleep(30);
        }
        assert(compact() === 'clock', 'smooth noise switched a module');
        pointer.notify_scroll_continuous(GLib.get_monotonic_time(), 0, 5,
            Clutter.ScrollSource.FINGER, Clutter.ScrollFinishFlags.NONE);
        await sleep(200);
        assert(compact() === 'media', 'smooth accumulation did not select exactly one module');
        await screenshot('compact-media');
        print('PASS disabled/current-module fallback, explicit tools, priority order, wheel burst suppression and real smooth input');

        // Root bubbling observes propagation: owned wheel events stop, while
        // ignored horizontal and single-candidate events reach the stage.
        let propagated = 0;
        const signal = global.stage.connect('scroll-event', () => { propagated++; return Clutter.EVENT_PROPAGATE; });
        try {
            await moveTo(40, 500);
            await wheel(down);
            assert(compact() === 'media' && propagated > 0, 'outside desktop input intercepted');
            await move(stable);
            propagated = 0;
            await wheel(down);
            assert(compact() === 'notifications' && propagated === 0, 'handled scroll leaked');
            await wheel(Clutter.ScrollDirection.RIGHT);
            assert(compact() === 'notifications' && propagated > 0, 'horizontal input intercepted');
        } finally { global.stage.disconnect(signal); }

        await click();
        assert(preview().mapped && stable.has_style_class_name('nova-island-pinned') &&
            expanded() === 'notifications', 'click did not expand/pin selected module');
        await select('system-monitor');
        await move(actor('nova-module-system-monitor'));
        await wheel(down, 250);
        assert(expanded() === 'system-monitor', 'dock still owns module wheel switching');
        await moveTo(preview().x + 130, preview().y + 28);
        await wheel(down, 400);
        assert(expanded() === 'quick-settings', 'non-interactive header did not switch');
        await select('system-monitor');
        await moveTo(preview().x + 3, preview().y + 170);
        await wheel(down, 400);
        assert(expanded() === 'quick-settings', 'outer background did not switch');
        for (const [id, targetName] of [['system-monitor', 'nova-monitor-grid'], ['emoji', 'nova-emoji-results'],
            ['clipboard', 'nova-clipboard-search'], ['productivity', 'nova-productivity-calendar'],
            ['media', 'nova-media-progress'], ['quick-settings', 'nova-quick-settings-network']]) {
            await select(id);
            if (id === 'clipboard') {
                settings.set_boolean('clipboard-capture', true);
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'NOVA compact scroll fixture');
                await until(() => actor('nova-clipboard-search').visible, 'clipboard search with captured fixture');
            }
            await move(actor(targetName));
            await wheel(down, 250);
            assert(expanded() === id, `module content/control intercepted: ${id}`);
        }
        await select('emoji');
        const results = actor('nova-emoji-results');
        const scrollView = results.get_parent().get_parent();
        assert(scrollView instanceof St.ScrollView, 'Emoji scroll viewport');
        const before = scrollView.vadjustment.value;
        await moveTo(preview().x + 220, preview().y + 260);
        await wheel(down, 300);
        assert(expanded() === 'emoji' && scrollView.vadjustment.value > before, 'Emoji content did not scroll normally');
        await move(actor('nova-emoji-search'));
        await wheel(up);
        assert(expanded() === 'emoji', 'search field scroll switched module');
        await screenshot('expanded-emoji-content');
        await move(stable);
        const nextTop = IDS[(IDS.indexOf(compact()) + 1) % IDS.length];
        await wheel(down, 400);
        assert(compact() === nextTop && expanded() === nextTop, 'top pill did not switch while expanded');
        await click();
        assert(!preview().mapped && compact() === 'clock', 'unpin/collapse did not restore the automatic clock');
        settings.set_boolean('hover-expand', true);
        await moveTo(20, 690);
        await move(stable);
        await until(() => preview().mapped, 'hover still expands');
        const nextHover = IDS[(IDS.indexOf(compact()) + 1) % IDS.length];
        await wheel(down, 400);
        assert(compact() === nextHover && expanded() === nextHover, 'pill wheel with default hover');
        print('PASS expanded header/background, isolated content/controls, real Emoji scrolling, desktop propagation, clicks/pin/collapse/hover');
        stable.grab_key_focus();
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Escape, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Escape, Clutter.KeyState.RELEASED);
        await until(() => !preview().mapped, 'Escape still collapses');
        await moveTo(20, 690);
        settings.set_boolean('hover-expand', false);
        await sleep(settings.get_int('mouse-leave-delay') + 100);
        for (const id of IDS.filter(id => id !== 'clock')) settings.set_boolean(`${id}-enabled`, false);
        settings.set_boolean('media-enabled', true);
        await until(() => actor('nova-module-media').visible, 'available media');
        await move(stable);
        await wheel(down);
        assert(compact() === 'media', 'manual media selection before departure');
        await player.close();
        await until(() => compact() === 'clock', 'unavailable selected media falls back');
        let singlePropagated = false;
        const singleSignal = global.stage.connect('scroll-event', () => {
            singlePropagated = true; return Clutter.EVENT_PROPAGATE;
        });
        try { await wheel(down); } finally { global.stage.disconnect(singleSignal); }
        assert(compact() === 'clock' && singlePropagated, 'single eligible module consumed scroll');
        Main.extensionManager.disableExtension(UUID);
        await sleep(100);
        Main.extensionManager.enableExtension(UUID);
        await until(() => pill()?.mapped, 're-enable');
        assert(compact() === 'clock', 'manual selection leaked across disable');
        print('PASS unavailable media fallback, single-module propagation and disable/re-enable cleanup');
    } finally { await player.close(); }
}
