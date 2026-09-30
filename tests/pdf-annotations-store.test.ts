// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { BookRecord } from '../src/core/types'
import { createTextQuoteAnchor } from '../src/core/text-anchor'
import { createPdfAnnotationStore } from '../entrypoints/reader/stores/pdf-annotations'

describe('PDF annotation store', () => {
  const update = vi.fn(async () => undefined)
  const record = (): BookRecord => ({
    id: 'pdf-1', name: 'book.pdf', type: 'application/pdf', size: 1, lastModified: 1,
    format: 'pdf', blob: new Blob(['pdf']), openedAt: 1, annotations: [],
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    update.mockClear()
    document.body.replaceChildren()
  })

  test('persists only the record annotation array and projects a current PDF selection', async () => {
    const useStore = createPdfAnnotationStore({ repository: { update } })
    const store = useStore()
    const page = renderedPage()
    const range = document.createRange()
    range.selectNodeContents(page.querySelector('span')!)

    store.synchronizeSession({ record: record(), generation: 3, zoom: 1, root: document.body })
    await store.createFromSelection({ page, range, generation: 3, rects: () => [{ left: 10, top: 10, width: 20, height: 10 }] })

    expect(store.annotations).toHaveLength(1)
    expect(update).toHaveBeenCalledWith('pdf-1', { annotations: expect.arrayContaining([expect.objectContaining({ kind: 'pdf', page: 1 })]) })
  })

  test('rejects stale generation writes and clears overlays on session replacement', async () => {
    const useStore = createPdfAnnotationStore({ repository: { update } })
    const store = useStore()
    const page = renderedPage()
    const range = document.createRange()
    range.selectNodeContents(page.querySelector('span')!)

    store.synchronizeSession({ record: record(), generation: 3, zoom: 1, root: document.body })
    store.synchronizeSession({ record: { ...record(), id: 'pdf-2' }, generation: 4, zoom: 1, root: document.body })
    await store.createFromSelection({ page, range, generation: 3, rects: () => [{ left: 10, top: 10, width: 20, height: 10 }] })

    expect(store.annotations).toEqual([])
    expect(update).not.toHaveBeenCalled()
    expect(page.querySelector('.pdf-annotation-layer')).toBeNull()
  })

  test('keeps in-memory edits and exposes a retryable error when persistence fails', async () => {
    update.mockRejectedValueOnce(new Error('offline'))
    const useStore = createPdfAnnotationStore({ repository: { update } })
    const store = useStore()
    const page = renderedPage()
    const range = document.createRange()
    range.selectNodeContents(page.querySelector('span')!)
    store.synchronizeSession({ record: record(), generation: 3, zoom: 1, root: document.body })

    await store.createFromSelection({ page, range, generation: 3, rects: () => [{ left: 10, top: 10, width: 20, height: 10 }] })

    expect(store.annotations).toHaveLength(1)
    expect(store.error).toMatch(/保存失败/)
  })

  test('filters, sorts, and bulk-deletes only PDF annotations selected by the user', async () => {
    const useStore = createPdfAnnotationStore({ repository: { update } })
    const store = useStore()
    const first = annotation('first', 2, 'earlier', 1)
    const second = annotation('second', 1, 'needle note', 2)
    store.synchronizeSession({ record: { ...record(), annotations: [first, second] }, generation: 3, zoom: 1, root: document.body })
    store.query = 'needle'
    store.sort = 'location'

    expect(store.visible.map(item => item.id)).toEqual(['second'])
    store.selected = ['second']
    await store.removeSelected()

    expect(store.annotations.map(item => item.id)).toEqual(['first'])
    expect(update).toHaveBeenCalledWith('pdf-1', { annotations: [first] })
  })

  test('rerenders imported annotations after zoom and clears their old overlays', () => {
    const useStore = createPdfAnnotationStore({ repository: { update } })
    const store = useStore()
    const page = renderedPage()
    const imported = annotation('imported', 1, 'Selected text', 1)
    store.synchronizeSession({ record: { ...record(), annotations: [imported] }, generation: 3, zoom: 1, root: document.body })
    expect(page.querySelector('.pdf-annotation-layer')).not.toBeNull()

    store.synchronizeSession({ record: { ...record(), annotations: [imported] }, generation: 3, zoom: 1.2, root: document.body })

    expect(page.querySelectorAll('.pdf-annotation-layer')).toHaveLength(1)
    expect(page.querySelectorAll('.pdf-annotation-layer span')).toHaveLength(1)
  })

  test('preserves non-PDF annotations and serializes consecutive saves', async () => {
    let releaseFirst: () => void = () => undefined
    const firstPending = new Promise<void>(resolve => { releaseFirst = resolve })
    const writes: Array<{ annotations: BookRecord['annotations'] }> = []
    const repository = { update: vi.fn(async (_id: string, changes: { annotations: BookRecord['annotations'] }) => {
      writes.push(changes)
      if (writes.length === 1) await firstPending
    }) }
    const store = createPdfAnnotationStore({ repository })()
    const ebook = { ...annotation('ebook-1', 1, 'ebook', 1), kind: 'ebook' as const, locator: 'cfi:1' }
    const first = annotation('first', 1, 'Selected text', 1)
    store.synchronizeSession({ record: { ...record(), annotations: [ebook, first] }, generation: 1, zoom: 1, root: document.body })
    const saveFirst = store.update('first', { note: 'first edit' })
    const saveSecond = store.update('first', { note: 'second edit' })
    await Promise.resolve()
    expect(repository.update).toHaveBeenCalledTimes(1)
    releaseFirst()
    await Promise.all([saveFirst, saveSecond])
    expect(repository.update).toHaveBeenCalledTimes(2)
    expect(writes[0]?.annotations?.find(item => item.id === 'ebook-1')).toEqual(ebook)
    expect(writes[1]?.annotations?.find(item => item.id === 'first')?.note).toBe('second edit')
  })

  test('imports and recovers a moved PDF anchor using rendered nearby page text', async () => {
    const store = createPdfAnnotationStore({ repository: { update } })()
    const page = renderedPage()
    page.dataset.page = '2'
    const imported = {
      ...annotation('imported', 1, 'Selected text', 1),
      anchor: { version: 1 as const, kind: 'pdf' as const, page: 1, textOffset: 0, quote: createTextQuoteAnchor('Selected text', 0, 13) },
      anchorStatus: 'unresolved' as const,
    }
    store.synchronizeSession({ record: record(), generation: 1, zoom: 1, root: document.body })
    const result = await store.importAnnotations([imported])
    expect(result.added).toBe(1)
    expect(store.annotations[0]).toMatchObject({ page: 2, locator: 'page:2', anchorStatus: 'resolved', anchor: { page: 2 } })
    expect(update).toHaveBeenCalledWith('pdf-1', { annotations: expect.arrayContaining([expect.objectContaining({ page: 2 })]) })
  })

  test('keeps an unresolved import visible until its nearby page renders', async () => {
    const store = createPdfAnnotationStore({ repository: { update } })()
    const imported = {
      ...annotation('pending', 1, 'Selected text', 1),
      anchor: { version: 1 as const, kind: 'pdf' as const, page: 1, textOffset: 0, quote: createTextQuoteAnchor('Selected text', 0, 13) },
      anchorStatus: 'unresolved' as const,
    }
    store.synchronizeSession({ record: record(), generation: 1, zoom: 1, root: document.body })
    await store.importAnnotations([imported])
    expect(store.annotations[0]?.anchorStatus).toBe('unresolved')
    expect(document.querySelector('.pdf-annotation-layer')).toBeNull()
    const page = renderedPage()
    page.dataset.page = '2'
    store.renderPage(2)
    await vi.waitFor(() => expect(store.annotations[0]).toMatchObject({ page: 2, anchorStatus: 'resolved' }))
  })

  test('does not guess between duplicate quotes on two nearby rendered pages', async () => {
    const store = createPdfAnnotationStore({ repository: { update } })()
    const before = renderedPage()
    before.dataset.page = '1'
    const after = renderedPage()
    after.dataset.page = '3'
    const imported = {
      ...annotation('ambiguous', 2, 'Selected text', 1),
      anchor: { version: 1 as const, kind: 'pdf' as const, page: 2, textOffset: 0, quote: createTextQuoteAnchor('Selected text', 0, 13) },
      anchorStatus: 'unresolved' as const,
    }
    store.synchronizeSession({ record: record(), generation: 1, zoom: 1, root: document.body })
    await store.importAnnotations([imported])
    expect(store.annotations[0]).toMatchObject({ page: 2, anchorStatus: 'unresolved' })
    expect(document.querySelector('.pdf-annotation-layer')).toBeNull()
  })

  test('exposes a visible retry path for a failed save', async () => {
    update.mockRejectedValueOnce(new Error('offline'))
    const store = createPdfAnnotationStore({ repository: { update } })()
    store.synchronizeSession({ record: { ...record(), annotations: [annotation('first', 1, 'Selected text', 1)] }, generation: 1, zoom: 1, root: document.body })
    await store.update('first', { note: 'keep this' })
    expect(store.error).toMatch(/保存失败/)
    await store.retrySave()
    expect(store.error).toBeNull()
    expect(update).toHaveBeenLastCalledWith('pdf-1', { annotations: expect.arrayContaining([expect.objectContaining({ note: 'keep this' })]) })
  })

  test('retains an unsaved annotation draft across close and reopen in the same session', async () => {
    update.mockRejectedValueOnce(new Error('offline'))
    const store = createPdfAnnotationStore({ repository: { update } })()
    const initial = { ...record(), annotations: [annotation('first', 1, 'Selected text', 1)] }
    store.synchronizeSession({ record: initial, generation: 1, zoom: 1, root: document.body })
    await store.update('first', { note: 'unsaved' })
    store.synchronizeSession({ record: null, generation: 2, zoom: 1, root: document.body })
    store.synchronizeSession({ record: initial, generation: 3, zoom: 1, root: document.body })
    expect(store.annotations[0]?.note).toBe('unsaved')
    expect(store.error).toMatch(/保存失败/)
  })
})

function renderedPage() {
  const page = document.createElement('section')
  page.className = 'pdf-page'
  page.dataset.page = '1'
  page.dataset.state = 'rendered'
  Object.defineProperty(page, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 100, height: 200 }) })
  page.innerHTML = '<div class="textLayer"><span>Selected text</span></div>'
  document.body.append(page)
  return page
}

function annotation(id: string, page: number, text: string, createdAt: number) {
  return {
    id, kind: 'pdf' as const, locator: `page:${page}`, page, section: null,
    text, note: text.includes('note') ? 'note' : '', color: '#f4c95d', rects: [{ left: 0.1, top: 0.1, width: 0.2, height: 0.1 }], createdAt,
  }
}
