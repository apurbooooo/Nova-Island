import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function readFile(path, cancellable, maxBytes = 1048576) {
    const file = Gio.File.new_for_path(path);
    return new Promise((resolve, reject) => {
        file.read_async(GLib.PRIORITY_DEFAULT, cancellable, (_file, result) => {
            let stream;
            try { stream = file.read_finish(result); }
            catch (error) { reject(error); return; }
            stream.read_bytes_async(maxBytes + 1, GLib.PRIORITY_DEFAULT, cancellable, (_stream, readResult) => {
                try {
                    const bytes = stream.read_bytes_finish(readResult);
                    if (bytes.get_size() > maxBytes)
                        throw new Error('File exceeds size limit');
                    resolve(bytes);
                } catch (error) {
                    reject(error);
                } finally {
                    stream.close_async(GLib.PRIORITY_DEFAULT, null, (input, closeResult) => {
                        try { input.close_finish(closeResult); } catch { /* Already closed. */ }
                    });
                }
            });
        });
    });
}

export async function readText(path, cancellable) {
    return new TextDecoder().decode((await readFile(path, cancellable)).get_data());
}

export function listDirectories(path, cancellable) {
    const file = Gio.File.new_for_path(path);
    return new Promise(resolve => {
        file.enumerate_children_async('standard::name', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT, cancellable, (_file, result) => {
                let enumerator;
                try { enumerator = file.enumerate_children_finish(result); }
                catch { resolve([]); return; }
                enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, cancellable, (_enumerator, nextResult) => {
                    try { resolve(enumerator.next_files_finish(nextResult).map(info => info.get_name())); }
                    catch { resolve([]); }
                    finally {
                        enumerator.close_async(GLib.PRIORITY_DEFAULT, null, (input, closeResult) => {
                            try { input.close_finish(closeResult); } catch { /* Already closed. */ }
                        });
                    }
                });
            });
    });
}
