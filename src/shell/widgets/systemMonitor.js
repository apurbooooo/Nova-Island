import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {SystemMonitor} from '../../desktop/systemMonitor.js';
import {toolView} from './desktopShared.js';
import {Meter, Sparkline, bindTheme, box, card, chip, formatBytes, icon, label,
    rgbaCss, setChip} from '../ui/kit.js';

const GIB = 1073741824;
const COLORS = {memory: '#7ee8b4', gpu: '#c7a6ff', download: '#6fc3ff', upload: '#ff9fcf'};
const GROUP_ORDER = ['cpu', 'gpu', 'memory', 'storage', 'chipset', 'wireless', 'system'];

function tempColor(value) {
    return value >= 85 ? '#ff7a7a' : value >= 70 ? '#ffc566' : null;
}

function batteryIcon(level, status) {
    const step = Math.max(0, Math.min(100, Math.round(level / 10) * 10));
    if (status === 'Charging')
        return step === 100 ? 'battery-level-100-charged-symbolic' : `battery-level-${step}-charging-symbolic`;
    if (status === 'Full' && step === 100)
        return 'battery-level-100-charged-symbolic';
    return `battery-level-${step}-symbolic`;
}

function metricBadge(iconName, color) {
    const badge = new St.Bin({style_class: 'nova-monitor-icon', child: icon(iconName, 14),
        y_align: Clutter.ActorAlign.CENTER});
    bindTheme(badge, theme => {
        const tint = color ?? theme.accent;
        badge.style = `background-color: ${rgbaCss(tint, 0.16)}; color: ${tint};`;
    });
    return badge;
}

// Graph card: title row with live value, history graph, and a caption.
function graphCard(title, iconName, color, {series = 1, max = 100} = {}) {
    const actor = card('nova-monitor-card', true, {x_expand: true});
    const top = box({style_class: 'nova-monitor-row'});
    top.add_child(metricBadge(iconName, color));
    top.add_child(label(title, 'nova-card-title', {x_expand: true}));
    const value = label('—', 'nova-card-value');
    top.add_child(value);
    const graph = new Sparkline({series, max, capacity: 40});
    graph.colors[0] = color;
    const caption = label(_('Sampling…'), 'nova-caption');
    actor.add_child(top);
    actor.add_child(graph.actor);
    actor.add_child(caption);
    return {actor, value, graph, caption};
}

export function createSystemMonitorWidget(lifecycle, onChanged, settings) {
    const view = toolView('system-monitor', _('System Monitor'), {subtitle: _('Live readings from this device'),
        fit: {minWidth: 860, maxHeight: 480}});
    view.expanded.x_expand = true;
    // Plain-text summary for screen readers and diagnostics.
    const summary = new St.Label({name: 'nova-system-monitor-values', text: _('Sampling…'), visible: false});
    view.content.add_child(summary);
    const live = chip(_('Live'), {tone: 'success'});
    view.header.trailing.add_child(live);

    const layout = new Clutter.GridLayout({column_spacing: 10, row_spacing: 10, column_homogeneous: true});
    const grid = new St.Widget({name: 'nova-monitor-grid', layout_manager: layout, x_expand: true});
    view.content.add_child(grid);

    const cpu = graphCard(_('Processor'), 'power-profile-performance-symbolic', null);
    const memory = graphCard(_('Memory'), 'drive-multidisk-symbolic', COLORS.memory);
    const gpu = graphCard(_('Graphics'), 'video-display-symbolic', COLORS.gpu);
    gpu.actor.visible = false;


    const network = card('nova-monitor-card', true, {x_expand: true});
    const netTop = box({style_class: 'nova-monitor-row'});
    netTop.add_child(metricBadge('network-transmit-receive-symbolic', COLORS.download));
    netTop.add_child(label(_('Network'), 'nova-card-title', {x_expand: true}));
    const legend = box({style_class: 'nova-monitor-legend', y_align: Clutter.ActorAlign.CENTER});
    const rate = (glyph, color) => {
        const actor = box({style_class: 'nova-monitor-row'});
        const dot = new St.Widget({style_class: 'nova-status-dot', y_align: Clutter.ActorAlign.CENTER,
            style: `background-color: ${color};`});
        const text = label('—', 'nova-card-title nova-tabular');
        actor.add_child(dot);
        actor.add_child(label(glyph, 'nova-caption'));
        actor.add_child(text);
        legend.add_child(actor);
        return text;
    };
    const down = rate('↓', COLORS.download);
    const up = rate('↑', COLORS.upload);

    const netGraph = new Sparkline({series: 2, capacity: 40});
    netGraph.colors = [COLORS.download, COLORS.upload];
    const netCaption = label(_('Sampling…'), 'nova-caption');
    network.add_child(netTop);
    network.add_child(legend);
    network.add_child(netGraph.actor);
    network.add_child(netCaption);


    const thermal = card('nova-monitor-card', true, {x_expand: true});
    const thermalTop = box({style_class: 'nova-monitor-row'});
    thermalTop.add_child(metricBadge('weather-clear-symbolic', '#ffb26b'));
    thermalTop.add_child(label(_('Temperatures'), 'nova-card-title', {x_expand: true}));
    thermal.add_child(thermalTop);
    const thermalList = box({vertical: true, style_class: 'nova-monitor-grid'});
    thermal.add_child(thermalList);
    thermal.visible = false;

    const battery = card('nova-monitor-card', true, {x_expand: true});
    const batteryTop = box({style_class: 'nova-monitor-row'});
    const batteryBadgeIcon = icon('battery-level-100-symbolic', 14);
    const batteryBadge = new St.Bin({style_class: 'nova-monitor-icon', child: batteryBadgeIcon,
        y_align: Clutter.ActorAlign.CENTER});
    batteryTop.add_child(batteryBadge);
    batteryTop.add_child(label(_('Battery'), 'nova-card-title', {x_expand: true}));
    const batteryValue = label('—', 'nova-card-value');
    batteryTop.add_child(batteryValue);
    const batteryMeter = new Meter();
    const batteryState = label('', 'nova-caption');
    battery.add_child(batteryTop);
    battery.add_child(batteryMeter.actor);
    battery.add_child(batteryState);
    battery.visible = false;


    const deviceRow = (title, iconName) => {
        const row = card('nova-monitor-card', true, {x_expand: true});
        const titleRow = box({style_class: 'nova-monitor-row'});
        titleRow.add_child(metricBadge(iconName, null));
        titleRow.add_child(label(title, 'nova-card-title', {x_expand: true}));
        row.add_child(titleRow);
        const meter = new Meter({style_class: 'nova-meter'});
        meter.actor.y_align = Clutter.ActorAlign.CENTER;
        row.add_child(meter.actor);
        const value = label('', 'nova-qs-value', {x_align: Clutter.ActorAlign.END});
        row.add_child(value);

        return {row, meter, value};
    };
    const volume = deviceRow(_('Volume'), 'audio-volume-high-symbolic');
    const brightness = deviceRow(_('Brightness'), 'display-brightness-symbolic');
    const groups = [[cpu.actor, memory.actor, gpu.actor], [network, thermal, battery],
        [volume.row, brightness.row]];
    const cards = groups.flat();
    cards.forEach(actor => grid.add_child(actor));
    const temperatureRows = new Map();
    let previousLayout = '';
    let destroyed = false;
    const reflow = () => {
        if (destroyed)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        // Respect both monitor-clamped allocation and user text scaling.
        const minimum = Math.max(250 * scale, ...cards.filter(actor => actor.visible)
            .map(actor => actor.get_preferred_width(-1)[0]));
        const columns = Math.max(1, Math.min(3, Math.floor((grid.width + 10 * scale) / (minimum + 10 * scale))));
        const visibleGroups = groups.map(group => group.filter(actor => actor.visible));
        const signature = `${columns}:${cards.map(actor => Number(actor.visible)).join('')}:${temperatureRows.size}`;
        if (signature === previousLayout)
            return;
        previousLayout = signature;
        let row = 0;
        for (const group of visibleGroups) {
            for (let start = 0; start < group.length; start += columns) {
                const entries = group.slice(start, start + columns);
                const span = 6 / entries.length;
                entries.forEach((actor, index) => {
                    layout.child_set_property(grid, actor, 'left-attach', index * span);
                    layout.child_set_property(grid, actor, 'top-attach', row);
                    layout.child_set_property(grid, actor, 'width', span);
                    actor.x_expand = true;
                    actor.x_align = Clutter.ActorAlign.FILL;
                    actor.y_align = Clutter.ActorAlign.FILL;
                });
                row++;
            }
        }
        onChanged(false);
    };
    // Child metadata changes invalidate layout; defer them out of allocation.
    let reflowSource = 0;
    const queueReflow = () => {
        if (!destroyed && !reflowSource)
            reflowSource = GLib.idle_add_once(GLib.PRIORITY_DEFAULT_IDLE, () => {
                reflowSource = 0;
                reflow();
            });
    };
    lifecycle.connect(grid, 'notify::allocation', queueReflow);
    const stopReflow = () => {
        destroyed = true;
        if (reflowSource)
            GLib.Source.remove(reflowSource);
        reflowSource = 0;
    };
    lifecycle.connect(grid, 'destroy', stopReflow);
    lifecycle.add(stopReflow);

    const control = Volume.getMixerControl();
    let firstSample = true;
    const updateVisibility = (actor, available) => {
        // A transient read failure should not shrink or rearrange an open panel.
        actor.visible = available || (!firstSample && actor.visible);
    };
    const renderDevices = lines => {
        const output = control.get_default_sink();
        updateVisibility(volume.row, Boolean(output));
        if (output) {
            const level = output.volume / control.get_vol_max_norm();
            volume.meter.set(output.is_muted ? 0 : level);
            volume.value.text = output.is_muted ? _('Muted') : `${Math.round(level * 100)}%`;
            volume.row.get_first_child().get_first_child().child.icon_name = output.is_muted
                ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic';
            lines.push(`${_('Volume')} ${volume.value.text}`);
        } else {
            volume.meter.set(0);
            volume.value.text = '—';
        }
        const scale = Main.brightnessManager?.globalScale;
        const brightnessAvailable = Boolean(scale && Number.isFinite(scale.value));
        updateVisibility(brightness.row, brightnessAvailable);
        if (brightnessAvailable) {
            brightness.meter.set(scale.value);
            brightness.value.text = `${Math.round(scale.value * 100)}%`;
            lines.push(`${_('Brightness')} ${brightness.value.text}`);
        } else {
            brightness.meter.set(0);
            brightness.value.text = '—';
        }

    };

    const monitor = new SystemMonitor(metrics => {
        const lines = [];
        updateVisibility(cpu.actor, metrics.cpuAvailable);
        if (metrics.cpu === null) {
            cpu.value.text = '—';
            cpu.caption.text = metrics.cpuAvailable ? _('Sampling…') : _('Reading unavailable');
        }
        updateVisibility(memory.actor, Boolean(metrics.memory));
        updateVisibility(network, metrics.networkAvailable);
        if (!metrics.network) {
            down.text = '—';
            up.text = '—';
            netCaption.text = metrics.networkAvailable ? _('Sampling…') : _('Reading unavailable');
        }
        if (metrics.cpu !== null) {
            cpu.value.text = `${Math.round(metrics.cpu)}%`;
            cpu.graph.push(metrics.cpu);
            cpu.caption.text = _('Usage over the last %d s').replace('%d',
                String(cpu.graph.data[0].length * settings.get('system-monitor-interval', 2)));
            lines.push(`${_('CPU')} ${metrics.cpu.toFixed(1)}%`);
        }
        if (metrics.memory) {
            const percent = 100 * metrics.memory.used / metrics.memory.total;
            memory.value.text = `${Math.round(percent)}%`;
            memory.graph.push(percent);
            memory.caption.text = `${(metrics.memory.used / GIB).toFixed(1)} ${_('of')} ${(metrics.memory.total / GIB).toFixed(1)} GiB ${_('in use')}`;
            lines.push(`${_('Memory')} ${(metrics.memory.used / GIB).toFixed(1)} / ${(metrics.memory.total / GIB).toFixed(1)} GiB`);
        } else {
            memory.value.text = '—';
            memory.caption.text = _('Reading unavailable');
        }
        if (metrics.network) {
            down.text = formatBytes(metrics.network.rx, true);
            up.text = formatBytes(metrics.network.tx, true);
            netGraph.push(metrics.network.rx, metrics.network.tx);
            const peak = Math.max(...netGraph.data.flat(), 0);
            netCaption.text = `${_('Peak')} ${formatBytes(peak, true)}`;
            lines.push(`${_('Network')} ↓ ${down.text} ↑ ${up.text}`);
        }
        const gpuSensor = metrics.sensors.find(sensor => sensor.kind === 'percent' && sensor.group === 'gpu');
        updateVisibility(gpu.actor, Boolean(gpuSensor));
        if (gpuSensor) {
            gpu.value.text = `${Math.round(gpuSensor.value)}%`;
            gpu.graph.push(gpuSensor.value);
            gpu.caption.text = _('Busy time');
            lines.push(`${_('GPU')} ${gpuSensor.value.toFixed(0)}%`);
        } else {
            gpu.value.text = '—';
            gpu.caption.text = _('Reading unavailable');
        }
        const temps = metrics.sensors.filter(sensor => sensor.kind === 'temperature')
            .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
        const readings = new Map(temps.map(sensor => [sensor.key, sensor]));
        if (firstSample) {
            for (const [key, {row}] of temperatureRows) {
                if (!readings.has(key)) {
                    row.destroy();
                    temperatureRows.delete(key);
                }
            }
        }
        for (const sensor of temps) {
            if (temperatureRows.size === 4)
                break;
            if (temperatureRows.has(sensor.key))
                continue;
            const row = box({style_class: 'nova-temp-row'});
            const meter = new Meter({style_class: 'nova-meter nova-meter-thin nova-temp-meter'});
            meter.actor.x_expand = false;
            meter.actor.y_align = Clutter.ActorAlign.CENTER;
            const value = label('—', 'nova-qs-value', {x_align: Clutter.ActorAlign.END});
            row.add_child(label(sensor.label, 'nova-body', {x_expand: true}));
            row.add_child(meter.actor);
            row.add_child(value);
            thermalList.add_child(row);
            temperatureRows.set(sensor.key, {row, meter, value});
        }
        thermal.visible = temperatureRows.size > 0;
        for (const [key, {meter, value}] of temperatureRows) {
            const sensor = readings.get(key);
            meter.set(sensor ? sensor.value / 100 : 0, sensor ? tempColor(sensor.value) : null);
            value.text = sensor ? `${Math.round(sensor.value)}°C` : '—';
            if (sensor)
                lines.push(`${sensor.label} ${sensor.value.toFixed(0)} °C`);
        }
        const power = metrics.sensors.find(sensor => sensor.kind === 'battery');
        updateVisibility(battery, Boolean(power));
        if (power) {
            const color = power.value <= 15 ? '#ff7a7a' : power.value <= 30 ? '#ffc566' : '#7ee8b4';
            batteryValue.text = `${Math.round(power.value)}%`;
            batteryMeter.set(power.value / 100, color);
            batteryBadgeIcon.icon_name = batteryIcon(power.value, power.status);
            batteryBadge.style = `background-color: ${rgbaCss(color, 0.16)}; color: ${color};`;
            const states = {Charging: _('Charging'), Discharging: _('On battery'), Full: _('Fully charged'),
                'Not charging': _('Plugged in, not charging')};
            batteryState.text = states[power.status] ?? _('Status unavailable');
            lines.push(`${_('Battery')} ${power.value}% ${batteryState.text}`);
        } else {
            batteryValue.text = '—';
            batteryMeter.set(0);
            batteryState.text = _('Reading unavailable');
        }
        renderDevices(lines);
        firstSample = false;
        summary.text = lines.join('\n') || _('No metrics available');
        view.expanded.accessible_name = summary.text;
        queueReflow();
    });
    const configure = () => {
        const running = settings.get('system-monitor-enabled', false) && view.expanded.mapped;
        if (running && !monitor.running) {
            // History is only meaningful while sampling continuously.
            firstSample = true;
            [cpu, memory, gpu].forEach(item => item.graph.reset());
            netGraph.reset();
            monitor.start(settings.get('system-monitor-interval', 2));
        } else if (!running) {
            monitor.stop();
        }
        setChip(live, running ? _('Live') : _('Paused'), running ? 'success' : 'neutral');
    };
    lifecycle.connect(view.expanded, 'notify::mapped', configure);
    lifecycle.connect(view.expanded, 'destroy', () => monitor.destroy());
    lifecycle.add(() => monitor.destroy());
    return {...view, fillWidth: true, configure: () => {
        monitor.stop();
        configure();
    }};
}
