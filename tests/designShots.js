// Visual capture of every module in an isolated GNOME Shell.
// Run with NOVA_TEST_SCREENSHOTS=<existing dir> through gnome-shell-test-tool (see README).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {sleep} from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'nova-island@fromapurbo';
const assert = (condition, message) => {
    if (!condition)
        throw new Error(message);
};
function find(actor, name) {
    if (actor.name === name)
        return actor;
    for (const child of actor.get_children()) {
        const found = find(child, name);
        if (found)
            return found;
    }
    return null;
}
async function waitFor(condition, description) {
    for (let i = 0; i < 300; i++) {
        if (condition())
            return;
        await sleep(20);
    }
    throw new Error(`Timed out waiting for ${description}`);
}

export async function run() {
    const directory = GLib.getenv('NOVA_TEST_SCREENSHOTS');
    assert(directory, 'NOVA_TEST_SCREENSHOTS is required');
    await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.ACTIVE, 'extension');
    const settings = Main.extensionManager.lookup(UUID).stateObj.getSettings();
    const preview = () => find(Main.layoutManager.uiGroup, 'nova-island-preview');
    const island = () => find(Main.panel, 'nova-island');
    Main.overview.hide();
    await waitFor(() => island()?.mapped, 'panel');
    const theme = GLib.getenv('NOVA_TEST_THEME');
    if (theme)
        settings.set_string('theme', theme);
    settings.set_int("mouse-leave-delay", 2000);
    for (const id of ['notifications', 'productivity', 'clipboard', 'emoji', 'screenshot', 'system-monitor', 'quick-settings'])
        settings.set_boolean(`${id}-enabled`, true);
    settings.set_strv('productivity-timezones', ['UTC', 'Asia/Dhaka', 'America/New_York', 'Europe/London']);
    settings.set_boolean('clipboard-capture', true);
    await sleep(300);

    const shoot = async name => {
        await sleep(700);
        const [x, y] = preview().get_transformed_position();
        const [width, height] = preview().get_transformed_size();
        const margin = 28;
        const file = Gio.File.new_for_path(GLib.build_filenamev([directory, `${name}.png`]));
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        try {
            await new Shell.Screenshot().screenshot_area(Math.max(0, x - margin), 0,
                width + 2 * margin, y + height + margin, stream);
        } finally {
            stream.close(null);
        }
        print(`SHOT ${name} ${width}x${height}`);
    };

    // Seed real clipboard entries and notifications so populated states render.
    for (const text of ['Design review moved to 3 PM — bring the island prototypes',
        'https://extensions.gnome.org/', 'const island = new NovaIsland({glass: true});']) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        await sleep(250);
    }
    const image = GLib.getenv('NOVA_TEST_IMAGE');
    if (image && GLib.file_test(image, GLib.FileTest.EXISTS)) {
        const [, bytes] = GLib.file_get_contents(image);
        St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'image/png', new GLib.Bytes(bytes));
        await sleep(300);
    }
    const source = new MessageTray.Source({title: 'Calendar', iconName: 'x-office-calendar-symbolic'});
    Main.messageTray.add(source);
    source.addNotification(new MessageTray.Notification({source, title: 'Standup in 10 minutes',
        body: 'Room 4B', urgency: MessageTray.Urgency.HIGH}));
    await sleep(200);
    const mail = new MessageTray.Source({title: 'Mail', iconName: 'mail-unread-symbolic'});
    Main.messageTray.add(mail);
    mail.addNotification(new MessageTray.Notification({source: mail, title: 'Your build finished successfully',
        body: 'nova-island 0.5.0', urgency: MessageTray.Urgency.NORMAL}));
    await sleep(400);

    island().emit('clicked', 0);
    await waitFor(() => preview()?.mapped, 'preview');
    const modules = (GLib.getenv('NOVA_TEST_MODULES') ?? 'clock,notifications,productivity,clipboard,emoji,screenshot,system-monitor,quick-settings').split(',');
    for (const id of modules) {
        const tab = find(preview(), `nova-module-${id}`);
        if (!tab?.visible) {
            print(`SKIP ${id}`);
            continue;
        }
        tab.emit('clicked', 0);
        await waitFor(() => find(preview(), `nova-${id}`)?.mapped || id === 'clock', id);
        if (id === 'system-monitor')
            await sleep(6500);
        await shoot(id);
        if (id === 'productivity') {
            for (const view of ['world', 'stopwatch', 'countdown', 'pomodoro']) {
                find(preview(), `nova-productivity-${view}`).emit('clicked', 0);
                if (view !== 'world')
                    find(preview(), 'nova-productivity-toggle')?.emit('clicked', 0);
                await sleep(view === 'stopwatch' ? 1300 : 300);
                if (view === 'stopwatch')
                    find(preview(), 'nova-productivity-lap')?.emit('clicked', 0);
                await shoot(`productivity-${view}`);
                if (view !== 'world')
                    find(preview(), 'nova-productivity-toggle')?.emit('clicked', 0);
            }
            find(preview(), 'nova-productivity-calendar').emit('clicked', 0);
        }
        if (id === 'emoji') {
            find(preview(), 'nova-emoji-search').set_text('heart');
            await shoot('emoji-search');
            find(preview(), 'nova-emoji-search').set_text('');
        }
    }
    print('PASS design screenshots');
}
