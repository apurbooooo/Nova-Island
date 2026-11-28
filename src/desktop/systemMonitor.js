import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {readText, listDirectories} from './io.js';
import {cpuSample, cpuUsage, memoryUsage, networkSample, networkRate} from './metrics.js';

// Only sensors whose driver or zone type identifies the hardware get a label.
// Anything else stays hidden rather than showing raw kernel identifiers.
const HWMON_LABELS = [
    [/^(coretemp|k10temp|zenpower|cpu_thermal|cpu-thermal)$/, 'CPU', 'cpu'],
    [/^(amdgpu|radeon|nouveau|xe)$/, 'GPU', 'gpu'],
    [/^nvme$/, 'SSD', 'storage'],
    [/^drivetemp$/, 'Drive', 'storage'],
    [/^iwlwifi/, 'Wi-Fi', 'wireless'],
    [/^(spd5118|jc42)$/, 'Memory', 'memory'],
    [/^pch_/, 'Chipset', 'chipset'],
    [/^acpitz$/, 'System', 'system'],
];
const THERMAL_LABELS = [
    [/^x86_pkg_temp$/, 'CPU', 'cpu'],
    [/^(cpu|tcpu|cpu[-_]thermal|soc[-_]thermal|cpu-?\d*-thermal)$/i, 'CPU', 'cpu'],
    [/^(gpu|gpu[-_]thermal)$/i, 'GPU', 'gpu'],
    [/^iwlwifi/, 'Wi-Fi', 'wireless'],
    [/^pch_/, 'Chipset', 'chipset'],
    [/^acpitz$/, 'System', 'system'],
];

export function sensorLabel(source, name) {
    const table = source === 'hwmon' ? HWMON_LABELS : THERMAL_LABELS;
    const match = table.find(([pattern]) => pattern.test(name.trim()));
    return match ? {label: match[1], group: match[2]} : null;
}

export class SystemMonitor {
    constructor(changed) {
        this.changed = changed;
        this.job = null;
        this.source = 0;
        this.generation = 0;
        this.sensors = null;
        this.previous = null;
    }

    async discover(job) {
        const sensors = [];
        const labels = new Set();
        const add = sensor => {
            if (labels.has(sensor.label))
                return;
            labels.add(sensor.label);
            sensors.push(sensor);
        };
        const read = async path => {
            try {
                return (await readText(path, job)).trim();
            } catch {
                return '';
            }
        };
        const [hwmon, thermal, drm, batteries] = await Promise.all([
            listDirectories('/sys/class/hwmon', job), listDirectories('/sys/class/thermal', job),
            listDirectories('/sys/class/drm', job), listDirectories('/sys/class/power_supply', job),
        ]);
        for (const name of hwmon.filter(value => /^hwmon\d+$/.test(value)).slice(0, 16)) {
            const known = sensorLabel('hwmon', await read(`/sys/class/hwmon/${name}/name`));
            if (known && await read(`/sys/class/hwmon/${name}/temp1_input`))
                add({key: `hwmon:${name}`, ...known, path: `/sys/class/hwmon/${name}/temp1_input`, kind: 'temperature'});
        }
        for (const name of thermal.filter(value => /^thermal_zone\d+$/.test(value)).slice(0, 16)) {
            const known = sensorLabel('thermal', await read(`/sys/class/thermal/${name}/type`));
            if (known)
                add({key: `thermal:${name}`, ...known, path: `/sys/class/thermal/${name}/temp`, kind: 'temperature'});
        }
        for (const name of drm.filter(value => /^card\d+$/.test(value)).slice(0, 4)) {
            const path = `/sys/class/drm/${name}/device/gpu_busy_percent`;
            if (await read(path))
                sensors.push({key: `gpu:${name}`, label: 'GPU', group: 'gpu', path, kind: 'percent'});
        }
        for (const name of batteries.slice(0, 8)) {
            if (await read(`/sys/class/power_supply/${name}/type`) === 'Battery') {
                sensors.push({key: `battery:${name}`, label: 'Battery', group: 'battery', kind: 'battery',
                    path: `/sys/class/power_supply/${name}/capacity`,
                    statusPath: `/sys/class/power_supply/${name}/status`});
            }
        }
        return sensors;
    }

    async sample(generation) {
        if (this.job)
            return;
        const job = new Gio.Cancellable();
        this.job = job;
        try {
            const sensors = this.sensors ?? await this.discover(job);
            const paths = ['/proc/stat', '/proc/meminfo', '/proc/net/dev'];
            const slots = sensors.map(sensor => {
                const slot = [paths.push(sensor.path) - 1];
                if (sensor.statusPath)
                    slot.push(paths.push(sensor.statusPath) - 1);
                return slot;
            });
            const reads = await Promise.allSettled(paths.map(path => readText(path, job)));
            if (job.is_cancelled() || generation !== this.generation)
                return;
            this.sensors = sensors;
            const value = index => reads[index].status === 'fulfilled' ? reads[index].value : '';
            const now = GLib.get_monotonic_time() / 1000000;
            const cpu = cpuSample(value(0));
            const network = networkSample(value(2));
            const metrics = {
                cpuAvailable: Boolean(cpu), networkAvailable: reads[2].status === 'fulfilled',
                cpu: cpuUsage(this.previous?.cpu, cpu), memory: memoryUsage(value(1)),
                network: reads[2].status === 'fulfilled' ? networkRate(this.previous?.network, network, now - (this.previous?.now ?? now)) : null,
                sensors: [],
            };
            sensors.forEach((sensor, index) => {
                const [valueSlot, statusSlot] = slots[index];
                if (reads[valueSlot].status !== 'fulfilled')
                    return;
                const number = Number(value(valueSlot).trim());
                // Zero or negative readings come from idle or absent probes; hide them.
                const valid = Number.isFinite(number) && (sensor.kind === 'temperature'
                    ? number > 1000 && number < 150000 : number >= 0 && number <= 100);
                if (!valid)
                    return;
                metrics.sensors.push({...sensor,
                    value: sensor.kind === 'temperature' ? number / 1000 : number,
                    status: statusSlot !== undefined ? value(statusSlot).trim() : undefined});
            });
            this.previous = {cpu, network, now};
            this.changed(metrics);
        } finally {
            if (this.job === job)
                this.job = null;
        }
    }

    start(interval = 2) {
        this.stop();
        const generation = this.generation;
        this.sample(generation).catch(() => {});
        this.source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this.sample(generation).catch(() => {});
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        this.generation++;
        if (this.source)
            GLib.Source.remove(this.source);
        this.source = 0;
        this.job?.cancel();
        this.job = null;
        this.previous = null;
    }

    get running() { return this.source !== 0; }

    destroy() { this.stop(); this.sensors = null; }
}
