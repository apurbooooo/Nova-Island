import GLib from 'gi://GLib';

import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
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
    const extension = Main.extensionManager.lookup(UUID);
    const settings = extension.stateObj.getSettings();
    const preview = () => find(Main.layoutManager.uiGroup, 'nova-island-preview');
    Main.overview.hide();
    await waitFor(() => find(Main.panel, 'nova-island')?.mapped, 'panel');
    settings.set_boolean('productivity-enabled', true);
    settings.set_string('default-expanded-module', 'productivity');
    settings.set_boolean('reduce-motion', true);
    settings.set_int('productivity-countdown', 1);
    await sleep(100);
    find(Main.panel, 'nova-island').emit('clicked', 0);
    await waitFor(() => preview()?.mapped && find(preview(), 'nova-productivity-calendar')?.mapped, 'productivity view');
    find(preview(), 'nova-productivity-world').emit('clicked', 0);
    await sleep(50);
    assert(find(preview(), 'nova-productivity-world-list').get_children()
        .some(card => card.accessible_name?.includes('UTC')), 'world clocks missing');
    find(preview(), 'nova-productivity-stopwatch').emit('clicked', 0);
    find(preview(), 'nova-productivity-toggle').emit('clicked', 0);
    await sleep(1200);
    find(preview(), 'nova-productivity-toggle').emit('clicked', 0);
    const saved = JSON.parse(settings.get_string('productivity-state'));
    assert(saved.stopwatch.elapsed >= 1000, 'stopwatch elapsed missing');
    find(preview(), 'nova-productivity-countdown').emit('clicked', 0);
    find(preview(), 'nova-productivity-toggle').emit('clicked', 0);
    await sleep(2200);
    assert(find(preview(), 'nova-productivity-time').text === '0:00:00', 'countdown completion');
    assert(Main.messageTray.getSources().some(source => source.notifications.some(notification =>
        notification.body === 'Countdown complete')), 'native countdown notification missing');
    find(preview(), 'nova-productivity-pomodoro').emit('clicked', 0);
    find(preview(), 'nova-productivity-toggle').emit('clicked', 0);
    await waitFor(() => settings.get_boolean('productivity-focus-active'), 'focus mode integration');
    find(preview(), 'nova-productivity-toggle').emit('clicked', 0);
    await waitFor(() => !settings.get_boolean('productivity-focus-active'), 'focus pause');
    settings.set_boolean('productivity-enabled', false);
    await sleep(50);
    assert(!settings.get_boolean('productivity-focus-active'), 'focus leaked on disable');
    const beforeDisable = settings.get_string('productivity-state');
    Main.extensionManager.disableExtension(UUID);
    await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.INACTIVE, 'extension disable');
    Main.extensionManager.enableExtension(UUID);
    await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.ACTIVE, 'extension re-enable');
    assert(settings.get_string('productivity-state') === beforeDisable, 'saved timers changed on re-enable');
    assert(!settings.get_boolean('productivity-focus-active'), 'focus recovered as active');
    print('PASS calendar actor, world clocks, stopwatch, countdown, focus integration, and module cleanup');
}
