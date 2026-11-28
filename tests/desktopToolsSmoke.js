import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

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
    const settings = Main.extensionManager.lookup(UUID).stateObj.getSettings();
    const preview = () => find(Main.layoutManager.uiGroup, 'nova-island-preview');
    const inPreview = name => find(preview(), name);
    const screenshot = async name => {
        const directory = GLib.getenv('NOVA_TEST_SCREENSHOTS');
        if (!directory)
            return;
        const file = Gio.File.new_for_path(GLib.build_filenamev([directory, `${name}.png`]));
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        try {
            await new Shell.Screenshot().screenshot_area(350, 0, 580, 410, stream);
        } finally {
            stream.close(null);
        }
    };
    const select = async id => {
        inPreview(`nova-module-${id}`).emit('clicked', 0);
        await waitFor(() => inPreview(`nova-${id}`)?.mapped, id);
    };
    Main.overview.hide();
    await waitFor(() => find(Main.panel, 'nova-island')?.mapped, 'panel');
    for (const id of ['clipboard', 'emoji', 'screenshot', 'system-monitor', 'quick-settings'])
        settings.set_boolean(`${id}-enabled`, true);
    settings.set_boolean('clipboard-capture', false);
    settings.set_boolean('reduce-motion', true);
    settings.set_string('default-expanded-module', 'clipboard');
    await sleep(100);
    find(Main.panel, 'nova-island').emit('clicked', 0);
    await waitFor(() => inPreview('nova-clipboard')?.mapped, 'clipboard module');
    const clipboard = St.Clipboard.get_default();
    clipboard.set_text(St.ClipboardType.CLIPBOARD, 'Capture is off test');
    await sleep(100);
    assert(inPreview('nova-clipboard-list').get_children().length === 0, 'capture without opt-in');
    settings.set_boolean('clipboard-capture', true);
    await sleep(80);
    clipboard.set_text(St.ClipboardType.CLIPBOARD, 'NOVA clipboard test');
    await waitFor(() => inPreview('nova-clipboard-list').get_children().length === 1, 'Wayland clipboard transfer');
    clipboard.set_text(St.ClipboardType.CLIPBOARD, 'password=hidden');
    await sleep(150);
    assert(inPreview('nova-clipboard-list').get_children().length === 1, 'sensitive capture');
    clipboard.set_text(St.ClipboardType.PRIMARY, 'Primary selection must be ignored');
    await sleep(100);
    assert(inPreview('nova-clipboard-list').get_children().length === 1, 'primary selection captured');
    const png = GLib.base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMoX3oJAAOFAe+H+mq0AAAAAElFTkSuQmCC');
    clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', new GLib.Bytes(png));
    await waitFor(() => inPreview('nova-clipboard-list').get_children().length === 2, 'PNG clipboard');
    inPreview('nova-clipboard-search').set_text('NOVA');
    await waitFor(() => inPreview('nova-clipboard-list').get_children().length === 1, 'history search');
    inPreview('nova-clipboard-clear').emit('clicked', 0);
    assert(inPreview('nova-clipboard-list').get_children().length === 0, 'clear history');
    await select('emoji');
    inPreview('nova-emoji-search').set_text('penguin');
    await waitFor(() => inPreview('nova-emoji-results').get_children().filter(child => child.visible).length === 1, 'offline emoji search');
    inPreview('nova-emoji-results').get_children().find(child => child.visible).emit('clicked', 0);
    assert(settings.get_string('emoji-recent').includes('🐧'), 'emoji recent');
    await screenshot('emoji');
    await select('system-monitor');
    await waitFor(() => inPreview('nova-system-monitor-values').text.includes('Memory'), 'live memory sampling');
    await waitFor(() => inPreview('nova-system-monitor-values').text.includes('CPU'), 'live CPU sampling');
    await screenshot('system-monitor');
    const {SystemMonitor} = await import(Main.extensionManager.lookup(UUID).dir.get_child('src/desktop/systemMonitor.js').get_uri());
    const originalSample = SystemMonitor.prototype.sample;
    const summary = inPreview('nova-system-monitor-values');
    const grid = inPreview('nova-monitor-grid');
    let sample = 0;
    const geometry = () => JSON.stringify([preview().width, preview().height,
        grid.get_children().filter(card => card.visible).map(card => [card.x, card.y, card.width, card.height])]);
    try {
        SystemMonitor.prototype.sample = async function () {
            sample++;
            const dropped = sample === 2;
            this.changed({cpu: 42, cpuAvailable: true, network: {rx: 100, tx: 200}, networkAvailable: true,
                memory: {used: 2 ** 30, total: 2 ** 31},
                sensors: dropped ? [] : [{key: 'fixture-gpu', kind: 'percent', group: 'gpu', value: 60},
                    {key: 'fixture-battery', kind: 'battery', value: 100, status: 'Full'},
                    {key: 'fixture-thermal', kind: 'temperature', group: 'cpu', label: 'CPU', value: 50}]});
        };
        settings.set_int('system-monitor-interval', 1);
        await waitFor(() => sample === 1 && summary.text.includes('GPU 60%'), 'monitor fixture');
        await sleep(150);
        const bounds = geometry();
        await waitFor(() => sample === 2 && !summary.text.includes('GPU'), 'sample with missing readings');
        await sleep(150);
        assert(geometry() === bounds && preview().mapped, 'missing readings shifted the System Monitor');
        await waitFor(() => sample >= 3 && summary.text.includes('GPU 60%'), 'sensor recovery');
        assert(geometry() === bounds, 'recovering readings shifted the System Monitor');
    } finally {
        SystemMonitor.prototype.sample = originalSample;
    }
    await select('quick-settings');
    assert(inPreview('nova-quick-settings-network').mapped, 'native device controls missing');
    inPreview('nova-quick-settings-network').emit('clicked', 0);
    await waitFor(() => Main.panel.statusArea.quickSettings.menu.isOpen, 'native quick settings menu');
    Main.panel.statusArea.quickSettings.menu.close();
    find(Main.panel, 'nova-island').emit('clicked', 0);
    await waitFor(() => preview()?.mapped, 'island reopened');
    await select('screenshot');
    inPreview('nova-screenshot-capture').emit('clicked', 0);
    await waitFor(() => Main.screenshotUI.visible, 'native screenshot selector');
    Main.screenshotUI.close(true);
    Main.sessionMode.pushMode('unlock-dialog');
    await waitFor(() => !preview()?.mapped, 'lock privacy');
    Main.sessionMode.popMode('unlock-dialog');
    await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.ACTIVE, 'unlock re-enable');
    Main.extensionManager.disableExtension(UUID);
    await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.INACTIVE, 'disable');
    Main.extensionManager.enableExtension(UUID);
    await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.ACTIVE, 're-enable');
    await waitFor(() => find(Main.panel, 'nova-island')?.mapped, 'restored panel');
    settings.set_string('default-expanded-module', 'clipboard');
    await sleep(50);
    find(Main.panel, 'nova-island').emit('clicked', 0);
    await waitFor(() => inPreview('nova-clipboard')?.mapped, 'restored clipboard');
    assert(inPreview('nova-clipboard-list').get_children().length === 0, 'history survived teardown');
    settings.set_boolean('clipboard-capture', false);
    for (const id of ['clipboard', 'emoji', 'screenshot', 'system-monitor', 'quick-settings'])
        settings.set_boolean(`${id}-enabled`, false);
    print('PASS opt-in Wayland text/PNG transfer, secret filter, search/clear, offline emoji, real proc counters, native device view, screenshot selector cancellation, and lifecycle');
}
