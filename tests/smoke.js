import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {sleep} from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'nova-island@fromapurbo';
const PINNED_CLASS = 'nova-island-pinned';
const LEAVE_DELAY = 800;

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

async function waitFor(condition, description, timeout = 4000) {
    const deadline = GLib.get_monotonic_time() + timeout * 1000;
    while (!condition()) {
        if (GLib.get_monotonic_time() > deadline)
            throw new Error(`Timed out waiting for ${description}`);

        await sleep(15);
    }
}

function islands() {
    const find = actor => actor.get_children().flatMap(child =>
        child.name === 'nova-island' ? [child] : find(child));
    return find(Main.panel);
}

function previews() {
    return Main.layoutManager.uiGroup.get_children().filter(actor => actor.name === 'nova-island-preview');
}

function centered(island) {
    const [x] = island.get_transformed_position();
    const [panelX] = Main.panel.get_transformed_position();
    return island.has_allocation() &&
        Math.abs(x + island.width / 2 - (panelX + Main.panel.width / 2)) <= 1;
}

function assertCenteredInPanel(island) {
    const [x, y] = island.get_transformed_position();
    const [, panelY] = Main.panel.get_transformed_position();
    assert(centered(island), 'NOVA must be centered horizontally in the panel');
    assert(y >= panelY && y + island.height <= panelY + Main.panel.height,
        'The compact pill must be entirely inside the panel');
    const rtl = Main.panel.get_text_direction() === Clutter.TextDirection.RTL;
    const left = Main.panel[rtl ? '_rightBox' : '_leftBox'];
    const right = Main.panel[rtl ? '_leftBox' : '_rightBox'];
    assert(x >= left.get_transformed_position()[0] + left.width &&
        x + island.width <= right.get_transformed_position()[0],
    'The compact pill must clear both side boxes');
}

async function checkDateMenuMoves(dateMenu, nativeLabel) {
    const container = dateMenu.container;
    const originalBox = container.get_parent();
    const originalIndex = originalBox.get_children().indexOf(container);
    const {_leftBox: left, _centerBox: center, _rightBox: right} = Main.panel;
    const move = (box, index) => {
        container.get_parent().remove_child(container);
        box.insert_child_at_index(container, index);
    };

    try {
        for (const box of [center, right, left].filter(box => box !== originalBox)) {
            move(box, 0);
            await waitFor(() => {
                const [island] = islands();
                if (!island?.mapped || !centered(island) ||
                    nativeLabel.visible || !dateMenu.mapped || !container.has_allocation())
                    return false;
                if (box === center)
                    return container.contains(island);
                if (container.child !== dateMenu)
                    return false;

                const [islandX] = island.get_transformed_position();
                const [dateX] = container.get_transformed_position();
                const rtl = Main.panel.get_text_direction() === Clutter.TextDirection.RTL;
                const leftOfIsland = box === (rtl ? right : left);
                return leftOfIsland ? dateX + container.width <= islandX : dateX >= islandX + island.width;
            }, `NOVA follows the live date menu in ${box.name}`);
            assertCenteredInPanel(islands()[0]);
        }
    } finally {
        move(originalBox, originalIndex);
    }
    await waitFor(() => islands()[0]?.mapped && centered(islands()[0]) && !nativeLabel.visible,
        'NOVA after returning the date menu to its original group');
    assert(container.get_parent() === originalBox, 'NOVA changed the native container’s parent');
    print('PASS live date menu placement in center and both side groups');
}

async function checkRtl(dateMenu) {
    const panel = Main.panel;
    const direction = panel.get_text_direction();
    const container = dateMenu.container;
    const originalBox = container.get_parent();
    const originalIndex = originalBox.get_children().indexOf(container);
    if (originalBox !== panel._centerBox) {
        originalBox.remove_child(container);
        panel._centerBox.add_child(container);
    }

    try {
        panel.set_text_direction(Clutter.TextDirection.RTL);
        await waitFor(() => {
            const [island] = islands();
            if (!island?.mapped || !centered(island) || !dateMenu.has_allocation())
                return false;

            const [islandX] = island.get_transformed_position();
            const [calendarX] = dateMenu.get_transformed_position();
            return calendarX + dateMenu.width <= islandX;
        }, 'native calendar on the left of the centered pill in RTL');
        assertCenteredInPanel(islands()[0]);
    } finally {
        panel.set_text_direction(direction);
        if (originalBox !== panel._centerBox) {
            panel._centerBox.remove_child(container);
            originalBox.insert_child_at_index(container, originalIndex);
        }
    }
    await waitFor(() => islands()[0]?.mapped && centered(islands()[0]) &&
        dateMenu.mapped && (originalBox === panel._centerBox || container.child === dateMenu),
    'restored panel direction and date placement');
    print('PASS RTL centering and calendar placement');
}

async function checkPanelConflict(dateMenu, nativeLabel, settings) {
    const nativeParent = dateMenu.container.get_parent();
    const indicator = new PanelMenu.Button(0.5, 'Test center indicator', true);
    indicator.add_child(new St.Label({text: 'Test'}));
    Main.panel.addToStatusArea('nova-smoke-center', indicator, 0, 'center');
    try {
        await waitFor(() => islands().length === 0 && nativeLabel.visible, 'stock clock with extra center item');
        assert(indicator.container.get_parent() === Main.panel._centerBox && indicator.container.mapped,
            'NOVA disturbed the other center indicator');
        const floatingPill = () => Main.layoutManager.uiGroup.get_children()
            .find(actor => actor.name === 'nova-island');
        assert(!floatingPill(), 'Floating fallback must be off by default');
        settings.set_boolean('floating-fallback', true);
        await waitFor(() => floatingPill()?.mapped && floatingPill().has_allocation(), 'opt-in floating fallback');
        const [, y] = floatingPill().get_transformed_position();
        const [, panelY] = Main.panel.get_transformed_position();
        assert(y >= panelY + Main.panel.height && nativeLabel.visible && islands().length === 0,
            'Fallback must stay below the panel and keep the native clock');
        settings.set_boolean('floating-fallback', false);
        await waitFor(() => !floatingPill(), 'fallback removed after turning off its setting');
    } finally {
        indicator.destroy();
    }
    await waitFor(() => islands()[0]?.mapped && centered(islands()[0]) && !nativeLabel.visible,
        'NOVA after removing the center item');
    assert(dateMenu.container.get_parent() === nativeParent, 'Date menu left its original slot');
    assertCenteredInPanel(islands()[0]);
    print('PASS center conflict, stock clock, opt-in floating fallback, and recovery');

    const wideIndicator = new PanelMenu.Button(0.5, 'Test wide indicator', true);
    wideIndicator.add_child(new St.Widget({width: Math.ceil(Main.panel.width * 0.55), height: 12}));
    Main.panel.addToStatusArea('nova-smoke-wide', wideIndicator, 0, 'left');
    try {
        await waitFor(() => islands().length === 0 && nativeLabel.visible, 'stock clock on a crowded panel');
        assert(wideIndicator.container.mapped, 'The wide panel indicator was hidden');
    } finally {
        wideIndicator.destroy();
    }
    await waitFor(() => islands()[0]?.mapped && centered(islands()[0]), 'NOVA after clearing panel space');
    print('PASS stock clock and recovery when side indicators crowd the panel');
}

function moveAway(pointer) {
    const monitor = Main.layoutManager.primaryMonitor;
    pointer.notify_absolute_motion(GLib.get_monotonic_time(),
        monitor.x + monitor.width / 2, monitor.y + monitor.height * 0.75);
}

function moveInside(pointer, actor) {
    const [x, y] = actor.get_transformed_position();
    pointer.notify_absolute_motion(GLib.get_monotonic_time(),
        x + actor.width / 2, y + actor.height / 2);
}

function click(pointer) {
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
}

function press(keyboard, key) {
    keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
}

function focusFromSwitcher(island) {
    const switcher = Main.ctrlAltTabManager;
    const group = switcher._items.find(item => item.root === island);
    assert(group?.proxy.mapped, 'NOVA is missing from the GNOME focus switcher');
    switcher.focusGroup(group, global.get_current_time());
    assert(global.stage.get_key_focus() === island, 'The focus switcher must focus the NOVA pill');
}

async function checkPreferences(pointer) {
    // Launch the official service with the test compositor's Wayland and XDG paths.
    const launch = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launch.setenv('GDK_BACKEND', 'wayland', true);
    launch.setenv('GTK_A11Y', 'none', true);
    const prefs = launch.spawnv(['gjs', '-m', '/usr/share/gnome-shell/org.gnome.Shell.Extensions']);
    let ready = false;
    const watch = Gio.bus_watch_name_on_connection(Gio.DBus.session, 'org.gnome.Shell.Extensions',
        Gio.BusNameWatcherFlags.NONE, () => (ready = true), null);
    try {
        await waitFor(() => ready, 'GNOME preferences service to register');
        const desktop = Main.extensionManager.lookup(UUID).dir.get_child('applications/nova-island-settings.desktop');
        assert(Gio.DesktopAppInfo.new_from_filename(desktop.get_path()).launch([], null), 'Desktop launcher failed');
        const prefsWindow = () => global.get_window_actors().find(actor =>
            actor.is_mapped() && actor.meta_window.get_title() === 'NOVA Island');
        await waitFor(prefsWindow, 'a mapped NOVA Island preferences window', 6000);
        prefsWindow().meta_window.delete(global.get_current_time());
        await waitFor(() => !prefsWindow(), 'preferences closed');
        print('PASS desktop entry opened NOVA preferences');
        const launcher = Gio.Subprocess.new(['gnome-extensions', 'prefs', UUID], Gio.SubprocessFlags.NONE);
        await new Promise((resolve, reject) => {
            launcher.wait_check_async(null, (process, result) => {
                try {
                    resolve(process.wait_check_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
        });
        await waitFor(prefsWindow, 'CLI preferences window', 6000);
        prefsWindow().meta_window.delete(global.get_current_time());
        await waitFor(() => !prefsWindow(), 'CLI preferences closed');
        const [button] = islands();
        button.emit('clicked', Clutter.BUTTON_PRIMARY);
        const gear = previews()[0].first_child.last_child.last_child;
        await waitFor(() => gear.mapped && gear.has_allocation(), 'expanded settings button');
        await sleep(400);
        moveInside(pointer, gear);
        click(pointer);
        await waitFor(prefsWindow, 'settings button opens NOVA preferences', 6000);
        print('PASS expanded settings button opened NOVA preferences');
        const window = prefsWindow().meta_window;
        assert(window.get_client_type() === Meta.WindowClientType.WAYLAND,
            'Preferences must open as a Wayland client');
        print('PASS Wayland preferences launched through gnome-extensions');
        const output = GLib.getenv('NOVA_TEST_SCREENSHOTS');
        if (output) {
            await sleep(200);
            const file = Gio.File.new_for_path(GLib.build_filenamev([output, 'studio.png']));
            const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            try {
                const {x, y, width, height} = window.get_frame_rect();
                await new Shell.Screenshot().screenshot_area(x, y, width, height, stream);
            } finally {
                stream.close(null);
            }
        }

        const [island] = islands();
        window.make_fullscreen();
        await waitFor(() => !island.mapped, 'island hidden in fullscreen');
        window.unmake_fullscreen();
        await waitFor(() => island.mapped, 'island visible after fullscreen');
        print('PASS island visibility during fullscreen');
    } finally {
        Gio.bus_unwatch_name(watch);
        prefs.send_signal(15);
    }
}

export async function run() {
    const manager = Main.extensionManager;
    await waitFor(() => manager.lookup(UUID)?.state === ExtensionState.ACTIVE, 'extension activation');
    const desktopSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    desktopSettings.set_boolean('enable-hot-corners', false);

    const seat = global.stage.get_context().get_backend().get_default_seat();
    const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    moveAway(pointer);
    Main.overview.hide();
    await waitFor(() => global.get_pointer()[1] > 100 && !Main.overview.visible,
        'virtual pointer and desktop to settle');

    await waitFor(() => islands()[0]?.mapped, 'compact panel clock');
    assert(islands().length === 1 && previews().length === 1, 'Expected one island and one preview actor');
    const [island] = islands();
    const [preview] = previews();
    const dateMenu = Main.panel.statusArea.dateMenu;
    const nativeLabel = dateMenu.get_first_child().get_children().find(actor => actor instanceof St.Label);
    assert(nativeLabel && !nativeLabel.visible, 'Expected exactly one visible panel clock');
    const nativeBox = Main.sessionMode.panel.center.includes('dateMenu') ? Main.panel._centerBox :
        Main.sessionMode.panel.left.includes('dateMenu') ? Main.panel._leftBox : Main.panel._rightBox;
    assert(dateMenu.mapped && dateMenu.container.get_parent() === nativeBox,
        'The native date menu must stay available in its existing panel slot');
    const extension = manager.lookup(UUID);
    const settings = extension.stateObj.getSettings();
    const compactWidth = settings.get_int('compact-width');
    const expandedWidth = settings.get_int('expanded-width');
    await waitFor(() => island.width === compactWidth, 'compact width');
    assertCenteredInPanel(island);
    assert(/\d/.test(island.accessible_name), 'Compact island should expose a formatted time');
    print('PASS native panel ancestry, centering, panel bounds, and single visible clock');

    await checkDateMenuMoves(dateMenu, nativeLabel);
    await checkRtl(dateMenu);
    await checkPanelConflict(dateMenu, nativeLabel, settings);

    settings.set_int('mouse-leave-delay', LEAVE_DELAY);
    moveInside(pointer, island);
    if (St.Settings.get().enableAnimations && St.Settings.get().reducedMotion !== St.ReducedMotion.REDUCE)
        await waitFor(() => preview.get_transition('width') !== null, 'compositor width animation');
    await waitFor(() => preview.mapped && preview.width === expandedWidth, 'expanded clock');
    assertCenteredInPanel(island);
    assert(island.accessible_name.split(',').length > 2, 'Expanded clock should expose the date');
    moveInside(pointer, preview);
    await sleep(LEAVE_DELAY + 100);
    assert(preview.mapped, 'Crossing into the preview must cancel the leave timer');
    moveAway(pointer);
    await sleep(160);
    assert(preview.mapped, 'Leaving early must respect the configured delay');
    moveInside(pointer, island);
    await sleep(LEAVE_DELAY + 100);
    assert(preview.mapped, 'Re-entering must cancel the pending collapse');
    moveAway(pointer);
    await waitFor(() => !preview.mapped, 'delayed collapse');
    print('PASS hover, preview animation, and cancellable leave delay');

    moveInside(pointer, island);
    await waitFor(() => preview.mapped && preview.width === expandedWidth, 'expanded clock before pinning');
    click(pointer);
    await waitFor(() => island.has_style_class_name(PINNED_CLASS), 'pointer activation to pin preview');
    moveAway(pointer);
    await sleep(LEAVE_DELAY + 100);
    assert(preview.mapped, 'Pinned preview must stay open away from the pointer');
    moveInside(pointer, island);
    click(pointer);
    await waitFor(() => !preview.mapped, 'click to collapse the pinned preview');

    moveAway(pointer);
    focusFromSwitcher(island);
    press(keyboard, Clutter.KEY_Return);
    await waitFor(() => island.has_style_class_name(PINNED_CLASS), 'keyboard activation to pin preview');
    press(keyboard, Clutter.KEY_Escape);
    await waitFor(() => !preview.mapped, 'Escape to close preview');
    press(keyboard, Clutter.KEY_space);
    await waitFor(() => island.has_style_class_name(PINNED_CLASS), 'Space to activate NOVA');
    moveInside(pointer, dateMenu);
    await sleep(80);
    click(pointer);
    await waitFor(() => dateMenu.menu.isOpen && !preview.mapped, 'native calendar to open');
    dateMenu.menu.close({animate: false});
    moveAway(pointer);
    print('PASS Shell focus group, pinning, Enter, Space, Escape, and the original calendar menu');

    settings.set_boolean('reduce-motion', true);
    settings.set_int('compact-width', 180);
    settings.set_int('compact-height', 22);
    await waitFor(() => island.height === 22, 'smaller compact height under the default theme');
    settings.set_int('compact-height', 42);
    settings.set_int('top-offset', 20);
    settings.set_int('horizontal-offset', 38);
    settings.set_int('glass-opacity', 79);
    await waitFor(() => island.width === 180, 'live width setting');
    assertCenteredInPanel(island);
    await waitFor(() => island.height === Main.panel.height - 4,
        'oversized compact height limited by the panel');
    assert(island.height < 42, 'The extension must not enlarge the panel to fit the pill');
    assert(island.get_style().includes('0.79'), 'Glass opacity did not update live');
    moveInside(pointer, island);
    await waitFor(() => preview.mapped && preview.width === expandedWidth, 'reduced-motion hover');
    assert(preview.get_transition('width') === null, 'Reduced motion must skip geometry animation');
    const [panelX, panelY] = Main.panel.get_transformed_position();
    assert(Math.abs(preview.x - Math.round(panelX + (Main.panel.width - expandedWidth) / 2 + 38)) <= 1,
        'Preview horizontal offset ignored');
    assert(preview.y === Math.round(panelY + Main.panel.height + 20), 'Preview panel gap ignored');

    const panelStyle = Main.panel.get_style();
    try {
        Main.panel.set_style('height: 56px;');
        await waitFor(() => island.height === 42, 'compact height after panel theme change');
        await waitFor(() => preview.y === Math.round(panelY + Main.panel.height + 20),
            'preview re-anchored after theme change');
        assertCenteredInPanel(island);
    } finally {
        Main.panel.set_style(panelStyle);
    }
    print('PASS live preferences and panel theme height changes');

    Main.overview.show();
    await waitFor(() => !island.mapped && !preview.mapped && nativeLabel.visible,
        'native clock restored in the overview');
    Main.overview.hide();
    moveAway(pointer);
    await waitFor(() => island.mapped && island.width === 180, 'compact island restored after overview');

    const accessibility = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.interface'});
    settings.set_boolean('reduce-motion', false);
    accessibility.set_string('reduced-motion', 'reduce');
    await waitFor(() => St.Settings.get().reducedMotion === St.ReducedMotion.REDUCE,
        'GNOME reduced-motion preference');
    moveInside(pointer, island);
    await waitFor(() => preview.mapped && preview.width === expandedWidth, 'system reduced-motion hover');
    assert(preview.get_transition('width') === null, 'GNOME reduced motion must skip geometry animation');
    moveAway(pointer);
    await waitFor(() => !preview.mapped, 'collapse after system reduced-motion hover');
    print('PASS NOVA and GNOME reduced motion and overview visibility');

    for (let cycle = 0; cycle < 3; cycle++) {
        const [before] = islands();
        const [beforePreview] = previews();
        moveInside(pointer, before);
        await waitFor(() => beforePreview.mapped && beforePreview.width === expandedWidth, 'hover before disabling');
        moveAway(pointer);
        await sleep(30);
        assert(manager.disableExtension(UUID), 'Disable request failed');
        await waitFor(() => extension.state === ExtensionState.INACTIVE, 'extension disable');
        assert(islands().length === 0 && previews().length === 0, 'Island or preview actor survived disable');
        assert(!Main.ctrlAltTabManager._items.some(item => item.root === before),
            'The focus switcher retained a disabled NOVA actor');
        assert(dateMenu.container.child === dateMenu && dateMenu.label_actor === nativeLabel && nativeLabel.visible,
            'Disable did not restore the stock date menu and clock');
        assert(manager.enableExtension(UUID), 'Enable request failed');
        await waitFor(() => extension.state === ExtensionState.ACTIVE, 'extension re-enable');
        await waitFor(() => islands()[0]?.mapped, 'pill reinstalled');
        assert(islands().length === 1 && previews().length === 1, 'Duplicate or missing island after re-enable');
        const [after] = islands();
        assert(after !== before, 'Re-enable should create a new actor');
        await waitFor(() => after.width === 180, 'persisted dimensions');
        assertCenteredInPanel(after);
        assert(after.get_style().includes('0.79'), 'Glass opacity did not persist after re-enable');
    }
    await sleep(LEAVE_DELAY + 100);
    settings.set_int('compact-width', 181);
    await waitFor(() => islands()[0].width === 181, 'settings update after lifecycle cycling');
    print('PASS three enable/disable cycles, pending timer teardown, and persisted settings');

    Main.sessionMode.pushMode('unlock-dialog');
    try {
        await waitFor(() => islands().length === 0 &&
            previews().every(actor => !actor.mapped) && nativeLabel.visible,
        'NOVA hidden and stock date label restored in lock-screen mode');
    } finally {
        Main.sessionMode.popMode('unlock-dialog');
    }
    await waitFor(() => islands()[0]?.mapped && centered(islands()[0]), 'NOVA in the desktop session again');
    print('PASS lock-screen session mode and restoration');
    await checkPreferences(pointer);
    await checkStudio(manager, settings);
}

async function checkStudio(manager, settings) {
    const [island] = islands();
    const [preview] = previews();
    const extension = manager.lookup(UUID);
    const {writeSettings} = await import(extension.dir.get_child('src/shared/presets.js').get_uri());
    const {THEMES} = await import(extension.dir.get_child('src/shared/studio.js').get_uri());
    writeSettings(settings, [['theme', 'aurora'], ...Object.entries(THEMES.aurora[1]),
        ['clock-font-size', 17], ['content-alignment', 'end']]);
    await waitFor(() => island.style.includes('20, 38, 50') && preview.style.includes('0.55'),
        'theme propagation to both Shell surfaces');
    const compact = island.get_child().get_children().find(child => child.has_style_class_name?.('nova-island-compact'));
    assert(compact.x_align === Clutter.ActorAlign.END && compact.get_last_child().style.includes('17px'),
        'Clock alignment or type size did not update live');
    settings.set_boolean('clock-enabled', false);
    await waitFor(() => islands().length === 0, 'disabled Clock module restores stock panel');
    settings.set_boolean('clock-enabled', true);
    await waitFor(() => islands()[0]?.mapped && centered(islands()[0]), 'Clock restored live');
    print('PASS live theme, typography, alignment, and module toggle');
}
