export function parseLyrics(input) {
    const entries = [];
    const offset = Number(input.match(/^\[offset:([+-]?\d{1,6})\]/im)?.[1] ?? 0) / 1000;
    for (const line of input.split(/\r?\n/)) {
        const marks = [...line.matchAll(/\[(\d{1,4}):([0-5]\d(?:\.\d{1,3})?)\]/g)];
        const text = line.replace(/\[\d{1,4}:[0-5]\d(?:\.\d{1,3})?\]/g, '').trim();
        marks.forEach(([, minutes, seconds]) =>
            entries.push({seconds: Math.max(0, Number(minutes) * 60 + Number(seconds) - offset), text}));
    }
    return entries.sort((a, b) => a.seconds - b.seconds);
}

// Return the last cue whose start is at or before playback, including ties.
export function cueAt(cues, seconds) {
    let low = 0;
    let high = cues.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (cues[mid].seconds <= seconds)
            low = mid + 1;
        else
            high = mid;
    }
    return low - 1;
}

export function activeCue(cues, seconds) {
    const index = cueAt(cues, seconds);
    const until = cues[index]?.until;
    return until != null && seconds >= until ? -1 : index;
}
