import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Explicitly invoked by Preferences or tools/install-fonts.js, never by enable().
// Content-addressed files and exclusive copies preserve existing user fonts.
export async function installClockFonts(extensionDirectory) {
    const root = Gio.File.new_for_path(extensionDirectory).get_child('fonts');
    const [, bytes] = root.get_child('manifest.json').load_contents(null);
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    const destination = Gio.File.new_for_path(GLib.build_filenamev([
        GLib.get_user_data_dir(), 'fonts', 'nova-island']));
    GLib.mkdir_with_parents(destination.get_path(), 0o755);
    for (const font of manifest.fonts) {
        const source = root.resolve_relative_path(font.file);
        const [, contents] = source.load_contents(null);
        const hash = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, contents);
        const target = destination.get_child(`${hash}.ttf`);
        const copy = (from, to) => {
            try {
                from.copy(to, Gio.FileCopyFlags.NONE, null, null);
            } catch (error) {
                if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                    throw error;
                // Never accept a different existing file at our deterministic name.
                const [, existing] = to.load_contents(null);
                const [, expected] = from.load_contents(null);
                if (GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, existing) !==
                    GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, expected))
                    throw new Error(`Existing file differs; left untouched: ${to.get_path()}`);
            }
        };
        copy(source, target);
        copy(source.get_parent().get_child('OFL.txt'), destination.get_child(`${hash}-OFL.txt`));
    }
    const process = Gio.Subprocess.new(['fc-cache', '-f', destination.get_path()], Gio.SubprocessFlags.NONE);
    await new Promise((resolve, reject) => process.wait_check_async(null, (child, result) => {
        try { resolve(child.wait_check_finish(result)); } catch (error) { reject(error); }
    }));
    return destination.get_path();
}
