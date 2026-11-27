import GLib from 'gi://GLib';
import {load} from './vendor/js-yaml.mjs';
import {parseLyrics} from './lyricTiming.js';

const folded = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : '';
function searchMatch(rows, {track_name, artist_name, album_name, duration}) {
    if (!Array.isArray(rows))
        throw new Error('Unexpected lyrics search response');
    const matches = rows.filter(row => folded(row?.trackName) === folded(track_name) &&
        folded(row.artistName) === folded(artist_name) &&
        (!duration || Math.abs(row.duration - duration) <= 3));
    return matches.find(row => album_name && folded(row.albumName) === folded(album_name)) ??
        (matches.length === 1 ? matches[0] : null);
}

const validTime = value => Number.isSafeInteger(value) && value >= 0;
function wordLines(source) {
    if (typeof source !== 'string')
        return [];
    try {
        const {lines} = load(source, {maxDepth: 16, maxAliases: 0});
        if (!Array.isArray(lines) || lines.length > 2048)
            return [];
        let wordCount = 0;
        for (const line of lines) {
            wordCount += Array.isArray(line?.words) ? line.words.length : 0;
            if (wordCount > 8192)
                return [];
        }
        return lines.filter(line => validTime(line?.start_ms) && typeof line.text === 'string').map(line => {
            const words = [];
            let cursor = 0;
            for (const word of Array.isArray(line.words) ? line.words : []) {
                if (!validTime(word?.start_ms) || typeof word.text !== 'string' || !word.text.length)
                    continue;
                const start = line.text.indexOf(word.text, cursor);
                if (start < 0 || word.start_ms < line.start_ms ||
                    (words.length && word.start_ms / 1000 < words.at(-1).seconds))
                    continue;
                cursor = start + word.text.length;
                words.push({seconds: word.start_ms / 1000, until: validTime(word.end_ms) && word.end_ms >= word.start_ms ? word.end_ms / 1000 : null,
                    start, end: cursor});
            }
            return {seconds: line.start_ms / 1000, until: validTime(line.end_ms) && line.end_ms >= line.start_ms ? line.end_ms / 1000 : null,
                text: line.text, words};
        }).sort((a, b) => a.seconds - b.seconds);
    } catch {
        return [];
    }
}

const [, bytes] = GLib.file_get_contents('/dev/stdin');
const input = JSON.parse(new TextDecoder().decode(bytes));
const data = ARGV[0] === 'search' ? searchMatch(input, JSON.parse(ARGV[1])) : input;
if (data) {
    let timed = data.hasWordSync === true ? wordLines(data.lyricsfile) : [];
    let mode = 'word';
    if (!timed.some(line => line.words.length)) {
        timed = parseLyrics(typeof data.syncedLyrics === 'string' ? data.syncedLyrics.slice(0, 64000) : '').slice(0, 2048);
        mode = timed.some(line => line.text) ? 'line' : 'plain';
        if (mode === 'plain')
            timed = [];
    }
    const plain = (typeof data.plainLyrics === 'string' && data.plainLyrics.trim().slice(0, 64000)) ||
        timed.map(line => line.text).join('\n');
    print(JSON.stringify({mode, timed, plain, message: plain ? '' : data.instrumental ? 'Instrumental track' : 'Lyrics unavailable'}));
} else {
    print('null');
}
