import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {sleep} from 'resource:///org/gnome/shell/ui/scripting.js';

export async function run() {
    await sleep(500);
    Main.overview.hide();
    const extension = Main.extensionManager.lookup('nova-island@fromapurbo').stateObj;
    const {LifecycleManager} = await import(extension.dir.get_child('src/shell/lifecycleManager.js').get_uri());
    const {createSystemMonitorWidget} = await import(extension.dir.get_child('src/shell/widgets/systemMonitor.js').get_uri());
    const lifecycle = new LifecycleManager();
    // Real monitor services, with fixture viewport sizes; no metric data is mocked.
    const view = createSystemMonitorWidget(lifecycle, () => {}, {
        get(key, fallback) {
            return key === 'system-monitor-enabled' ? true : key === 'system-monitor-interval' ? 1 : fallback;
        },
    });
    const surface = new St.Bin({child: view.expanded, width: 860, height: 620, x: 10, y: 40,
        style_class: 'nova-island-popover', reactive: true});
    Main.layoutManager.addChrome(surface);
    try {
        await sleep(2500);
        for (const [width, expected] of [[360, 1], [580, 2], [860, 3]]) {
            surface.width = width;
            await sleep(500);
            const content = view.content;
            const grid = content.get_children().find(child => child.name === 'nova-monitor-grid');
            const cards = grid.get_children().filter(child => child.visible);
            const rows = new Map();
            for (const card of cards) {
                if (card.width < 245 || card.x + card.width > content.width + 1)
                    throw new Error(`Unusable card at ${width}: ${card.width}`);
                rows.set(card.y, (rows.get(card.y) ?? 0) + 1);
            }
            const columns = Math.max(...rows.values());
            if (columns !== expected)
                throw new Error(`Expected ${expected} columns at ${width}, got ${columns}`);
            const directory = GLib.getenv('NOVA_TEST_SCREENSHOTS');
            if (directory) {
                const stream = Gio.File.new_for_path(`${directory}/system-monitor-widget-${width}.png`)
                    .replace(null, false, Gio.FileCreateFlags.NONE, null);
                try { await new Shell.Screenshot().screenshot_area(10, 40, width, 620, stream); }
                finally { stream.close(null); }
            }
            print(`PASS real Shell monitor widget at ${width}px: ${columns} columns, readable cards`);
        }
    } finally {
        lifecycle.destroy();
        Main.layoutManager.removeChrome(surface);
        surface.destroy();
    }
}
