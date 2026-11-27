export function cpuSample(text) {
    const match = text.match(/^cpu\s+([\d\s]+)$/m);
    if (!match)
        return null;
    const values = match[1].trim().split(/\s+/).map(Number).slice(0, 8);
    if (values.length < 4 || values.some(value => !Number.isFinite(value)))
        return null;
    return {total: values.reduce((sum, value) => sum + value, 0), idle: values[3] + (values[4] ?? 0)};
}

export function cpuUsage(previous, current) {
    if (!previous || !current || current.total <= previous.total || current.idle < previous.idle)
        return null;
    return Math.max(0, Math.min(100, 100 * (1 - (current.idle - previous.idle) / (current.total - previous.total))));
}

export function memoryUsage(text) {
    const total = Number(text.match(/^MemTotal:\s+(\d+)/m)?.[1]);
    const available = Number(text.match(/^MemAvailable:\s+(\d+)/m)?.[1]);
    return total > 0 && Number.isFinite(available) ? {used: Math.max(0, total - available) * 1024, total: total * 1024} : null;
}

export function networkSample(text) {
    const result = {};
    for (const line of text.split('\n')) {
        const match = line.match(/^\s*([^:]+):\s*(.*)$/);
        if (!match || match[1] === 'lo')
            continue;
        const values = match[2].trim().split(/\s+/).map(Number);
        if (values.length >= 16 && Number.isFinite(values[0]) && Number.isFinite(values[8]))
            result[match[1]] = {rx: values[0], tx: values[8]};
    }
    return result;
}

export function networkRate(previous, current, seconds) {
    if (!previous || seconds <= 0)
        return null;
    let rx = 0;
    let tx = 0;
    for (const [name, value] of Object.entries(current)) {
        const before = previous[name];
        if (before && value.rx >= before.rx && value.tx >= before.tx) {
            rx += value.rx - before.rx;
            tx += value.tx - before.tx;
        }
    }
    return {rx: rx / seconds, tx: tx / seconds};
}
