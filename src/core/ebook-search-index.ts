import { createSearchContext, type SearchContext } from './search-context.js'

export interface EbookSearchSection {
  index: number
  label?: string
  loadText: () => string | Promise<string>
  createLocator: (offset: number, length: number) => unknown | Promise<unknown>
}

export interface EbookSearchResult {
  section: number
  label: string
  offset: number
  length: number
  context: SearchContext
  locator: unknown
}

export interface EbookSearchError {
  section: number
  label: string
  error: Error
}

export interface EbookSearchSnapshot {
  results: EbookSearchResult[]
  errors: EbookSearchError[]
}

export interface EbookSearchOptions {
  signal?: AbortSignal
  batchSize?: number
  currentSectionIndex?: number
  onBatch?: (snapshot: EbookSearchSnapshot) => void
}

interface CachedSection {
  promise: Promise<string>
}

export class EbookSearchIndex {
  readonly #sections: EbookSearchSection[]
  readonly #order = new Map<number, number>()
  readonly #cache = new Map<number, CachedSection>()
  #generation = 0

  constructor(sections: EbookSearchSection[]) {
    this.#sections = [...sections]
    this.#sections.forEach((section, position) => this.#order.set(section.index, position))
  }

  async search(queryValue: unknown, options: EbookSearchOptions = {}): Promise<EbookSearchSnapshot> {
    const query = String(queryValue ?? '')
    const normalizedQuery = query.toLocaleLowerCase()
    if (!normalizedQuery) return { results: [], errors: [] }
    const generation = this.#generation
    const batchSize = Math.max(1, Math.floor(options.batchSize ?? 20))
    const results: EbookSearchResult[] = []
    const errors: EbookSearchError[] = []
    let pendingChanges = 0

    for (const section of this.#scanOrder(options.currentSectionIndex)) {
      this.#throwIfStopped(options.signal, generation)
      try {
        const text = await this.#load(section)
        this.#throwIfStopped(options.signal, generation)
        const normalizedText = text.toLocaleLowerCase()
        let offset = 0
        while (offset <= normalizedText.length - normalizedQuery.length) {
          const matchOffset = normalizedText.indexOf(normalizedQuery, offset)
          if (matchOffset < 0) break
          const locator = await section.createLocator(matchOffset, query.length)
          this.#throwIfStopped(options.signal, generation)
          results.push({
            section: section.index,
            label: section.label || `Chapter ${section.index + 1}`,
            offset: matchOffset,
            length: query.length,
            context: createSearchContext(text, matchOffset, query.length),
            locator,
          })
          pendingChanges += 1
          offset = matchOffset + Math.max(1, normalizedQuery.length)
        }
      } catch (error) {
        this.#throwIfStopped(options.signal, generation)
        errors.push({
          section: section.index,
          label: section.label || `Chapter ${section.index + 1}`,
          error: error instanceof Error ? error : new Error(String(error)),
        })
        pendingChanges += 1
      }
      if (pendingChanges >= batchSize) {
        options.onBatch?.(this.#snapshot(results, errors))
        this.#throwIfStopped(options.signal, generation)
        pendingChanges = 0
      }
    }

    const snapshot = this.#snapshot(results, errors)
    if (pendingChanges > 0) options.onBatch?.(snapshot)
    this.#throwIfStopped(options.signal, generation)
    return snapshot
  }

  clear(): void {
    this.#generation += 1
    this.#cache.clear()
  }

  #scanOrder(currentSectionIndex?: number): EbookSearchSection[] {
    const cached = this.#sections.filter(section => this.#cache.has(section.index))
    const current = this.#sections.filter(section => section.index === currentSectionIndex && !this.#cache.has(section.index))
    const remaining = this.#sections.filter(section => !this.#cache.has(section.index) && section.index !== currentSectionIndex)
    return [...cached, ...current, ...remaining]
  }

  #load(section: EbookSearchSection): Promise<string> {
    const existing = this.#cache.get(section.index)
    if (existing) return existing.promise
    const promise = Promise.resolve().then(section.loadText).then(value => String(value ?? ''))
    this.#cache.set(section.index, { promise })
    return promise
  }

  #snapshot(results: EbookSearchResult[], errors: EbookSearchError[]): EbookSearchSnapshot {
    return {
      results: [...results].sort((left, right) => {
        const sectionOrder = (this.#order.get(left.section) ?? 0) - (this.#order.get(right.section) ?? 0)
        return sectionOrder || left.offset - right.offset
      }),
      errors: [...errors].sort((left, right) => (this.#order.get(left.section) ?? 0) - (this.#order.get(right.section) ?? 0)),
    }
  }

  #throwIfStopped(signal: AbortSignal | undefined, generation: number): void {
    if (!signal?.aborted && generation === this.#generation) return
    const error = new Error('Search aborted')
    error.name = 'AbortError'
    throw error
  }
}
