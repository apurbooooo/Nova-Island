import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {sleep} from 'resource:///org/gnome/shell/ui/scripting.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
function find(actor, name) {
    if (actor?.name === name) return actor;
    for (const child of actor?.get_children() ?? []) {
        const found = find(child, name);
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
export async function run() {
    await until(() => Main.extensionManager.lookup('nova-island@fromapurbo')?.stateObj, 'extension');
    const settings = Main.extensionManager.lookup('nova-island@fromapurbo').stateObj.getSettings();
    const seed = GLib.getenv('NOVA_FONT_PERSISTENCE_PHASE') === 'seed';
    if (seed) {
        settings.set_boolean('hover-expand', false);
        settings.set_boolean('reduce-motion', true);
        settings.set_boolean('media-enabled', false);
        settings.set_string('default-expanded-module', 'clock');
        settings.set_string('clock-font', 'Space Grotesk');
    } else {
        // Do not write the setting in the second compositor process.
        assert(settings.get_string('clock-font') === 'Space Grotesk', 'fresh Shell lost saved clock font');
    }
    Main.overview.hide();
    const pill = () => find(Main.panel, 'nova-island');
    const compact = () => find(pill(), 'nova-clock-compact-time');
    await until(() => compact()?.mapped && family(compact()) === 'Space Grotesk', 'persisted compact font');
    pill().emit('clicked', 0);
    const large = () => find(Main.layoutManager.uiGroup, 'nova-clock-large-time');
    await until(() => large()?.mapped && family(large()) === 'Space Grotesk', 'persisted expanded font');
    print(`PASS ${seed ? 'first Shell saved' : 'second fresh Shell restored'} Space Grotesk in compact and expanded St.Label rendering`);
}
