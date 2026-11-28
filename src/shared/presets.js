import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {COLOR_PATTERN} from './studio.js';

export const MAX_PRESET_BYTES = 65536;
const MAX_SAVED = 24;
const SCHEMA_VERSION = 1;
const OMIT = new Set(['saved-presets', 'last-player', 'productivity-state', 'productivity-focus-active',
    'emoji-recent', 'clipboard-capture', 'clipboard-exclusions']);
const validName = name => typeof name === 'string' && name.trim() === name &&
    name.length > 0 && name.length <= 60 && !/[\u0000-\u001f\u007f]/.test(name);
const validPlayer = value => value.startsWith('org.mpris.MediaPlayer2.') && Gio.dbus_is_name(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function snapshot(settings, name) {
    const values = Object.fromEntries(settings.settings_schema.list_keys()
        .filter(key => !OMIT.has(key)).sort()
        .map(key => [key, settings.get_value(key).deepUnpack()]));
    return validatePreset(settings, {version: SCHEMA_VERSION, name, settings: values});
}

export function validatePreset(settings, preset) {
    if (!object(preset) || Object.keys(preset).length !== 3 ||
        preset.version !== SCHEMA_VERSION || !validName(preset.name) || !object(preset.settings))
        throw new Error('Expected a version 1 NOVA preset with a name and settings.');

    const values = Object.entries(preset.settings);
    if (!values.length)
        throw new Error('The preset has no settings.');

    for (const [key, value] of values) {
        if (OMIT.has(key) || !settings.settings_schema.has_key(key))
            throw new Error(`Unknown or unsupported setting: ${key}`);
        const spec = settings.settings_schema.get_key(key);
        const type = spec.get_value_type().dup_string();
        const validType = (type === 'i' && Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647) ||
            (type === 'b' && typeof value === 'boolean') ||
            (type === 's' && typeof value === 'string' && value.length <= 256 && !value.includes('\0')) ||
            (type === 'as' && Array.isArray(value) && value.length <= 32 &&
                value.every(item => typeof item === 'string' && item.length <= 256 && !item.includes('\0')));
        if (!validType || (key.endsWith('-color') && !COLOR_PATTERN.test(value)) ||
            (key === 'default-player' && value && !validPlayer(value)) ||
            (key === 'player-priority' && !value.every(validPlayer)) ||
            !spec.range_check(new GLib.Variant(type, value)))
            throw new Error(`Invalid value for ${key}.`);
    }
    return preset;
}

export function parsePreset(settings, input) {
    if (new TextEncoder().encode(input).length > MAX_PRESET_BYTES)
        throw new Error('Preset files are limited to 64 KiB.');
    return validatePreset(settings, JSON.parse(input));
}

export function writeSettings(settings, entries) {
    const batch = new Gio.Settings({settings_schema: settings.settings_schema});
    batch.delay();
    for (const [key, value] of entries) {
        const accepted = value === undefined
            ? batch.is_writable(key)
            : batch.set_value(key, new GLib.Variant(batch.get_value(key).get_type_string(), value));
        if (!accepted) {
            batch.revert();
            throw new Error(`Setting is unavailable: ${key}`);
        }
        if (value === undefined)
            batch.reset(key);
    }
    batch.apply();
}

export function applyPreset(settings, preset) {
    validatePreset(settings, preset);
    writeSettings(settings, Object.entries(preset.settings));
}

export function listPresets(settings) {
    try {
        const list = JSON.parse(settings.get_string('saved-presets'));
        return Array.isArray(list) ? list.slice(0, MAX_SAVED).filter(preset => {
            try {
                validatePreset(settings, preset);
                return true;
            } catch {
                return false;
            }
        }) : [];
    } catch {
        return [];
    }
}

export function savePreset(settings, preset) {
    validatePreset(settings, preset);
    const list = [preset, ...listPresets(settings).filter(item => item.name !== preset.name)].slice(0, MAX_SAVED);
    settings.set_string('saved-presets', JSON.stringify(list));
}
