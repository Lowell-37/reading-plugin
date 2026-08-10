import { createSearchContext, iterateSearchMatches } from './search-context.js';
export class EbookSearchIndex {
    #sections;
    #order = new Map();
    #cache = new Map();
    #generation = 0;
    constructor(sections) {
        this.#sections = [...sections];
        this.#sections.forEach((section, position) => this.#order.set(section.index, position));
    }
    async search(queryValue, options = {}) {
        const query = String(queryValue ?? '');
        if (!query)
            return { results: [], errors: [], total: 0 };
        const generation = this.#generation;
        const batchSize = Math.max(1, Math.floor(options.batchSize ?? 20));
        const maxResults = Number.isFinite(options.maxResults)
            ? Math.max(0, Math.floor(options.maxResults))
            : Number.POSITIVE_INFINITY;
        const results = [];
        const errors = [];
        let total = 0;
        let pendingChanges = 0;
        let cachedSectionsSinceYield = 0;
        for (const section of this.#scanOrder(options.currentSectionIndex)) {
            this.#throwIfStopped(options.signal, generation);
            const wasCached = this.#cache.has(section.index);
            try {
                const text = await this.#load(section);
                this.#throwIfStopped(options.signal, generation);
                for (const match of iterateSearchMatches(text, query)) {
                    const length = match.end - match.start;
                    total += 1;
                    pendingChanges += 1;
                    const candidate = { section: section.index, offset: match.start };
                    const worst = results[results.length - 1];
                    const shouldRetain = results.length < maxResults
                        || Boolean(worst && this.#comparePositions(candidate, worst) < 0);
                    if (shouldRetain) {
                        const locator = await section.createLocator(match.start, length);
                        this.#throwIfStopped(options.signal, generation);
                        results.push({
                            ...candidate,
                            label: section.label || `Chapter ${section.index + 1}`,
                            length,
                            context: createSearchContext(text, match.start, length),
                            locator,
                        });
                        results.sort((left, right) => this.#comparePositions(left, right));
                        if (results.length > maxResults)
                            results.pop();
                    }
                    if (pendingChanges >= batchSize) {
                        options.onBatch?.(this.#snapshot(results, errors, total));
                        this.#throwIfStopped(options.signal, generation);
                        pendingChanges = 0;
                        await yieldToEventLoop();
                        this.#throwIfStopped(options.signal, generation);
                    }
                }
            }
            catch (error) {
                this.#throwIfStopped(options.signal, generation);
                errors.push({
                    section: section.index,
                    label: section.label || `Chapter ${section.index + 1}`,
                    error: error instanceof Error ? error : new Error(String(error)),
                });
                pendingChanges += 1;
            }
            if (!wasCached && pendingChanges > 0) {
                options.onBatch?.(this.#snapshot(results, errors, total));
                this.#throwIfStopped(options.signal, generation);
                pendingChanges = 0;
            }
            if (!wasCached) {
                await yieldToEventLoop();
                this.#throwIfStopped(options.signal, generation);
                cachedSectionsSinceYield = 0;
            }
            else {
                cachedSectionsSinceYield += 1;
                if (cachedSectionsSinceYield >= 4) {
                    await yieldToEventLoop();
                    this.#throwIfStopped(options.signal, generation);
                    cachedSectionsSinceYield = 0;
                }
            }
        }
        const snapshot = this.#snapshot(results, errors, total);
        if (pendingChanges > 0)
            options.onBatch?.(snapshot);
        this.#throwIfStopped(options.signal, generation);
        return snapshot;
    }
    clear() {
        this.#generation += 1;
        this.#cache.clear();
    }
    #scanOrder(currentSectionIndex) {
        const cached = this.#sections.filter(section => this.#cache.has(section.index));
        const current = this.#sections.filter(section => section.index === currentSectionIndex && !this.#cache.has(section.index));
        const remaining = this.#sections.filter(section => !this.#cache.has(section.index) && section.index !== currentSectionIndex);
        return [...cached, ...current, ...remaining];
    }
    #load(section) {
        const existing = this.#cache.get(section.index);
        if (existing)
            return existing.promise;
        const promise = Promise.resolve().then(section.loadText).then(value => String(value ?? ''));
        this.#cache.set(section.index, { promise });
        return promise;
    }
    #snapshot(results, errors, total) {
        return {
            results: [...results],
            errors: [...errors].sort((left, right) => (this.#order.get(left.section) ?? 0) - (this.#order.get(right.section) ?? 0)),
            total,
        };
    }
    #comparePositions(left, right) {
        const sectionOrder = (this.#order.get(left.section) ?? 0) - (this.#order.get(right.section) ?? 0);
        return sectionOrder || left.offset - right.offset;
    }
    #throwIfStopped(signal, generation) {
        if (!signal?.aborted && generation === this.#generation)
            return;
        const error = new Error('Search aborted');
        error.name = 'AbortError';
        throw error;
    }
}
function yieldToEventLoop() {
    return new Promise(resolve => setTimeout(resolve, 0));
}
