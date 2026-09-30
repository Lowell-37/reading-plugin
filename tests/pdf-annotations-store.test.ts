// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { BookRecord } from '../src/core/types'
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
