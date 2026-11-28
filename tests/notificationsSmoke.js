import GLib from 'gi://GLib';

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
    for (let i = 0; i < 250; i++) {
        if (condition())
            return;
        await sleep(20);
    }
    throw new Error(`Timed out waiting for ${description}`);
}

export async function run() {
    await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.ACTIVE, 'extension');
    const settings = Main.extensionManager.lookup(UUID).stateObj.getSettings();
    const preview = () => find(Main.layoutManager.uiGroup, 'nova-island-preview');
    const source = new MessageTray.Source({title: 'NOVA test source'});
    const send = (title, urgency = MessageTray.Urgency.NORMAL) => source.addNotification(
        new MessageTray.Notification({source, title, urgency}));
    Main.messageTray.add(source);
    try {
        Main.overview.hide();
        await waitFor(() => find(Main.panel, 'nova-island')?.mapped, 'NOVA panel');
        settings.set_boolean('notifications-enabled', true);
        settings.set_boolean('notifications-auto-expand', true);
        settings.set_int('notifications-peek-duration', 600);
        await waitFor(() => find(preview(), 'nova-module-notifications')?.visible,
            'notifications module enabled');
        send('First event');
        await waitFor(() => preview()?.mapped && find(preview(), 'nova-module-notifications')?.mapped,
            'notification preview');
        assert(find(preview(), 'nova-module-notifications'), 'notification tab missing');
        await waitFor(() => !preview()?.mapped, 'peek timer closes preview');
        settings.set_boolean('notifications-dnd', true);
        send('Quiet event');
        await sleep(100);
        assert(!preview().mapped, 'DND showed NOVA preview');
        settings.set_boolean('notifications-dnd', false);
        settings.set_boolean('notifications-focus-mode', true);
        send('Normal in focus');
        await sleep(100);
        assert(!preview().mapped, 'focus mode showed normal preview');
        send('Critical in focus', MessageTray.Urgency.CRITICAL);
        await waitFor(() => preview()?.mapped, 'critical preview in focus mode');
        for (let i = 0; i < 25; i++)
            send(`History event ${i}`);
        const list = find(preview(), 'nova-notifications-list');
        await waitFor(() => list?.get_children().length === 20, 'bounded history');
        list.get_first_child().get_last_child().emit('clicked', 0);
        await waitFor(() => list.get_children().length === 19, 'local history dismissal');
        find(preview(), 'nova-notifications-clear').emit('clicked', 0);
        await waitFor(() => list.get_children().length === 1, 'cleared NOVA history');
        Main.sessionMode.pushMode('unlock-dialog');
        await waitFor(() => !preview()?.mapped, 'lock hides NOVA');
        Main.sessionMode.popMode('unlock-dialog');
        settings.set_boolean('notifications-enabled', false);
        send('After disable');
        await sleep(80);
        assert(!preview()?.mapped, 'disabled notifications showed a preview');
        settings.set_boolean('notifications-focus-mode', false);
        settings.set_boolean('notifications-enabled', true);
        await waitFor(() => find(preview(), 'nova-module-notifications')?.visible,
            'notifications module re-enabled');
        send('After re-enable');
        await waitFor(() => preview()?.mapped, 'preview after re-enable');
        assert(find(preview(), 'nova-notifications-list').get_children().length === 1,
            'duplicate source signals after re-enable');
        print('PASS notification preview duration, DND, focus priority, lock privacy, and disable cleanup');
    } finally {
        if (Main.sessionMode.isLocked)
            Main.sessionMode.popMode('unlock-dialog');
        settings.set_boolean('notifications-enabled', false);
        source.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    }
}
