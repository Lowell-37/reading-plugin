export class PromiseCache {
    #values = new Map();
    has(key) {
        return this.#values.has(key);
    }
    get(key, loader) {
        const existing = this.#values.get(key);
        if (existing)
            return existing;
        const promise = Promise.resolve().then(loader);
        this.#values.set(key, promise);
        void promise.catch(() => {
            if (this.#values.get(key) === promise)
                this.#values.delete(key);
        });
        return promise;
    }
    clear() {
        this.#values.clear();
    }
}
