export class PromiseCache<Key, Value> {
  readonly #values = new Map<Key, Promise<Value>>()

  has(key: Key): boolean {
    return this.#values.has(key)
  }

  get(key: Key, loader: () => Value | Promise<Value>): Promise<Value> {
    const existing = this.#values.get(key)
    if (existing) return existing
    const promise = Promise.resolve().then(loader)
    this.#values.set(key, promise)
    void promise.catch(() => {
      if (this.#values.get(key) === promise) this.#values.delete(key)
    })
    return promise
  }

  clear(): void {
    this.#values.clear()
  }
}
