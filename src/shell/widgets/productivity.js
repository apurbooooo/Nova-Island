import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {SessionTimer} from '../../productivity/timers.js';
import {Ring, Theme, bindTheme, box, card, clearChildren, emptyState, icon, iconButton, inkFor, label,
    makePrimary, rgbaCss, sectionTitle, segmented} from '../ui/kit.js';

const BREAK_COLOR = '#7ee8b4';
const formatTime = milliseconds => {
    const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
    return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const shortTime = milliseconds => {
    const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
    const hours = Math.floor(seconds / 3600);
    const rest = `${String(Math.floor(seconds / 60) % 60).padStart(hours ? 2 : 1, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    return hours ? `${hours}:${rest}` : rest;
};
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

function roundButton({iconName, accessibleName, callback, name = null, large = false, primary = false}) {
    const button = iconButton({iconName, accessibleName, callback, name, size: large ? 22 : 16,
        style_class: `nova-round-btn${large ? ' nova-round-btn-large' : ''}`});
    if (primary) {
        bindTheme(button, theme => {
            button.style = `background-color: ${theme.accent}; color: ${inkFor(theme.accent)};`;
        });
    }
    return button;
}

export function createProductivityWidget(lifecycle, onChanged, settings) {
    const compact = box({style_class: 'nova-productivity-compact', y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.CENTER});
    const compactIcon = icon('x-office-calendar-symbolic', 14);
    const compactText = label(_('Productivity'));
    compact.add_child(compactIcon);
    compact.add_child(compactText);
    const expanded = box({vertical: true, style_class: 'nova-productivity', name: 'nova-productivity'});
    const tabs = segmented([
        ['calendar', _('Calendar'), 'x-office-calendar-symbolic', 'nova-productivity-calendar'],
        ['world', _('World'), 'preferences-system-time-symbolic', 'nova-productivity-world'],
        ['stopwatch', _('Stopwatch'), 'media-playback-start-symbolic', 'nova-productivity-stopwatch'],
        ['countdown', _('Timer'), 'alarm-symbolic', 'nova-productivity-countdown'],
        ['pomodoro', _('Focus'), 'weather-clear-night-symbolic', 'nova-productivity-pomodoro'],
    ], key => {
        selected = key;
        render();
    });
    expanded.add_child(tabs.actor);
    const scroll = new St.ScrollView({x_expand: true, y_expand: true,
        hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
    const content = box({vertical: true, style_class: 'nova-productivity-content', x_expand: true});
    scroll.set_child(content);
    expanded.add_child(scroll);
    const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    const now = () => GLib.get_monotonic_time() / 1000;
    const stopwatch = new SessionTimer(now);
    const countdown = new SessionTimer(now, settings.get('productivity-countdown', 300) * 1000);
    const pomodoro = new SessionTimer(now, settings.get('productivity-focus-minutes', 25) * 60000);
    const timers = {stopwatch, countdown, pomodoro};
    try {
        const saved = JSON.parse(settings.get('productivity-state', '{}'));
        if (saved.version === 1)
            Object.entries(timers).forEach(([key, timer]) => timer.restore(saved[key]));
    } catch { /* Ignore malformed saved state. */ }
    let selected = 'calendar';
    let source = 0;
    let refreshView = null;
    let eventSource;
    let eventSignal = 0;
    let calendarChanged = null;
    let selectedDate = new Date();
    let shownMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    let destroyed = false;
    let lastCheckpoint = now();
    const save = () => settings.set('productivity-state', JSON.stringify({version: 1,
        ...Object.fromEntries(Object.entries(timers).map(([key, timer]) => [key, timer.snapshot()]))}));
    const focusActive = () => settings.get('productivity-enabled', false) && pomodoro.running && pomodoro.phase === 'focus';
    settings.setBoolean('productivity-focus-active', false);
    const ensureEventSource = () => {
        if (!eventSource) {
            eventSource = new Calendar.DBusEventSource();
            eventSignal = eventSource.connect('changed', () => calendarChanged?.());
        }
        return eventSource;
    };
    const releaseCalendar = () => {
        if (eventSource && eventSignal)
            eventSource.disconnect(eventSignal);
        eventSource?.destroy();
        eventSource = null;
        eventSignal = 0;
    };
    const timeFormat = () => interfaceSettings.get_string('clock-format') === '12h' ? '%-l:%M %p' : '%H:%M';

    function updateCompact() {
        const running = [['pomodoro', pomodoro], ['countdown', countdown], ['stopwatch', stopwatch]]
            .find(([, timer]) => timer.running);
        if (running) {
            const [key, timer] = running;
            compactIcon.icon_name = key === 'stopwatch' ? 'media-playback-start-symbolic'
                : key === 'countdown' ? 'alarm-symbolic' : 'weather-clear-night-symbolic';
            compactText.text = key === 'stopwatch' ? shortTime(timer.value)
                : `${key === 'pomodoro' ? (timer.phase === 'focus' ? _('Focus') : _('Break')) + ' ' : ''}${shortTime(timer.remaining)}`;
        } else {
            compactIcon.icon_name = 'x-office-calendar-symbolic';
            compactText.text = GLib.DateTime.new_now_local().format('%a %-d %b');
        }
    }

    function update() {
        if (destroyed)
            return;
        let changed = false;
        if (countdown.finish()) {
            Main.notify(_('NOVA Island'), _('Countdown complete'));
            changed = true;
        }
        if (pomodoro.finish()) {
            Main.notify(_('NOVA Island'), pomodoro.phase === 'focus' ? _('Focus interval complete') : _('Break complete'));
            pomodoro.nextPhase(settings.get('productivity-focus-minutes', 25) * 60000,
                settings.get('productivity-break-minutes', 5) * 60000);
            changed = true;
        }
        if (changed)
            save();
        if (Object.values(timers).some(timer => timer.running) && now() - lastCheckpoint >= 15000) {
            save();
            lastCheckpoint = now();
        }
        settings.setBoolean('productivity-focus-active', focusActive());
        updateCompact();
        refreshView?.();
        if (changed)
            onChanged(false);
    }

    function schedule() {
        if (source) {
            GLib.Source.remove(source);
            source = 0;
        }
        const active = Object.values(timers).some(timer => timer.running);
        if (settings.get('productivity-enabled', false) && (active || expanded.mapped)) {
            source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, active ? 1 : 30, () => {
                update();
                if (!Object.values(timers).some(timer => timer.running) && !expanded.mapped) {
                    source = 0;
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    function timerAction(timer, kind) {
        if (kind === 'toggle') {
            if (timer.running) {
                timer.pause();
            } else {
                if (selected !== 'stopwatch' && timer.remaining === 0)
                    timer.reset();
                timer.start();
            }
        } else if (kind === 'reset') {
            timer.reset(selected === 'countdown' ? settings.get('productivity-countdown', 300) * 1000
                : selected === 'pomodoro' ? settings.get('productivity-focus-minutes', 25) * 60000 : 0);
        } else if (kind === 'lap') {
            timer.lap();
        }
        save();
        update();
        schedule();
        if (kind === 'lap')
            render();
        onChanged(false);
    }

    function controls(timer, {lap = false} = {}) {
        const row = box({style_class: 'nova-productivity-controls', x_align: Clutter.ActorAlign.CENTER});
        const reset = roundButton({iconName: 'view-refresh-symbolic', accessibleName: _('Reset'),
            name: 'nova-productivity-reset', callback: () => timerAction(timer, 'reset')});
        const toggle = roundButton({iconName: 'media-playback-start-symbolic', accessibleName: _('Start'),
            name: 'nova-productivity-toggle', large: true, primary: true,
            callback: () => timerAction(timer, 'toggle')});
        row.add_child(reset);
        row.add_child(toggle);
        if (lap) {
            const lapButton = roundButton({iconName: 'starred-symbolic', accessibleName: _('Lap'),
                name: 'nova-productivity-lap', callback: () => timerAction(timer, 'lap')});
            row.add_child(lapButton);
            lapButton._sync = () => {
                lapButton.reactive = lapButton.can_focus = timer.running;
                lapButton.opacity = timer.running ? 255 : 110;
            };
        } else {
            // Keep the primary control centered.
            row.add_child(new St.Widget({style: 'width: 44px;'}));
        }
        const sync = () => {
            toggle.child.icon_name = timer.running ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
            toggle.accessible_name = timer.running ? _('Pause') : _('Start');
            row.get_last_child()._sync?.();
        };
        return {row, sync};
    }

    function renderCalendar() {
        ensureEventSource();
        const weekStart = Shell.util_get_week_start();
        const head = box({style_class: 'nova-cal-head'});
        const title = label('', 'nova-cal-month', {x_expand: true});
        const today = new St.Button({label: _('Today'), style_class: 'nova-btn nova-btn-ghost', can_focus: true,
            reactive: true, accessible_name: _('Go to today')});
        const previous = iconButton({iconName: 'go-previous-symbolic', accessibleName: _('Previous month'),
            style_class: 'nova-icon-btn nova-icon-btn-filled'});
        const next = iconButton({iconName: 'go-next-symbolic', accessibleName: _('Next month'),
            style_class: 'nova-icon-btn nova-icon-btn-filled'});
        [title, today, previous, next].forEach(actor => head.add_child(actor));
        const gridLayout = new Clutter.GridLayout({column_homogeneous: true, row_spacing: 3, column_spacing: 3});
        const grid = new St.Widget({layout_manager: gridLayout, style_class: 'nova-cal-grid', x_expand: true});
        const agenda = card('', true, {x_expand: true});
        content.add_child(head);
        content.add_child(grid);
        content.add_child(agenda);

        const eventsFor = date => {
            const begin = new Date(date);
            begin.setHours(0, 0, 0, 0);
            const end = new Date(begin);
            end.setDate(end.getDate() + 1);
            return eventSource.getEvents(begin, end);
        };
        const paintAgenda = () => {
            clearChildren(agenda);
            const isToday = sameDay(selectedDate, new Date());
            const day = GLib.DateTime.new_from_unix_local(Math.floor(selectedDate.getTime() / 1000));
            agenda.add_child(label(`${isToday ? _('Today') + ' · ' : ''}${day.format('%A, %B %-d')}`, 'nova-card-title'));
            if (!eventSource.hasCalendars) {
                agenda.add_child(label(_('No calendars connected. Add an account in Settings → Online Accounts or GNOME Calendar.'),
                    'nova-caption', {wrap: true}));
                return;
            }
            const events = eventsFor(selectedDate).slice(0, 8);
            if (!events.length) {
                agenda.add_child(label(_('Nothing scheduled'), 'nova-caption'));
                return;
            }
            for (const event of events) {
                const row = box({style_class: 'nova-event-row'});
                const bar = new St.Widget({style_class: 'nova-event-bar', y_expand: true});
                bindTheme(bar, theme => (bar.style = `background-color: ${theme.accent};`));
                const text = box({vertical: true, x_expand: true});
                text.add_child(label(String(event.summary ?? '').slice(0, 160), 'nova-body'));
                const start = GLib.DateTime.new_from_unix_local(Math.floor(event.date.getTime() / 1000));
                const allDay = event.date.getHours() === 0 && event.date.getMinutes() === 0 &&
                    event.end.getTime() - event.date.getTime() >= 86400000;
                text.add_child(label(allDay ? _('All day') : start.format(timeFormat()), 'nova-caption'));
                row.add_child(bar);
                row.add_child(text);
                agenda.add_child(row);
            }
        };
        const paintGrid = () => {
            for (const child of grid.get_children())
                child.destroy();
            const month = GLib.DateTime.new_local(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1, 0, 0, 0);
            title.text = month.format('%B %Y');
            const first = new Date(shownMonth);
            const offset = (first.getDay() - weekStart + 7) % 7;
            const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
            const end = new Date(start);
            end.setDate(end.getDate() + 42);
            eventSource.requestRange(start, end);
            for (let column = 0; column < 7; column++) {
                const weekday = GLib.DateTime.new_local(2023, 1, 1 + (weekStart + column) % 7, 0, 0, 0);
                const header = label(weekday.format('%a').slice(0, 2).toLocaleUpperCase(), 'nova-cal-weekday',
                    {x_align: Clutter.ActorAlign.CENTER, ellipsize: false});
                gridLayout.attach(header, column, 0, 1, 1);
            }
            const now = new Date();
            for (let index = 0; index < 42; index++) {
                const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
                const inside = date.getMonth() === shownMonth.getMonth();
                const cell = box({vertical: true, style_class: 'nova-cal-day-content',
                    x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
                cell.add_child(label(String(date.getDate()), '', {x_align: Clutter.ActorAlign.CENTER}));
                const dot = new St.Widget({style_class: 'nova-cal-dot', x_align: Clutter.ActorAlign.CENTER,
                    opacity: eventSource.hasCalendars && eventSource.hasEvents(date) ? 255 : 0});
                cell.add_child(dot);
                const button = new St.Button({child: cell, style_class: 'nova-cal-day', x_expand: true,
                    can_focus: true, reactive: true, accessible_name: GLib.DateTime.new_local(date.getFullYear(),
                        date.getMonth() + 1, date.getDate(), 0, 0, 0).format('%A, %B %-d, %Y')});
                if (!inside)
                    button.add_style_class_name('nova-cal-day-outside');
                else if (date.getDay() === 0 || date.getDay() === 6)
                    button.add_style_class_name('nova-cal-day-weekend');
                const isToday = sameDay(date, now);
                const isSelected = sameDay(date, selectedDate);
                if (isSelected && !isToday)
                    button.add_style_class_name('nova-cal-day-selected');
                bindTheme(button, theme => {
                    button.style = isToday ? `background-color: ${theme.accent}; color: ${inkFor(theme.accent)};`
                        : isSelected ? `background-color: ${rgbaCss(theme.accent, 0.16)};` : '';
                    dot.style = `background-color: ${isToday ? inkFor(theme.accent) : theme.accent};`;
                });
                button.connect('clicked', () => {
                    selectedDate = date;
                    if (!inside)
                        shownMonth = new Date(date.getFullYear(), date.getMonth(), 1);
                    paintGrid();
                    paintAgenda();
                    onChanged(false);
                });
                gridLayout.attach(button, index % 7, 1 + Math.floor(index / 7), 1, 1);
            }
        };
        const shift = months => {
            shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + months, 1);
            paintGrid();
        };
        previous.connect('clicked', () => shift(-1));
        next.connect('clicked', () => shift(1));
        today.connect('clicked', () => {
            selectedDate = new Date();
            shownMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
            paintGrid();
            paintAgenda();
        });
        calendarChanged = () => {
            paintGrid();
            paintAgenda();
            onChanged(false);
        };
        paintGrid();
        paintAgenda();
    }

    function renderWorld() {
        const list = box({vertical: true, name: 'nova-productivity-world-list', style_class: 'nova-clip-list',
            x_expand: true});
        content.add_child(list);
        const zones = settings.get('productivity-timezones', ['UTC']).slice(0, 12);
        const rows = zones.map(zone => {
            const timezone = GLib.TimeZone.new_identifier(zone);
            const row = card('nova-world-card', false, {x_expand: true, reactive: false});
            const text = box({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            const parts = zone.split('/');
            const city = label((parts.at(-1) ?? zone).replace(/_/g, ' '), 'nova-card-title');
            const region = label('', 'nova-caption');
            text.add_child(city);
            text.add_child(region);
            const time = label('', 'nova-world-time', {y_align: Clutter.ActorAlign.CENTER});
            row.add_child(text);
            row.add_child(time);
            list.add_child(row);
            return {zone, timezone, row, region, time};
        });
        refreshView = () => {
            const local = GLib.DateTime.new_now_local();
            for (const {zone, timezone, row, region, time} of rows) {
                if (!timezone) {
                    time.text = '—';
                    region.text = _('Invalid time zone');
                    row.accessible_name = `${zone} ${_('Invalid time zone')}`;
                    continue;
                }
                const there = GLib.DateTime.new_now(timezone);
                const days = Math.round((Date.UTC(there.get_year(), there.get_month() - 1, there.get_day_of_month()) -
                    Date.UTC(local.get_year(), local.get_month() - 1, local.get_day_of_month())) / 86400000);
                const dayText = days === 0 ? _('Today') : days > 0 ? _('Tomorrow') : _('Yesterday');
                const delta = (there.get_utc_offset() - local.get_utc_offset()) / 3600000000;
                const hours = Math.trunc(Math.abs(delta));
                const minutes = Math.round((Math.abs(delta) - hours) * 60);
                const deltaText = delta === 0 ? _('Same time') : `${delta > 0 ? '+' : '-'}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''} h`;
                const area = zone.includes('/') ? zone.split('/')[0].replace(/_/g, ' ') : zone;
                region.text = `${dayText} · ${deltaText} · ${area}`;
                time.text = there.format(timeFormat());
                row.accessible_name = `${zone} ${there.format('%a %H:%M')}`;
            }
        };
    }

    function renderStopwatch() {
        const display = label('', 'nova-productivity-time', {name: 'nova-productivity-time',
            x_align: Clutter.ActorAlign.CENTER});
        const caption = label('', 'nova-productivity-details', {x_align: Clutter.ActorAlign.CENTER});
        const {row, sync} = controls(stopwatch, {lap: true});
        content.add_child(display);
        content.add_child(caption);
        content.add_child(row);
        const laps = stopwatch.laps;
        if (laps.length) {
            content.add_child(sectionTitle(_('Laps')));
            const list = card('', true, {x_expand: true, style: 'padding: 4px 2px; spacing: 0;'});
            const splits = laps.map((value, index) => value - (laps[index - 1] ?? 0));
            const fastest = Math.min(...splits);
            const slowest = Math.max(...splits);
            for (let index = laps.length - 1; index >= 0; index--) {
                const lapRow = box({style_class: 'nova-lap-row'});
                const name = label(`${_('Lap')} ${index + 1}`, 'nova-body', {x_expand: true});
                const split = label(formatTime(splits[index]), 'nova-body');
                if (laps.length > 1 && splits[index] === fastest)
                    split.style = 'color: #7ee8b4;';
                else if (laps.length > 1 && splits[index] === slowest)
                    split.style = 'color: #ff9a9a;';
                lapRow.add_child(name);
                lapRow.add_child(split);
                lapRow.add_child(label(formatTime(laps[index]), 'nova-caption', {style: 'min-width: 64px;',
                    x_align: Clutter.ActorAlign.END}));
                list.add_child(lapRow);
            }
            content.add_child(list);
        }
        refreshView = () => {
            display.text = formatTime(stopwatch.value);
            caption.text = stopwatch.running ? _('Running') : stopwatch.value ? _('Paused') : _('Ready');
            sync();
        };
    }

    function renderRing(timer, kind) {
        const ring = new Ring({size: 176, thickness: 9});
        const phase = label('', 'nova-section-title', {x_align: Clutter.ActorAlign.CENTER, ellipsize: false});
        const display = label('', 'nova-productivity-ring-time', {name: 'nova-productivity-time',
            x_align: Clutter.ActorAlign.CENTER});
        const details = label('', 'nova-productivity-details', {x_align: Clutter.ActorAlign.CENTER});
        ring.overlay.add_child(phase);
        ring.overlay.add_child(display);
        ring.overlay.add_child(details);
        content.add_child(ring.actor);
        const dots = box({style_class: 'nova-session-dots', x_align: Clutter.ActorAlign.CENTER});
        const sessions = kind === 'pomodoro' ? Array.from({length: 4}, () => {
            const dot = new St.Widget({style_class: 'nova-session-dot'});
            dots.add_child(dot);
            return dot;
        }) : [];
        if (sessions.length)
            content.add_child(dots);
        const {row, sync} = controls(timer);
        content.add_child(row);
        refreshView = () => {
            const total = timer.duration || 1;
            const isBreak = kind === 'pomodoro' && timer.phase !== 'focus';
            ring.set(timer.remaining / total, isBreak ? BREAK_COLOR : null);
            display.text = formatTime(timer.remaining);
            if (kind === 'pomodoro') {
                phase.text = isBreak ? _('BREAK') : _('FOCUS');
                phase.style = `color: ${isBreak ? BREAK_COLOR : Theme.accent};`;
                details.text = `${_('Completed sessions')} ${timer.sessions}`;
                const filled = timer.sessions % 4;
                sessions.forEach((dot, index) => {
                    dot.style = index < filled ? `background-color: ${Theme.accent};`
                        : index === filled && timer.phase === 'focus' && timer.running
                            ? `background-color: ${rgbaCss(Theme.accent, 0.45)};` : '';
                });
            } else {
                phase.text = timer.running ? _('RUNNING') : timer.remaining === 0 ? _('DONE') : _('TIMER');
                phase.style = `color: ${Theme.accent};`;
                details.text = `${_('of')} ${shortTime(timer.duration)}`;
            }
            sync();
        };
    }

    function render() {
        calendarChanged = null;
        refreshView = null;
        clearChildren(content);
        tabs.select(selected);
        if (selected === 'calendar')
            renderCalendar();
        else if (selected === 'world')
            renderWorld();
        else if (selected === 'stopwatch')
            renderStopwatch();
        else if (timers[selected])
            renderRing(timers[selected], selected);
        if (!settings.get('productivity-enabled', false)) {
            clearChildren(content);
            content.add_child(emptyState({iconName: 'x-office-calendar-symbolic', title: _('Productivity is off'),
                body: _('Enable it in NOVA Island Settings → Modules.')}));
        }
        update();
        onChanged(false);
    }

    const configure = () => {
        if (!countdown.running && countdown.value === 0)
            countdown.duration = settings.get('productivity-countdown', 300) * 1000;
        if (!pomodoro.running && pomodoro.value === 0)
            pomodoro.duration = (pomodoro.phase === 'focus' ? settings.get('productivity-focus-minutes', 25) :
                settings.get('productivity-break-minutes', 5)) * 60000;
        if (!settings.get('productivity-enabled', false)) {
            Object.values(timers).forEach(timer => timer.pause());
            save();
            releaseCalendar();
        }
        schedule();
        settings.setBoolean('productivity-focus-active', focusActive());
        updateCompact();
        if (expanded.mapped && selected !== 'calendar')
            render();
        onChanged(false);
    };
    lifecycle.connect(expanded, 'notify::mapped', () => {
        if (expanded.mapped) {
            render();
        } else {
            calendarChanged = null;
            releaseCalendar();
            refreshView = null;
        }
        schedule();
    });
    lifecycle.connect(interfaceSettings, 'changed::clock-format', () => refreshView?.());
    lifecycle.add(() => {
        destroyed = true;
        if (source)
            GLib.Source.remove(source);
        releaseCalendar();
        save();
        settings.setBoolean('productivity-focus-active', false);
    });
    tabs.select(selected);
    updateCompact();
    return {compact, expanded, configure, fit: {minWidth: 456, maxHeight: 580},
        get focusActive() { return focusActive(); },
        describe: () => compactText.text, applyTheme() {}};
}
