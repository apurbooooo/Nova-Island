import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {SystemMonitor} from '../../desktop/systemMonitor.js';
import {toolView} from './desktopShared.js';
import {Meter, Sparkline, bindTheme, box, card, chip, clearChildren, formatBytes, icon, label,
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
        fit: {minWidth: 520, maxHeight: 600}});
    // Plain-text summary for screen readers and diagnostics.
    const summary = new St.Label({name: 'nova-system-monitor-values', text: _('Sampling…'), visible: false});
    view.content.add_child(summary);
    const live = chip(_('Live'), {tone: 'success'});
    view.header.trailing.add_child(live);

    const grid = box({vertical: true, style_class: 'nova-monitor-grid', x_expand: true});
    view.content.add_child(grid);

    const rowOne = box({style_class: 'nova-monitor-row', x_expand: true});
    const cpu = graphCard(_('Processor'), 'power-profile-performance-symbolic', null);
    const memory = graphCard(_('Memory'), 'drive-multidisk-symbolic', COLORS.memory);
    const gpu = graphCard(_('Graphics'), 'video-display-symbolic', COLORS.gpu);
    gpu.actor.visible = false;
    [cpu, memory, gpu].forEach(item => rowOne.add_child(item.actor));
    grid.add_child(rowOne);

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
    netTop.add_child(legend);
    const netGraph = new Sparkline({series: 2, capacity: 40});
    netGraph.colors = [COLORS.download, COLORS.upload];
    const netCaption = label(_('Sampling…'), 'nova-caption');
    network.add_child(netTop);
    network.add_child(netGraph.actor);
    network.add_child(netCaption);
    grid.add_child(network);

    const rowThree = box({style_class: 'nova-monitor-row', x_expand: true});
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
    rowThree.add_child(thermal);
    rowThree.add_child(battery);
    grid.add_child(rowThree);

    const devices = card('nova-monitor-card', true, {x_expand: true});
    const deviceRow = (title, iconName) => {
        const row = box({style_class: 'nova-monitor-row'});
        row.add_child(metricBadge(iconName, null));
        row.add_child(label(title, 'nova-card-title', {style: 'min-width: 84px;'}));
        const meter = new Meter({style_class: 'nova-meter'});
        meter.actor.y_align = Clutter.ActorAlign.CENTER;
        row.add_child(meter.actor);
        const value = label('', 'nova-qs-value', {x_align: Clutter.ActorAlign.END});
        row.add_child(value);
        devices.add_child(row);
        return {row, meter, value};
    };
    const volume = deviceRow(_('Volume'), 'audio-volume-high-symbolic');
    const brightness = deviceRow(_('Brightness'), 'display-brightness-symbolic');
    grid.add_child(devices);

    const control = Volume.getMixerControl();
    let lastSensors = '';
    const renderDevices = lines => {
        const output = control.get_default_sink();
        volume.row.visible = Boolean(output);
        if (output) {
            const level = output.volume / control.get_vol_max_norm();
            volume.meter.set(output.is_muted ? 0 : level);
            volume.value.text = output.is_muted ? _('Muted') : `${Math.round(level * 100)}%`;
            volume.row.get_first_child().child.icon_name = output.is_muted
                ? 'audio-volume-muted-symbolic' : 'audio-volume-high-symbolic';
            lines.push(`${_('Volume')} ${volume.value.text}`);
        }
        const scale = Main.brightnessManager?.globalScale;
        brightness.row.visible = Boolean(scale && Number.isFinite(scale.value));
        if (brightness.row.visible) {
            brightness.meter.set(scale.value);
            brightness.value.text = `${Math.round(scale.value * 100)}%`;
            lines.push(`${_('Brightness')} ${brightness.value.text}`);
        }
        devices.visible = volume.row.visible || brightness.row.visible;
    };

    const monitor = new SystemMonitor(metrics => {
        const lines = [];
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
        gpu.actor.visible = Boolean(gpuSensor);
        if (gpuSensor) {
            gpu.value.text = `${Math.round(gpuSensor.value)}%`;
            gpu.graph.push(gpuSensor.value);
            gpu.caption.text = _('Busy time');
            lines.push(`${_('GPU')} ${gpuSensor.value.toFixed(0)}%`);
        }
        const temps = metrics.sensors.filter(sensor => sensor.kind === 'temperature')
            .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)).slice(0, 4);
        thermal.visible = temps.length > 0;
        const layout = temps.map(sensor => sensor.key).join();
        if (layout !== lastSensors) {
            lastSensors = layout;
            clearChildren(thermalList);
            for (const sensor of temps) {
                const row = box({style_class: 'nova-temp-row'});
                row.add_child(label(sensor.label, 'nova-body', {x_expand: true}));
                const meter = new Meter({style_class: 'nova-meter nova-meter-thin nova-temp-meter'});
                meter.actor.x_expand = false;
                meter.actor.y_align = Clutter.ActorAlign.CENTER;
                row.add_child(meter.actor);
                row.add_child(label('', 'nova-qs-value', {x_align: Clutter.ActorAlign.END}));
                row._meter = meter;
                thermalList.add_child(row);
            }
        }
        temps.forEach((sensor, index) => {
            const row = thermalList.get_child_at_index(index);
            row._meter.set(sensor.value / 100, tempColor(sensor.value));
            row.get_last_child().text = `${Math.round(sensor.value)}°C`;
            lines.push(`${sensor.label} ${sensor.value.toFixed(0)} °C`);
        });
        const power = metrics.sensors.find(sensor => sensor.kind === 'battery');
        battery.visible = Boolean(power);
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
        }
        renderDevices(lines);
        summary.text = lines.join('\n') || _('No metrics available');
        view.expanded.accessible_name = summary.text;
        onChanged(false);
    });
    const configure = () => {
        const running = settings.get('system-monitor-enabled', false) && view.expanded.mapped;
        if (running && !monitor.running) {
            // History is only meaningful while sampling continuously.
            [cpu, memory, gpu].forEach(item => item.graph.reset());
            netGraph.reset();
            monitor.start(settings.get('system-monitor-interval', 2));
        } else if (!running) {
            monitor.stop();
        }
        setChip(live, running ? _('Live') : _('Paused'), running ? 'success' : 'neutral');
    };
    lifecycle.connect(view.expanded, 'notify::mapped', configure);
    lifecycle.add(() => monitor.destroy());
    return {...view, configure: () => {
        monitor.stop();
        configure();
    }};
}
