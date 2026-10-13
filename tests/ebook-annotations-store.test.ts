import { createPinia } from 'pinia'
import { describe, expect, test, vi } from 'vitest'
import { createEbookAnnotationStore } from '../entrypoints/reader/stores/ebook-annotations'
import { useEbookSessionStore } from '../entrypoints/reader/stores/ebook-session'
import type { Annotation, BookRecord } from '../src/core/types'

function record(id: string, annotations: Annotation[] = []): BookRecord {
  return { id, name: `${id}.epub`, format: 'epub', blob: new Blob(['book']), type: 'application/epub+zip', size: 4,
    lastModified: 1, openedAt: 1, annotations }
}

function annotation(id: string, kind: 'ebook' | 'pdf' = 'ebook'): Annotation {
  return { id, kind, locator: kind === 'ebook' ? `cfi:${id}` : `page:1`, page: kind === 'pdf' ? 1 : null,
    section: kind === 'ebook' ? 0 : null, text: id, note: '', color: '#f4c95d', rects: [], createdAt: 1 }
}

describe('ebook annotation store', () => {
  test('creates a highlight from the Foliate selection and preserves unrelated annotations in the record', async () => {
    const writes: Annotation[][] = []
    const repository = { async update(_id: string, changes: Pick<BookRecord, 'annotations'>) {
      writes.push(changes.annotations ?? [])
    } }
    const pinia = createPinia()
    const ebook = useEbookSessionStore(pinia)
    ebook.record = { id: 'one', name: 'one.epub', format: 'epub' }
    ebook.status = 'ready'
    ebook.generation = 1
    vi.spyOn(ebook, 'setAnnotations').mockResolvedValue(undefined)
    vi.spyOn(ebook, 'consumeSelection').mockReturnValue({ locator: 'cfi:new', section: 0, text: 'selected words' })
    const store = createEbookAnnotationStore({ repository })(pinia)
    store.synchronizeSession({ record: record('one', [annotation('older'), annotation('pdf-one', 'pdf')]), generation: 1 })

    const created = await store.createFromSelection('my note')

    expect(created).toMatchObject({ kind: 'ebook', locator: 'cfi:new', text: 'selected words', note: 'my note' })
    expect(writes.at(-1)?.map(item => item.id)).toEqual(['pdf-one', 'older', created!.id])
    expect(store.visible).toHaveLength(2)
  })

  test('edits, filters and removes ebook annotations without deleting PDF data', async () => {
    const writes: Annotation[][] = []
    const repository = { async update(_id: string, changes: Pick<BookRecord, 'annotations'>) { writes.push(changes.annotations ?? []) } }
    const pinia = createPinia()
    const ebook = useEbookSessionStore(pinia)
    ebook.record = { id: 'one', name: 'one.epub', format: 'epub' }
    ebook.status = 'ready'
    ebook.generation = 1
    vi.spyOn(ebook, 'setAnnotations').mockResolvedValue(undefined)
    const store = createEbookAnnotationStore({ repository })(pinia)
    store.synchronizeSession({ record: record('one', [annotation('first'), annotation('second'), annotation('pdf-one', 'pdf')]), generation: 1 })

    await store.update('first', { note: 'Important', tags: 'idea' })
    store.query = 'Important'
    expect(store.visible.map(item => item.id)).toEqual(['first'])
    store.selected = ['first']
    await store.removeSelected()

    expect(store.annotations.map(item => item.id)).toEqual(['second'])
    expect(writes.at(-1)?.map(item => item.id)).toEqual(['pdf-one', 'second'])
  })

  test('keeps a failed save draft for retry without applying it to a different book', async () => {
    const writes: string[] = []
    let fail = true
    const repository = { async update(id: string) {
      writes.push(id)
      if (fail) throw new Error('quota')
    } }
    const pinia = createPinia()
    const ebook = useEbookSessionStore(pinia)
    ebook.record = { id: 'one', name: 'one.epub', format: 'epub' }
    ebook.status = 'ready'
    ebook.generation = 1
    vi.spyOn(ebook, 'setAnnotations').mockResolvedValue(undefined)
    const store = createEbookAnnotationStore({ repository })(pinia)
    store.synchronizeSession({ record: record('one', [annotation('first')]), generation: 1 })
    await store.update('first', { note: 'unsaved' })
    expect(store.error).toContain('保存失败')

    ebook.record = { id: 'two', name: 'two.epub', format: 'epub' }
    ebook.generation = 2
    store.synchronizeSession({ record: record('two'), generation: 2 })
    expect(store.annotations).toEqual([])
    fail = false
    await store.retrySave()
    expect(writes).toEqual(['one', 'two'])
    store.synchronizeSession({ record: record('one', [annotation('first')]), generation: 3 })
    expect(store.annotations[0]?.note).toBe('unsaved')
  })

  test('retains the old book draft if the session changes while an overlay update is pending', async () => {
    let finishRender!: () => void
    const render = new Promise<void>(resolve => { finishRender = resolve })
    const repository = { update: vi.fn(async (_id: string) => {}) }
    const pinia = createPinia()
    const ebook = useEbookSessionStore(pinia)
    ebook.record = { id: 'one', name: 'one.epub', format: 'epub' }
    ebook.status = 'ready'
    ebook.generation = 1
    vi.spyOn(ebook, 'setAnnotations').mockResolvedValueOnce(undefined).mockReturnValueOnce(render).mockResolvedValue(undefined)
    const store = createEbookAnnotationStore({ repository })(pinia)
    store.synchronizeSession({ record: record('one', [annotation('first')]), generation: 1 })

    const editing = store.update('first', { note: 'not lost' })
    ebook.record = { id: 'two', name: 'two.epub', format: 'epub' }
    ebook.generation = 2
    store.synchronizeSession({ record: record('two'), generation: 2 })
    finishRender()
    await editing

    store.synchronizeSession({ record: record('one', [annotation('first')]), generation: 3 })
    expect(store.annotations[0]?.note).toBe('not lost')
    expect(repository.update.mock.calls.every(([id]) => id !== 'two')).toBe(true)
  })
})
