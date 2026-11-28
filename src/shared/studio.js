export const SIZE = [
    ['compact-width', 'Compact width'], ['compact-height', 'Compact height'],
    ['expanded-width', 'Expanded width'], ['expanded-height', 'Expanded height'],
];
export const SURFACE = [
    ['glass-opacity', 'Surface opacity'], ['border-radius', 'Corner radius'],
    ['border-thickness', 'Border thickness'], ['border-opacity', 'Border opacity'],
    ['shadow-intensity', 'Shadow intensity'], ['shadow-blur', 'Shadow blur'],
    ['shadow-spread', 'Shadow spread'],
];
export const COLORS = [
    ['surface-color', 'Surface'], ['border-color', 'Border'], ['accent-color', 'Accent'],
    ['text-color', 'Text'], ['secondary-text-color', 'Secondary text'],
];
export const CONTENT = [
    ['clock-font-size', 'Clock font size'], ['compact-spacing', 'Compact spacing'],
    ['expanded-spacing', 'Expanded spacing'],
];
export const MOTION = [
    ['animation-speed', 'Speed (%)'], ['expand-duration', 'Expansion duration (ms)'],
    ['collapse-duration', 'Collapse duration (ms)'], ['content-fade-duration', 'Content fade (ms)'],
    ['animation-intensity', 'Intensity (%)'], ['mouse-leave-delay', 'Mouse-leave delay (ms)'],
];
export const THEME_TOKENS = [...SURFACE, ...COLORS, ...CONTENT].map(([key]) => key);

const dark = Object.freeze({
    'glass-opacity': 94, 'border-radius': 24, 'border-thickness': 1, 'border-opacity': 36,
    'shadow-intensity': 42, 'shadow-blur': 22, 'shadow-spread': 0, 'surface-color': '#090b11',
    'border-color': '#bfcef0', 'accent-color': '#bdceff', 'text-color': '#f3f5fc',
    'secondary-text-color': '#b2bcd6', 'clock-font-size': 14, 'compact-spacing': 9, 'expanded-spacing': 6,
});

export const THEMES = Object.freeze({
    'nova-dark': ['NOVA Dark', dark],
    midnight: ['Midnight', {...dark, 'surface-color': '#101734', 'accent-color': '#a8baff',
        'border-color': '#8ea5ff', 'secondary-text-color': '#c1ccf8', 'border-opacity': 46}],
    frosted: ['Frosted Glass', {...dark, 'surface-color': '#26324a', 'glass-opacity': 86,
        'border-color': '#d7eeff', 'accent-color': '#c5eaff', 'border-opacity': 62,
        'secondary-text-color': '#e3edfa', 'shadow-intensity': 28, 'shadow-blur': 26}],
    minimal: ['Minimal Black', {...dark, 'surface-color': '#080808', 'glass-opacity': 100,
        'accent-color': '#eeeeee', 'border-opacity': 18, 'shadow-intensity': 0,
        'border-radius': 16, 'secondary-text-color': '#bdbdbd'}],
    aurora: ['Aurora', {...dark, 'surface-color': '#142632', 'accent-color': '#77e9cb',
        'border-color': '#79dac8', 'secondary-text-color': '#bbe5dc', 'glass-opacity': 90,
        'border-opacity': 55, 'shadow-blur': 30}],
    custom: ['Custom', null],
});
export const ALIGNMENTS = [['start', 'Start'], ['center', 'Center'], ['end', 'End']];
export const ANIMATIONS = [['nova', 'NOVA'], ['smooth', 'Smooth'], ['spring', 'Spring'], ['fade', 'Fade']];
export const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
export const MODULES = [['clock', 'Clock'], ['media', 'Media Player'], ['notifications', 'Notifications'],
    ['productivity', 'Productivity'], ['clipboard', 'Clipboard'], ['emoji', 'Emoji'],
    ['screenshot', 'Screenshot Studio'], ['system-monitor', 'System Monitor'], ['quick-settings', 'Quick Settings']];
export const MODULE_ICONS = Object.freeze({
    clock: 'preferences-system-time-symbolic',
    media: 'audio-x-generic-symbolic',
    notifications: 'preferences-system-notifications-symbolic',
    productivity: 'x-office-calendar-symbolic',
    clipboard: 'edit-paste-symbolic',
    emoji: 'face-smile-symbolic',
    screenshot: 'applets-screenshooter-symbolic',
    'system-monitor': 'power-profile-performance-symbolic',
    'quick-settings': 'view-grid-symbolic',
});

export function readSetting(settings, key, fallback = undefined) {
    return settings.settings_schema.has_key(key) ? settings.get_value(key).deepUnpack() : fallback;
}

export function readAppearance(settings) {
    return Object.fromEntries(THEME_TOKENS.map(key => {
        const value = readSetting(settings, key, dark[key]);
        return [key, typeof dark[key] === 'string' && !COLOR_PATTERN.test(value) ? dark[key] : value];
    }));
}

export function rgba(hex, percent) {
    const rgb = hex.slice(1).match(/../g).map(pair => parseInt(pair, 16));
    return `rgba(${rgb.join(', ')}, ${percent / 100})`;
}

export function surfaceStyle(tokens, compact) {
    const opacity = tokens['shadow-intensity'];
    const radius = tokens['border-radius'];
    return [
        `background-color: ${rgba(tokens['surface-color'], tokens['glass-opacity'])}`,
        `color: ${tokens['text-color']}`,
        `border: ${tokens['border-thickness']}px solid ${rgba(tokens['border-color'], tokens['border-opacity'])}`,
        `border-radius: ${radius}px`,
        `box-shadow: 0 ${compact ? 1 : 8}px ${compact ? Math.round(tokens['shadow-blur'] / 5) : tokens['shadow-blur']}px ${tokens['shadow-spread']}px ${rgba('#000000', opacity)}`,
    ].join('; ') + ';';
}
