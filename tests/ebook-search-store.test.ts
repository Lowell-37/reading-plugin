import { createPinia } from 'pinia'
import { describe, expect, test, vi } from 'vitest'
import { createEbookSearchStore } from '../entrypoints/reader/stores/ebook-search'
import { useEbookSessionStore } from '../entrypoints/reader/stores/ebook-session'
import type { EbookSearchSnapshot } from '../src/core/ebook-search-index'

const result: EbookSearchSnapshot = {
  total: 1,
  errors: [],
  results: [{ section: 0, label: 'First', offset: 3, length: 6, context: { text: 'A needle appears.', start: 0, end: 17, matchStart: 2, matchEnd: 8 }, locator: 'cfi:needle' }],
}

describe('ebook search store', () => {
  test('publishes batches and final results for the current ebook', async () => {
    const pinia = createPinia()
    const ebook = useEbookSessionStore(pinia)
    ebook.record = { id: 'one', name: 'one.epub', format: 'epub' }
    ebook.status = 'ready'
    ebook.generation = 1
    vi.spyOn(ebook, 'search').mockImplementation(async (_query, options) => {
      options?.onBatch?.(result)
      return result
    })
    const search = createEbookSearchStore()(pinia)

    await search.run(' needle ')

    expect(search.query).toBe('needle')
    expect(search.status).toBe('ready')
    expect(search.total).toBe(1)
    expect(search.results[0]!.locator).toBe('cfi:needle')
  })

  test('drops in-flight results after the ebook changes', async () => {
    const pinia = createPinia()
    const ebook = useEbookSessionStore(pinia)
    ebook.record = { id: 'one', name: 'one.epub', format: 'epub' }
    ebook.status = 'ready'
    ebook.generation = 1
    let release!: (value: EbookSearchSnapshot) => void
    vi.spyOn(ebook, 'search').mockImplementation(() => new Promise(resolve => { release = resolve }))
    const search = createEbookSearchStore()(pinia)
    search.synchronizeSession({ generation: 1, recordId: 'one', status: 'ready' })

    const pending = search.run('needle')
    ebook.record = { id: 'two', name: 'two.epub', format: 'epub' }
    ebook.generation = 2
    search.synchronizeSession({ generation: 2, recordId: 'two', status: 'ready' })
    release(result)
    await pending

    expect(search.status).toBe('idle')
    expect(search.results).toEqual([])
  })

  test('aborts a superseded query and ignores its late batch and result', async () => {
    const pinia = createPinia()
    const ebook = useEbookSessionStore(pinia)
    ebook.record = { id: 'one', name: 'one.epub', format: 'epub' }
    ebook.status = 'ready'
    ebook.generation = 1
    let releaseOld!: (value: EbookSearchSnapshot) => void
    let oldOptions!: Parameters<typeof ebook.search>[1]
    vi.spyOn(ebook, 'search').mockImplementation((query, options) => {
      if (query === 'old') {
        oldOptions = options
        return new Promise(resolve => { releaseOld = resolve })
      }
      return Promise.resolve({ results: [], total: 0, errors: [] })
    })
    const search = createEbookSearchStore()(pinia)

    const old = search.run('old')
    await search.run('new')
    expect(oldOptions?.signal?.aborted).toBe(true)
    oldOptions?.onBatch?.(result)
    releaseOld(result)
    await old

    expect(search.query).toBe('new')
    expect(search.status).toBe('ready')
    expect(search.results).toEqual([])
  })

  test('reports a search failure without making the ebook session fail', async () => {
    const pinia = createPinia()
    const ebook = useEbookSessionStore(pinia)
    ebook.record = { id: 'one', name: 'one.epub', format: 'epub' }
    ebook.status = 'ready'
    vi.spyOn(ebook, 'search').mockRejectedValue(new Error('section parser failed'))
    const search = createEbookSearchStore()(pinia)

    await search.run('needle')

    expect(search.status).toBe('error')
    expect(search.error).toContain('搜索失败')
    expect(ebook.status).toBe('ready')
  })
})
