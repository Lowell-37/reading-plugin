export function normalizeProgress(progress) {
  if (!progress || typeof progress !== 'object') return null
  const fraction = Math.max(0, Math.min(1, Number(progress.fraction) || 0))
  if (progress.kind === 'pdf') {
    return {
      kind: 'pdf',
      page: Math.max(1, Math.round(Number(progress.page) || 1)),
      fraction,
    }
  }
  if (progress.kind === 'ebook') {
    return {
      kind: 'ebook',
      cfi: typeof progress.cfi === 'string' && progress.cfi ? progress.cfi : null,
      fraction,
    }
  }
  return null
}

export class ProgressService {
  #delay
  #now
  #onError
  #pending = null
  #repository
  #timer = null

  constructor(repository, { delay = 350, now = () => Date.now(), onError = console.error } = {}) {
    if (!repository?.update) throw new TypeError('ProgressService requires a repository with update()')
    this.#repository = repository
    this.#delay = delay
    this.#now = now
    this.#onError = onError
  }

  schedule(bookId, progress) {
    const normalized = normalizeProgress(progress)
    if (!bookId || !normalized) return false
    this.#pending = { bookId, progress: normalized }
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.flush().catch(this.#onError)
    }, this.#delay)
    return true
  }

  async flush() {
    clearTimeout(this.#timer)
    this.#timer = null
    const pending = this.#pending
    this.#pending = null
    if (!pending) return false
    await this.#repository.update(pending.bookId, {
      progress: pending.progress,
      openedAt: this.#now(),
    })
    return true
  }

  cancel() {
    clearTimeout(this.#timer)
    this.#timer = null
    this.#pending = null
  }
}
