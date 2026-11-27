export class LifecycleManager {
    #cleanups = [];

    add(cleanup) {
        this.#cleanups.push(cleanup);
    }

    connect(source, signal, callback) {
        const id = source.connect(signal, callback);
        this.add(() => source.disconnect(id));
    }

    destroy() {
        while (this.#cleanups.length > 0) {
            try {
                this.#cleanups.pop()();
            } catch (error) {
                console.error('NOVA Island cleanup failed', error);
            }
        }
    }
}
