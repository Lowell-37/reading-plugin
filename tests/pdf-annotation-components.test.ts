// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import ToolsPanel from '../entrypoints/reader/components/ToolsPanel.vue'
import { usePdfAnnotationStore } from '../entrypoints/reader/stores/pdf-annotations'
import { usePdfSessionStore } from '../entrypoints/reader/stores/pdf-session'
import type { BookRecord } from '../src/core/types'

describe('Vue PDF annotation tools', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

  test('renders PDF annotations and routes delete through the Pinia store', async () => {
    const pdf = usePdfSessionStore()
    const annotations = usePdfAnnotationStore()
    const book = record()
    pdf.record = { id: book.id, name: book.name, format: 'pdf' }
    pdf.status = 'ready'
    pdf.generation = 1
    annotations.synchronizeSession({ record: book, generation: 1, zoom: 1, root: document.body })
    const remove = vi.spyOn(annotations, 'remove').mockResolvedValue()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mount(ToolsPanel, { attachTo: document.body })

    expect(wrapper.findAll('.annotation-item')).toHaveLength(1)
    await wrapper.find('.annotation-item .danger').trigger('click')

    expect(remove).toHaveBeenCalledWith('annotation-1')
  })

  test('does not intercept an ebook highlighter click when no PDF is ready', async () => {
    const wrapper = mount(ToolsPanel, { attachTo: document.body })
    const listener = vi.fn()
    wrapper.find('#highlight-selection').element.addEventListener('click', listener)

    await wrapper.find('#highlight-selection').trigger('click')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('owns PDF filter and bulk controls before legacy listeners mutate the list', async () => {
    const pdf = usePdfSessionStore()
    const annotations = usePdfAnnotationStore()
    const book = record()
    pdf.record = { id: book.id, name: book.name, format: 'pdf' }
    pdf.status = 'ready'
    annotations.synchronizeSession({ record: book, generation: 1, zoom: 1, root: document.body })
    const wrapper = mount(ToolsPanel, { attachTo: document.body })
    const legacyFilter = vi.fn(() => wrapper.find('#annotation-list').element.replaceChildren())
    wrapper.find('#annotation-filter-query').element.addEventListener('input', legacyFilter)
    const input = wrapper.find('#annotation-filter-query')
    await input.setValue('Selected')
    expect(annotations.query).toBe('Selected')
    expect(legacyFilter).not.toHaveBeenCalled()
    expect(wrapper.findAll('.annotation-item')).toHaveLength(1)
  })

  test('routes PDF annotation JSON import through the store, not the legacy listener', async () => {
    const pdf = usePdfSessionStore()
    const annotations = usePdfAnnotationStore()
    const book = record()
    pdf.record = { id: book.id, name: book.name, format: 'pdf' }
    pdf.status = 'ready'
    annotations.synchronizeSession({ record: book, generation: 1, zoom: 1, root: document.body })
    const importFile = vi.spyOn(annotations, 'importAnnotations').mockResolvedValue({ annotations: [], added: 1, updated: 0, skipped: 0 })
    const wrapper = mount(ToolsPanel, { attachTo: document.body })
    const input = wrapper.find('#annotation-import-input').element as HTMLInputElement
    const legacyImport = vi.fn()
    input.addEventListener('change', legacyImport)
    const file = new File([JSON.stringify({
      format: 'quiet-reader-annotations', version: 1, exportedAt: '',
      book: { title: 'book', author: '', fileName: 'book.pdf', format: 'pdf' },
      annotations: book.annotations,
    })], 'annotations.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await wrapper.find('#annotation-import-input').trigger('change')
    await vi.waitFor(() => expect(importFile).toHaveBeenCalledTimes(1))
    expect(legacyImport).not.toHaveBeenCalled()
  })
})

function record(): BookRecord {
  return {
    id: 'pdf-1', name: 'book.pdf', type: 'application/pdf', size: 1, lastModified: 1,
    format: 'pdf', blob: new Blob(['pdf']), openedAt: 1,
    annotations: [{ id: 'annotation-1', kind: 'pdf', locator: 'page:1', page: 1, section: null, text: 'Selected text', note: '', color: '#f4c95d', rects: [], createdAt: 1 }],
  }
}
