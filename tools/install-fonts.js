import Gio from 'gi://Gio';
import {installClockFonts} from '../src/shared/installClockFonts.js';

const directory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();
print(`Installed clock fonts in ${await installClockFonts(directory)}`);
print('Log out and back in on Wayland, then reopen NOVA Preferences to refresh Shell and GTK font maps.');
