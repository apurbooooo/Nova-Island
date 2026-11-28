// Session-local storage. Pinned entries still obey the total byte and item limits.
export class ClipboardHistory {
    constructor(now = () => Date.now()) {
        this.now = now;
        this.items = [];
        this.limit = 30;
        this.maxBytes = 8 * 1024 * 1024;
        this.maxAge = 30 * 60000;
        this.nextId = 1;
    }

    prune() {
        this.items = this.items.filter(item => item.pinned || this.now() - item.created < this.maxAge);
        while (this.items.length > this.limit || this.items.reduce((total, item) => total + item.size, 0) > this.maxBytes) {
            const index = this.items.findLastIndex(item => !item.pinned);
            if (index < 0)
                this.items.pop();
            else
                this.items.splice(index, 1);
        }
    }

    add(type, data, size, text = '') {
        if (!size || size > this.maxBytes)
            return;
        const duplicate = this.items.find(item => item.type === type && item.key === data);
        if (duplicate)
            this.items.splice(this.items.indexOf(duplicate), 1);
        const item = duplicate ?? {id: this.nextId++, type, data, key: data, size, text, pinned: false};
        item.created = this.now();
        this.items.unshift(item);
        this.prune();
    }

    search(query) {
        this.prune();
        return this.items.filter(item => item.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    }

    clear() { this.items = []; }
}

export function sensitiveText(text, exclusions = []) {
    if (/-----BEGIN .*PRIVATE KEY-----|\b(?:password|passwd|secret|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S+/i.test(text))
        return true;
    if (/^(?:\d[ -]?){13,19}$/.test(text.trim()) || /^\d{4,8}$/.test(text.trim()))
        return true;
    return exclusions.some(term => term && text.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
}
